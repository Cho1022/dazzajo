package com.buildgraph.prototype.assembly;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.buildgraph.prototype.build.BuildGraphService;
import com.buildgraph.prototype.common.ApiException;
import com.buildgraph.prototype.quote.QuoteDraftQueryService;
import com.buildgraph.prototype.user.CurrentUserService;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;

class AssemblyBrokerageServiceTest {
    private final JdbcTemplate jdbcTemplate = mock(JdbcTemplate.class);
    private final CurrentUserService currentUserService = mock(CurrentUserService.class);
    private final AssemblyBrokerageService service = new AssemblyBrokerageService(
            jdbcTemplate,
            currentUserService,
            mock(QuoteDraftQueryService.class),
            mock(BuildGraphService.class),
            mock(BuildGraphPointService.class)
    );

    @Test
    void ownerAndAdminPublicDetailMapProposalAndAdminNoteFromSeparateColumns() {
        CurrentUserService.CurrentUser user = new CurrentUserService.CurrentUser(
                2L, "user-public-id", "user@example.com", "User", "USER", null
        );
        CurrentUserService.CurrentUser admin = new CurrentUserService.CurrentUser(
                1L, "admin-public-id", "admin@example.com", "Admin", "ADMIN", null
        );
        when(currentUserService.requireUser("Bearer user")).thenReturn(user);
        when(currentUserService.requireAdmin("Bearer admin")).thenReturn(admin);
        when(jdbcTemplate.queryForList(anyString(), any(Object[].class))).thenAnswer(invocation -> {
            String sql = invocation.getArgument(0);
            if (sql.contains("SELECT id FROM assembly_requests WHERE public_id")) {
                return List.of(Map.of("id", 10L));
            }
            if (sql.contains("SELECT ar.*, ar.public_id::text AS public_id_text")) {
                return List.of(requestRow());
            }
            if (sql.contains("FROM assembly_payments WHERE assembly_request_id")) {
                return List.of();
            }
            if (sql.contains("FROM assembly_request_items WHERE assembly_request_id")) {
                return List.of();
            }
            if (sql.contains("FROM assembly_offers ao JOIN technicians")) {
                return List.of(offerRow());
            }
            if (sql.contains("FROM assembly_request_status_history")) {
                return List.of();
            }
            throw new AssertionError("예상하지 않은 조립 요청 조회 SQL: " + sql);
        });

        assertOffer(service.detailForUser("Bearer user", "request-public-id"));
        assertOffer(service.adminRequestDetail("Bearer admin", "request-public-id"));
    }

    @Test
    void internalAutomaticOfferUsesSnapshotAndAssemblyFeeWithoutAdjustmentOrDeliveryFee() {
        UpdateCapture capture = captureUpdates();
        Map<String, Object> technician = technicianRow("INTERNAL");
        Map<String, Object> secondTechnician = new HashMap<>(technician);
        secondTechnician.put("id", 8L);
        secondTechnician.put("display_name", "두 번째 기사");
        when(jdbcTemplate.queryForList(contains("FROM technicians"), any(Object[].class)))
                .thenReturn(List.of(technician, secondTechnician));

        Integer count = ReflectionTestUtils.invokeMethod(
                service, "createAutomaticOffers", 10L, "FULL_SERVICE", "서울", "DELIVERY", 1_850_000L
        );

        assertThat(count).isEqualTo(2);
        assertThat(capture.calls()).hasSize(2);
        SqlCall insert = capture.find("INSERT INTO assembly_offers");
        assertThat(insert.params()[3]).isEqualTo(1_850_000L);
        assertThat(insert.params()[4]).isEqualTo(50_000L);
        assertThat(insert.params()[5]).isEqualTo(0L);
        assertThat(insert.params()[6]).isEqualTo(1_900_000L);
        assertThat(insert.params()[2].toString()).contains("\"providerType\":\"INTERNAL\"");
    }

    @Test
    void assemblyOnlyAutomaticOfferUsesOnlyAssemblyFee() {
        UpdateCapture capture = captureUpdates();
        when(jdbcTemplate.queryForList(contains("FROM technicians"), any(Object[].class)))
                .thenReturn(List.of(technicianRow("INTERNAL")));

        ReflectionTestUtils.invokeMethod(
                service, "createAutomaticOffers", 10L, "ASSEMBLY_ONLY", "서울", "DELIVERY", 1_850_000L
        );

        SqlCall insert = capture.find("INSERT INTO assembly_offers");
        assertThat(insert.params()[3]).isEqualTo(0L);
        assertThat(insert.params()[4]).isEqualTo(50_000L);
        assertThat(insert.params()[5]).isEqualTo(0L);
        assertThat(insert.params()[6]).isEqualTo(50_000L);
    }

    @Test
    void adminOfferCreationIgnoresLegacyPricesAndUsesServerPolicy() {
        CurrentUserService.CurrentUser admin = new CurrentUserService.CurrentUser(
                1L, "admin-public-id", "admin@example.com", "Admin", "ADMIN", null
        );
        when(currentUserService.requireAdmin("Bearer admin")).thenReturn(admin);
        stubAdminOfferQueries(requestRow(), technicianRow("INTERNAL"), null);
        UpdateCapture capture = captureUpdates();

        service.createAdminOffer("Bearer admin", "request-public-id", Map.of(
                "technicianId", "technician-public-id",
                "confirmedPartsPrice", 9_999_999L,
                "assemblyFee", 60_000L,
                "deliveryFee", 8_888_888L,
                "adminNote", "관리자 메모"
        ));

        SqlCall insert = capture.find("INSERT INTO assembly_offers");
        assertThat(insert.params()[3]).isEqualTo(1_000L);
        assertThat(insert.params()[4]).isEqualTo(60_000L);
        assertThat(insert.params()[5]).isEqualTo(0L);
        assertThat(insert.params()[6]).isEqualTo(61_000L);
        assertThat(insert.params()[9]).isEqualTo("관리자 메모");
    }

    @Test
    void adminOfferUpdateRecalculatesAllPriceColumnsAndKeepsAdminNote() {
        CurrentUserService.CurrentUser admin = new CurrentUserService.CurrentUser(
                1L, "admin-public-id", "admin@example.com", "Admin", "ADMIN", null
        );
        when(currentUserService.requireAdmin("Bearer admin")).thenReturn(admin);
        Map<String, Object> offer = selectionOffer("AVAILABLE");
        offer.put("warranty_days", 90);
        offer.put("proposal_message", "제안 메시지");
        offer.put("admin_note", "기존 관리자 메모");
        stubAdminOfferQueries(requestRow(), technicianRow("INTERNAL"), offer);
        UpdateCapture capture = captureUpdates();

        service.updateAdminOffer("Bearer admin", "request-public-id", "offer-public-id", Map.of(
                "confirmedPartsPrice", 9_999_999L,
                "assemblyFee", 60_000L,
                "deliveryFee", 8_888_888L,
                "adminNote", "수정 관리자 메모"
        ));

        SqlCall update = capture.find("UPDATE assembly_offers SET confirmed_parts_price");
        assertThat(update.params()).containsExactly(
                1_000L, 60_000L, 0L, 61_000L, 2, "재고 확인", "수정 관리자 메모", 20L
        );
    }

    @Test
    void selectingOfferNormalizesPriceAndCreatesCanonicalPendingPayment() {
        when(currentUserService.requireUser("Bearer user")).thenReturn(new CurrentUserService.CurrentUser(
                2L, "user-public-id", "user@example.com", "User", "USER", null
        ));
        Map<String, Object> request = requestRow();
        request.put("estimated_parts_price", 1_850_000L);
        stubSelectionQueries(request, selectionOffer("AVAILABLE"));
        UpdateCapture capture = captureUpdates();

        service.selectOffer("Bearer user", "request-public-id", "offer-public-id");

        SqlCall normalized = capture.find("SET confirmed_parts_price = ?");
        assertThat(normalized.params()).containsExactly(1_850_000L, 50_000L, 0L, 1_900_000L, 20L);
        SqlCall payment = capture.find("INSERT INTO assembly_payments");
        assertThat(payment.params()).containsExactly(10L, 1_900_000L);
        assertThat(capture.indexOf("SET confirmed_parts_price = ?"))
                .isLessThan(capture.indexOf("INSERT INTO assembly_payments"));
        assertThat(capture.indexOf("INSERT INTO assembly_payments"))
                .isLessThan(capture.indexOf("status = 'SELECTED'"));
        assertThat(capture.find("status = 'SELECTED'").params()).containsExactly(20L);
        assertThat(capture.find("status = 'EXPIRED'").params()).containsExactly(10L, 20L);
        assertThat(capture.find("status = 'MATCHED'").params()).containsExactly(20L, 10L);
    }

    @Test
    void repeatedSelectionReturnsExistingResultWithoutCreatingAnotherPayment() {
        when(currentUserService.requireUser("Bearer user")).thenReturn(new CurrentUserService.CurrentUser(
                2L, "user-public-id", "user@example.com", "User", "USER", null
        ));
        Map<String, Object> request = requestRow();
        request.put("status", "MATCHED");
        request.put("selected_offer_id", 20L);
        request.put("selected_offer_public_id", "offer-public-id");
        Map<String, Object> payment = paymentRow("PAID");
        stubSelectionQueries(request, selectionOffer("SELECTED"), payment);
        UpdateCapture capture = captureUpdates();

        Map<String, Object> result = service.selectOffer("Bearer user", "request-public-id", "offer-public-id");

        assertThat(result)
                .containsEntry("status", "MATCHED")
                .containsEntry("selectedOfferId", "offer-public-id");
        @SuppressWarnings("unchecked")
        Map<String, Object> returnedPayment = (Map<String, Object>) result.get("payment");
        assertThat(returnedPayment)
                .containsEntry("id", "payment-public-id")
                .containsEntry("amount", 1_900_000L)
                .containsEntry("paidAmount", 1_900_000L)
                .containsEntry("currency", "KRW")
                .containsEntry("provider", "TOSS")
                .containsEntry("method", "CARD")
                .containsEntry("status", "PAID");
        assertThat(capture.calls()).isEmpty();
    }

    @Test
    void selectingOfferFromAnotherRequestIsRejectedWithoutWrites() {
        stubUser();
        stubSelectionQueries(requestRow(), null);
        UpdateCapture capture = captureUpdates();

        assertApiException(
                () -> service.selectOffer("Bearer user", "request-public-id", "other-request-offer-id"),
                HttpStatus.NOT_FOUND,
                "NOT_FOUND"
        );

        assertThat(capture.calls()).isEmpty();
    }

    @Test
    void selectingAnotherUsersRequestIsRejectedBeforeOfferLookupOrWrites() {
        stubUser();
        when(jdbcTemplate.queryForList(anyString(), any(Object[].class))).thenReturn(List.of());
        UpdateCapture capture = captureUpdates();

        assertApiException(
                () -> service.selectOffer("Bearer user", "another-users-request-id", "offer-public-id"),
                HttpStatus.NOT_FOUND,
                "NOT_FOUND"
        );

        verify(jdbcTemplate, never()).queryForList(
                contains("SELECT *, id AS internal_id FROM assembly_offers"),
                any(Object[].class)
        );
        assertThat(capture.calls()).isEmpty();
    }

    @Test
    void withdrawnOfferCannotBeSelectedAndDoesNotWrite() {
        assertUnavailableOfferRejected("WITHDRAWN");
    }

    @Test
    void expiredOfferCannotBeSelectedAndDoesNotWrite() {
        assertUnavailableOfferRejected("EXPIRED");
    }

    @Test
    void matchedRequestCannotSelectDifferentOfferAndDoesNotWrite() {
        stubUser();
        Map<String, Object> request = requestRow();
        request.put("status", "MATCHED");
        request.put("selected_offer_id", 21L);
        stubSelectionQueries(request, selectionOffer("AVAILABLE"));
        UpdateCapture capture = captureUpdates();

        assertApiException(
                () -> service.selectOffer("Bearer user", "request-public-id", "offer-public-id"),
                HttpStatus.CONFLICT,
                "CONFLICT_STATE"
        );

        assertThat(capture.calls()).isEmpty();
    }

    @Test
    void completedRequestCannotSelectOfferAndDoesNotWrite() {
        stubUser();
        Map<String, Object> request = requestRow();
        request.put("status", "COMPLETED");
        stubSelectionQueries(request, selectionOffer("AVAILABLE"));
        UpdateCapture capture = captureUpdates();

        assertApiException(
                () -> service.selectOffer("Bearer user", "request-public-id", "offer-public-id"),
                HttpStatus.CONFLICT,
                "CONFLICT_STATE"
        );

        assertThat(capture.calls()).isEmpty();
    }

    private static void assertOffer(Map<String, Object> response) {
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> offers = (List<Map<String, Object>>) response.get("offers");

        assertThat(offers).hasSize(1);
        assertThat(offers.getFirst())
                .containsEntry("warrantyDays", 90)
                .containsEntry("message", "안정성 테스트 포함")
                .containsEntry("adminNote", "관리자 확인 메모")
                .containsEntry("confirmedPartsPrice", 1_000L)
                .containsEntry("finalPrice", 74_000L);
        assertThat(offers.getFirst().get("message")).isNotEqualTo(offers.getFirst().get("adminNote"));
        assertThat(offers.getFirst()).doesNotContainKey("note");
    }

    private static Map<String, Object> requestRow() {
        Map<String, Object> row = new HashMap<>();
        row.put("id", 10L);
        row.put("public_id_text", "request-public-id");
        row.put("request_no", "ASM-TEST");
        row.put("status", "OFFERED");
        row.put("service_type", "FULL_SERVICE");
        row.put("region", "서울");
        row.put("delivery_method", "DELIVERY");
        row.put("estimated_parts_price", 1_000L);
        row.put("item_count", 1);
        row.put("as_policy_accepted", true);
        return row;
    }

    private static Map<String, Object> offerRow() {
        Map<String, Object> row = new HashMap<>();
        row.put("id", "offer-public-id");
        row.put("technician_public_id", "technician-public-id");
        row.put("technician_snapshot", Map.of(
                "displayName", "테스트 기사",
                "initials", "테",
                "providerType", "EXTERNAL",
                "verificationStatus", "APPROVED"
        ));
        row.put("provider_type", "EXTERNAL");
        row.put("verification_status", "APPROVED");
        row.put("status", "AVAILABLE");
        row.put("confirmed_parts_price", 1_000L);
        row.put("assembly_fee", 70_000L);
        row.put("delivery_fee", 3_000L);
        row.put("final_price", 74_000L);
        row.put("lead_time_days", 2);
        row.put("stock_status", "재고 확인");
        row.put("warranty_days", 90);
        row.put("proposal_message", "안정성 테스트 포함");
        row.put("admin_note", "관리자 확인 메모");
        return row;
    }

    private UpdateCapture captureUpdates() {
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object[]> params = ArgumentCaptor.forClass(Object[].class);
        when(jdbcTemplate.update(sql.capture(), params.capture())).thenReturn(1);
        return new UpdateCapture(sql, params);
    }

    private void stubSelectionQueries(Map<String, Object> request, Map<String, Object> offer) {
        stubSelectionQueries(request, offer, null);
    }

    private void stubSelectionQueries(
            Map<String, Object> request,
            Map<String, Object> offer,
            Map<String, Object> payment
    ) {
        when(jdbcTemplate.queryForList(anyString(), any(Object[].class))).thenAnswer(invocation -> {
            String sql = invocation.getArgument(0);
            if (sql.contains("SELECT id FROM assembly_requests WHERE public_id") && sql.contains("FOR UPDATE")) {
                return List.of(Map.of("id", 10L));
            }
            if (sql.contains("SELECT ar.*, ar.public_id::text AS public_id_text")) {
                return List.of(request);
            }
            if (sql.contains("SELECT *, id AS internal_id FROM assembly_offers")) {
                return offer == null ? List.of() : List.of(offer);
            }
            if (sql.contains("FROM assembly_payments WHERE assembly_request_id")) {
                return payment == null ? List.of() : List.of(payment);
            }
            if (sql.contains("FROM assembly_payment_attempts")) {
                return List.of();
            }
            if (sql.contains("FROM assembly_request_items WHERE assembly_request_id")
                    || sql.contains("FROM assembly_offers ao JOIN technicians")
                    || sql.contains("FROM assembly_request_status_history")) {
                return List.of();
            }
            throw new AssertionError("예상하지 않은 선택 조회 SQL: " + sql);
        });
    }

    private void stubUser() {
        when(currentUserService.requireUser("Bearer user")).thenReturn(new CurrentUserService.CurrentUser(
                2L, "user-public-id", "user@example.com", "User", "USER", null
        ));
    }

    private void assertUnavailableOfferRejected(String status) {
        stubUser();
        stubSelectionQueries(requestRow(), selectionOffer(status));
        UpdateCapture capture = captureUpdates();

        assertApiException(
                () -> service.selectOffer("Bearer user", "request-public-id", "offer-public-id"),
                HttpStatus.CONFLICT,
                "CONFLICT_STATE"
        );

        assertThat(capture.calls()).isEmpty();
    }

    private static void assertApiException(Runnable action, HttpStatus status, String code) {
        assertThatThrownBy(action::run)
                .isInstanceOf(ApiException.class)
                .satisfies(error -> {
                    ApiException apiException = (ApiException) error;
                    assertThat(apiException.status()).isEqualTo(status);
                    assertThat(apiException.code()).isEqualTo(code);
                });
    }

    private void stubAdminOfferQueries(
            Map<String, Object> request,
            Map<String, Object> technician,
            Map<String, Object> offer
    ) {
        when(jdbcTemplate.queryForList(anyString(), any(Object[].class))).thenAnswer(invocation -> {
            String sql = invocation.getArgument(0);
            if (sql.contains("SELECT id FROM assembly_requests WHERE public_id") && sql.contains("FOR UPDATE")) {
                return List.of(Map.of("id", 10L));
            }
            if (sql.contains("SELECT ar.*, ar.public_id::text AS public_id_text")) {
                return List.of(request);
            }
            if (sql.contains("FROM technicians WHERE public_id")) {
                return List.of(technician);
            }
            if (sql.contains("SELECT *, id AS internal_id FROM assembly_offers")) {
                return offer == null ? List.of() : List.of(offer);
            }
            if (sql.contains("FROM assembly_offers WHERE id = ?")) {
                return offer == null ? List.of() : List.of(offer);
            }
            if (sql.contains("FROM assembly_payments WHERE assembly_request_id")
                    || sql.contains("FROM assembly_request_items WHERE assembly_request_id")
                    || sql.contains("FROM assembly_offers ao JOIN technicians")
                    || sql.contains("FROM assembly_request_status_history")) {
                return List.of();
            }
            throw new AssertionError("예상하지 않은 관리자 제안 조회 SQL: " + sql);
        });
    }

    private static Map<String, Object> technicianRow(String providerType) {
        Map<String, Object> row = new HashMap<>();
        row.put("id", 7L);
        row.put("public_id", "technician-public-id");
        row.put("display_name", "테스트 기사");
        row.put("initials", "테");
        row.put("status", "ACTIVE");
        row.put("provider_type", providerType);
        row.put("verification_status", "APPROVED");
        row.put("standard_as_accepted", true);
        row.put("service_regions", List.of("서울"));
        row.put("service_types", List.of("FULL_SERVICE", "ASSEMBLY_ONLY"));
        row.put("specialties", List.of("안정성 검증"));
        row.put("assembly_fee", 50_000L);
        row.put("delivery_fee", 12_000L);
        row.put("parts_price_adjustment", 25_000L);
        row.put("lead_time_days", 2);
        return row;
    }

    private static Map<String, Object> selectionOffer(String status) {
        Map<String, Object> row = new HashMap<>();
        row.put("internal_id", 20L);
        row.put("id", 20L);
        row.put("public_id", "offer-public-id");
        row.put("status", status);
        row.put("confirmed_parts_price", 123L);
        row.put("assembly_fee", 50_000L);
        row.put("delivery_fee", 456L);
        row.put("final_price", 579L);
        row.put("lead_time_days", 2);
        row.put("stock_status", "재고 확인");
        return row;
    }

    private static Map<String, Object> paymentRow(String status) {
        Map<String, Object> row = new HashMap<>();
        row.put("internal_id", 30L);
        row.put("id", "payment-public-id");
        row.put("amount", 1_900_000L);
        row.put("paid_amount", 1_900_000L);
        row.put("currency", "KRW");
        row.put("provider", "TOSS");
        row.put("method", "CARD");
        row.put("status", status);
        return row;
    }

    private record SqlCall(String sql, Object[] params) {}

    private record UpdateCapture(
            ArgumentCaptor<String> sql,
            ArgumentCaptor<Object[]> params
    ) {
        List<SqlCall> calls() {
            java.util.ArrayList<SqlCall> result = new java.util.ArrayList<>();
            for (int index = 0; index < sql.getAllValues().size(); index += 1) {
                result.add(new SqlCall(sql.getAllValues().get(index), params.getAllValues().get(index)));
            }
            return result;
        }

        SqlCall find(String fragment) {
            return calls().stream()
                    .filter(call -> call.sql().contains(fragment))
                    .findFirst()
                    .orElseThrow(() -> new AssertionError("SQL을 찾을 수 없습니다: " + fragment));
        }

        int indexOf(String fragment) {
            for (int index = 0; index < calls().size(); index += 1) {
                if (calls().get(index).sql().contains(fragment)) return index;
            }
            throw new AssertionError("SQL을 찾을 수 없습니다: " + fragment);
        }
    }
}

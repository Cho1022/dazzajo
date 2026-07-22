package com.buildgraph.prototype.assembly;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.buildgraph.prototype.common.ApiException;
import com.buildgraph.prototype.user.CurrentUserService;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;

class TechnicianMarketplaceServiceTest {
    private final JdbcTemplate jdbcTemplate = mock(JdbcTemplate.class);
    private final CurrentUserService currentUserService = mock(CurrentUserService.class);
    private final TechnicianMarketplaceService service = new TechnicianMarketplaceService(jdbcTemplate, currentUserService);

    @Test
    void adminAccountCannotApplyAsExternalTechnician() {
        when(currentUserService.requireUser("Bearer admin")).thenReturn(new CurrentUserService.CurrentUser(
                1L, "admin-public-id", "admin@example.com", "Admin", "ADMIN", null));

        assertThatThrownBy(() -> service.apply("Bearer admin", Map.of()))
                .isInstanceOf(ApiException.class)
                .satisfies(error -> {
                    ApiException apiException = (ApiException) error;
                    org.assertj.core.api.Assertions.assertThat(apiException.status()).isEqualTo(HttpStatus.FORBIDDEN);
                    org.assertj.core.api.Assertions.assertThat(apiException.code()).isEqualTo("FORBIDDEN");
                });

        verifyNoInteractions(jdbcTemplate);
    }

    @Test
    void detailAccessAllowsTechnicianToReloadOwnAvailableOffer() {
        String condition = TechnicianMarketplaceService.detailAccessCondition();

        assertThat(condition)
                .contains("own_offer.id IS NOT NULL")
                .doesNotContain("own_offer.status = 'SELECTED'")
                .contains("own_offer.id IS NULL");
    }

    @Test
    void profileLookupReturnsEmptyForAUserWhoHasNotApplied() {
        when(currentUserService.requireUser("Bearer user")).thenReturn(new CurrentUserService.CurrentUser(
                2L, "user-public-id", "user@example.com", "User", "USER", null));

        assertThat(service.profileIfPresent("Bearer user")).isEmpty();
    }

    @Test
    void createOfferInputDefaultsWarrantyAndKeepsExistingPriceFields() {
        Object input = offerInput(baseCreateBody(), null);

        assertThat(inputValue(input, "confirmedPartsPrice")).isEqualTo(1_000L);
        assertThat(inputValue(input, "assemblyFee")).isEqualTo(70_000L);
        assertThat(inputValue(input, "deliveryFee")).isEqualTo(3_000L);
        assertThat(inputValue(input, "finalPrice")).isEqualTo(74_000L);
        assertThat(inputValue(input, "warrantyDays")).isEqualTo(0);
        assertThat(inputValue(input, "message")).isNull();
    }

    @Test
    void canonicalMessageWinsAndLegacyNoteIsOnlyAFallback() {
        Map<String, Object> canonical = baseCreateBody();
        canonical.put("warrantyDays", 30);
        canonical.put("message", "  정품 부품 검수 후 조립합니다.  ");
        canonical.put("note", "기존 메모");

        Object canonicalInput = offerInput(canonical, null);
        assertThat(inputValue(canonicalInput, "warrantyDays")).isEqualTo(30);
        assertThat(inputValue(canonicalInput, "message")).isEqualTo("정품 부품 검수 후 조립합니다.");

        Map<String, Object> fallback = baseCreateBody();
        fallback.put("note", "  호환 메모  ");
        assertThat(inputValue(offerInput(fallback, null), "message")).isEqualTo("호환 메모");

        Map<String, Object> explicitBlank = baseCreateBody();
        explicitBlank.put("message", "   ");
        explicitBlank.put("note", "사용하면 안 되는 메모");
        assertThat(inputValue(offerInput(explicitBlank, null), "message")).isNull();
    }

    @Test
    void warrantyDaysAcceptsOnlySupportedJsonIntegerTypesForCreateAndUpdate() {
        Object[][] valid = {
                {(byte) 0, 0},
                {(short) 30, 30},
                {365, 365},
                {30L, 30}
        };
        for (Object[] example : valid) {
            Map<String, Object> create = baseCreateBody();
            create.put("warrantyDays", example[0]);
            assertThat(inputValue(offerInput(create, null), "warrantyDays")).isEqualTo(example[1]);

            Map<String, Object> update = new HashMap<>();
            update.put("warrantyDays", example[0]);
            assertThat(inputValue(offerInput(update, offerRow()), "warrantyDays")).isEqualTo(example[1]);
        }
    }

    @Test
    void warrantyDaysRejectsNonJsonIntegerNullAndOutOfRangeForCreateAndUpdate() {
        for (Object invalid : new Object[]{
                "30", 30.0f, 30.0d, 30.5d, new BigDecimal("30"), new BigInteger("30"),
                true, List.of(30), new Object(), null, -1, 366
        }) {
            Map<String, Object> body = baseCreateBody();
            body.put("warrantyDays", invalid);

            assertThatThrownBy(() -> offerInput(body, null))
                    .isInstanceOf(ApiException.class)
                    .satisfies(error -> assertThat(((ApiException) error).status()).isEqualTo(HttpStatus.BAD_REQUEST));

            Map<String, Object> update = new HashMap<>();
            update.put("warrantyDays", invalid);
            assertThatThrownBy(() -> offerInput(update, offerRow()))
                    .isInstanceOf(ApiException.class)
                    .satisfies(error -> assertThat(((ApiException) error).status()).isEqualTo(HttpStatus.BAD_REQUEST));
        }
    }

    @Test
    void messageAcceptsFiveHundredCharactersAndRejectsFiveHundredOne() {
        Map<String, Object> accepted = baseCreateBody();
        accepted.put("message", "가".repeat(500));
        assertThat(inputValue(offerInput(accepted, null), "message")).isEqualTo("가".repeat(500));

        Map<String, Object> rejected = baseCreateBody();
        rejected.put("message", "가".repeat(501));
        assertThatThrownBy(() -> offerInput(rejected, null))
                .isInstanceOf(ApiException.class)
                .satisfies(error -> assertThat(((ApiException) error).status()).isEqualTo(HttpStatus.BAD_REQUEST));
    }

    @Test
    void updateOfferInputPreservesOmittedFieldsAndClearsExplicitMessage() {
        Map<String, Object> existing = offerRow();

        Object unchanged = offerInput(Map.of(), existing);
        assertThat(inputValue(unchanged, "warrantyDays")).isEqualTo(45);
        assertThat(inputValue(unchanged, "message")).isEqualTo("저장된 제안");

        Map<String, Object> cleared = new HashMap<>();
        cleared.put("message", null);
        cleared.put("note", "fallback 금지");
        assertThat(inputValue(offerInput(cleared, existing), "message")).isNull();

        Map<String, Object> fallback = new HashMap<>();
        fallback.put("note", "  수정 호환 메모  ");
        assertThat(inputValue(offerInput(fallback, existing), "message")).isEqualTo("수정 호환 메모");

        Map<String, Object> nullWarranty = new HashMap<>();
        nullWarranty.put("warrantyDays", null);
        assertThatThrownBy(() -> offerInput(nullWarranty, existing)).isInstanceOf(ApiException.class);
    }

    @Test
    void createOfferBindsCanonicalProposalFieldsWithoutChangingExistingPriceOrder() {
        Map<String, Object> body = baseCreateBody();
        body.put("warrantyDays", 30);
        body.put("message", "  정품 부품 검수 후 조립합니다.  ");
        body.put("note", "사용하면 안 되는 메모");

        SqlCall insert = runCreateOffer(body);

        assertThat(insert.sql())
                .contains("INSERT INTO assembly_offers")
                .contains("warranty_days")
                .contains("proposal_message");
        assertThat(insert.params()).hasSize(12);
        assertThat(insert.params()[0]).isEqualTo(10L);
        assertThat(insert.params()[1]).isEqualTo(7L);
        assertThat(insert.params()[2]).isInstanceOf(String.class);
        assertThat(insert.params()[3]).isEqualTo(1_000L);
        assertThat(insert.params()[4]).isEqualTo(70_000L);
        assertThat(insert.params()[5]).isEqualTo(3_000L);
        assertThat(insert.params()[6]).isEqualTo(74_000L);
        assertThat(insert.params()[7]).isEqualTo(2);
        assertThat(insert.params()[8]).isEqualTo("재고 확인");
        assertThat(insert.params()[9]).isEqualTo(30);
        assertThat(insert.params()[10]).isEqualTo("정품 부품 검수 후 조립합니다.");
        assertThat(insert.params()[11]).isEqualTo(2L);
    }

    @Test
    void createOfferBindsLegacyFallbackAndCanonicalNullSemantics() {
        Map<String, Object> fallback = baseCreateBody();
        fallback.put("note", "  호환 메모  ");
        assertThat(runCreateOffer(fallback).params()[10]).isEqualTo("호환 메모");

        Map<String, Object> canonical = baseCreateBody();
        canonical.put("message", "  canonical 제안  ");
        canonical.put("note", "호환 메모");
        assertThat(runCreateOffer(canonical).params()[10]).isEqualTo("canonical 제안");

        Map<String, Object> explicitNull = baseCreateBody();
        explicitNull.put("message", null);
        explicitNull.put("note", "fallback 금지");
        assertThat(runCreateOffer(explicitNull).params()[10]).isNull();

        Map<String, Object> blank = baseCreateBody();
        blank.put("message", "   ");
        assertThat(runCreateOffer(blank).params()[10]).isNull();
    }

    @Test
    void updateOfferBindsPatchValuesAndPreservesOmittedExistingValues() {
        Map<String, Object> canonical = new HashMap<>();
        canonical.put("warrantyDays", 90);
        canonical.put("message", "  안정성 테스트 포함  ");
        canonical.put("note", "fallback 금지");
        SqlCall update = runUpdateOffer(canonical);

        assertThat(update.sql())
                .contains("warranty_days = ?")
                .contains("proposal_message = ?");
        assertThat(update.params()).containsExactly(
                1_000L, 70_000L, 3_000L, 74_000L, 2, "재고 확인", 90, "안정성 테스트 포함", 20L
        );

        Map<String, Object> explicitNull = new HashMap<>();
        explicitNull.put("message", null);
        explicitNull.put("note", "fallback 금지");
        assertThat(runUpdateOffer(explicitNull).params()[7]).isNull();

        assertThat(runUpdateOffer(Map.of("message", "   ")).params()[7]).isNull();
        assertThat(runUpdateOffer(Map.of("note", "  수정 호환 메모  ")).params()[7]).isEqualTo("수정 호환 메모");

        SqlCall omitted = runUpdateOffer(Map.of());
        assertThat(omitted.params()[6]).isEqualTo(45);
        assertThat(omitted.params()[7]).isEqualTo("저장된 제안");
    }

    @Test
    void withdrawOfferPreservesProposalMessageAndRecordsReasonSeparately() {
        Map<String, Object> withdrawn = offerRow();
        withdrawn.put("status", "WITHDRAWN");
        withdrawn.put("admin_note", "일정 불가");
        UpdateCapture capture = stubOfferWorkflow(offerRow(), withdrawn);
        when(jdbcTemplate.queryForObject(
                contains("SELECT count(*) FROM assembly_offers WHERE assembly_request_id"),
                eq(Integer.class),
                any(Object[].class)
        )).thenReturn(1);

        Map<String, Object> response = service.withdrawOffer("Bearer user", "offer-public-id", Map.of("reason", "일정 불가"));
        SqlCall withdrawal = capture.find("UPDATE assembly_offers SET status = 'WITHDRAWN'");
        SqlCall activity = capture.find("INSERT INTO assembly_offer_activities");

        assertThat(withdrawal.sql())
                .contains("admin_note = ?")
                .doesNotContain("proposal_message");
        assertThat(withdrawal.params()).containsExactly("일정 불가", 20L);
        assertThat(activity.params()[3].toString())
                .contains("\"message\":\"저장된 제안\"")
                .contains("\"withdrawalReason\":\"일정 불가\"");
        assertThat(response)
                .containsEntry("warrantyDays", 45)
                .containsEntry("message", "저장된 제안")
                .containsEntry("note", "저장된 제안")
                .doesNotContainKey("adminNote");
    }

    @Test
    void requestDetailMapsOnlyTheTechniciansOwnProposalFields() {
        stubOfferWorkflow(offerRow(), offerRow());

        Map<String, Object> response = service.requestDetail("Bearer user", "request-public-id");
        @SuppressWarnings("unchecked")
        Map<String, Object> ownOffer = (Map<String, Object>) response.get("ownOffer");

        assertThat(ownOffer)
                .containsEntry("warrantyDays", 45)
                .containsEntry("message", "저장된 제안")
                .containsEntry("note", "저장된 제안")
                .containsEntry("confirmedPartsPrice", 1_000L)
                .containsEntry("finalPrice", 74_000L)
                .doesNotContainKey("adminNote");
        assertThat(response).doesNotContainKey("offers");
    }

    @Test
    void activityHelperStillSerializesCanonicalProposalFields() {
        ReflectionTestUtils.invokeMethod(service, "addOfferActivity", 10L, 2L, "UPDATED", offerRow(), null);

        verify(jdbcTemplate).update(
                contains("INSERT INTO assembly_offer_activities"),
                eq(10L),
                eq(2L),
                eq("UPDATED"),
                argThat((String json) -> json.contains("\"warrantyDays\":45")
                        && json.contains("\"message\":\"저장된 제안\""))
        );
    }

    @Test
    void openRequestConditionKeepsSelfBidAndExternalOfferLimitGuards() {
        String condition = ReflectionTestUtils.invokeMethod(service, "openCondition");

        assertThat(condition)
                .contains("ar.user_id <> ?")
                .contains("ext_tech.provider_type = 'EXTERNAL'")
                .contains("< 3");
    }

    private Object offerInput(Map<String, Object> body, Map<String, Object> existing) {
        return ReflectionTestUtils.invokeMethod(service, "offerInput", body, existing);
    }

    private static Object inputValue(Object input, String accessor) {
        return ReflectionTestUtils.invokeMethod(input, accessor);
    }

    private SqlCall runCreateOffer(Map<String, Object> body) {
        UpdateCapture capture = stubOfferWorkflow(offerRow(), offerRow());
        when(jdbcTemplate.queryForObject(
                contains("technician_id = ?"), eq(Integer.class), any(Object[].class)
        )).thenReturn(0);
        when(jdbcTemplate.queryForObject(
                contains("JOIN technicians t"), eq(Integer.class), any(Object[].class)
        )).thenReturn(0);
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object[]> params = ArgumentCaptor.forClass(Object[].class);
        when(jdbcTemplate.queryForObject(sql.capture(), eq(String.class), params.capture()))
                .thenReturn("offer-public-id");

        service.createOffer("Bearer user", "request-public-id", body);

        assertThat(capture.calls()).isNotEmpty();
        int insertIndex = -1;
        for (int index = 0; index < sql.getAllValues().size(); index += 1) {
            if (sql.getAllValues().get(index).contains("INSERT INTO assembly_offers")) {
                insertIndex = index;
                break;
            }
        }
        assertThat(insertIndex).as("기사 제안 INSERT가 실행되어야 한다").isNotNegative();
        return new SqlCall(sql.getAllValues().get(insertIndex), params.getAllValues().get(insertIndex));
    }

    private SqlCall runUpdateOffer(Map<String, Object> body) {
        UpdateCapture capture = stubOfferWorkflow(offerRow(), offerRow());

        service.updateOffer("Bearer user", "offer-public-id", body);

        return capture.find("UPDATE assembly_offers SET confirmed_parts_price");
    }

    private UpdateCapture stubOfferWorkflow(Map<String, Object> before, Map<String, Object> after) {
        reset(jdbcTemplate, currentUserService);
        when(currentUserService.requireUser("Bearer user")).thenReturn(new CurrentUserService.CurrentUser(
                2L, "user-public-id", "user@example.com", "User", "USER", null
        ));
        when(jdbcTemplate.queryForList(contains("FROM technicians"), any(Object[].class)))
                .thenReturn(List.of(technicianRow()));
        when(jdbcTemplate.queryForList(
                contains("SELECT * FROM assembly_requests WHERE public_id"), any(Object[].class)
        )).thenReturn(List.of(requestRow()));
        when(jdbcTemplate.queryForList(
                contains("SELECT * FROM assembly_requests WHERE id = ? FOR UPDATE"), any(Object[].class)
        )).thenReturn(List.of(requestRow()));
        when(jdbcTemplate.queryForList(
                contains("WHERE ar.public_id = ?::uuid"), any(Object[].class)
        )).thenReturn(List.of(requestRow()));
        when(jdbcTemplate.queryForList(
                contains("WHERE ar.id = ?"), any(Object[].class)
        )).thenReturn(List.of(requestRow()));
        when(jdbcTemplate.queryForList(
                contains("FROM assembly_offers WHERE public_id"), any(Object[].class)
        )).thenReturn(List.of(before), List.of(after));
        when(jdbcTemplate.queryForList(
                contains("FROM assembly_offers WHERE assembly_request_id"), any(Object[].class)
        )).thenReturn(List.of(after));
        when(jdbcTemplate.queryForList(
                contains("FROM assembly_payments WHERE assembly_request_id"), any(Object[].class)
        )).thenReturn(List.of());
        when(jdbcTemplate.queryForList(
                contains("FROM assembly_request_items WHERE assembly_request_id"), any(Object[].class)
        )).thenReturn(List.of());

        ArgumentCaptor<String> updateSql = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object[]> updateParams = ArgumentCaptor.forClass(Object[].class);
        when(jdbcTemplate.update(updateSql.capture(), updateParams.capture())).thenReturn(1);
        return new UpdateCapture(updateSql, updateParams);
    }

    private static Map<String, Object> technicianRow() {
        Map<String, Object> row = new HashMap<>();
        row.put("id", 7L);
        row.put("public_id", "technician-public-id");
        row.put("status", "ACTIVE");
        row.put("provider_type", "EXTERNAL");
        row.put("verification_status", "APPROVED");
        row.put("standard_as_accepted", true);
        row.put("service_regions", List.of("서울"));
        row.put("service_types", List.of("FULL_SERVICE"));
        row.put("specialties", List.of("안정성 검증"));
        row.put("display_name", "테스트 기사");
        row.put("initials", "테");
        return row;
    }

    private static Map<String, Object> requestRow() {
        Map<String, Object> row = new HashMap<>();
        row.put("id", 10L);
        row.put("public_id_text", "request-public-id");
        row.put("user_id", 99L);
        row.put("request_no", "ASM-TEST");
        row.put("status", "OFFERED");
        row.put("service_type", "FULL_SERVICE");
        row.put("region", "서울");
        row.put("delivery_method", "DELIVERY");
        row.put("estimated_parts_price", 1_000L);
        row.put("item_count", 1);
        return row;
    }

    private static Map<String, Object> baseCreateBody() {
        return new HashMap<>(Map.of(
                "confirmedPartsPrice", 1_000,
                "assemblyFee", 70_000,
                "deliveryFee", 3_000,
                "leadTimeDays", 2,
                "stockStatus", "재고 확인"
        ));
    }

    private static Map<String, Object> offerRow() {
        Map<String, Object> row = baseCreateBody();
        row.put("public_id", "offer-1");
        row.put("public_id_text", "offer-public-id");
        row.put("id", 20L);
        row.put("assembly_request_id", 10L);
        row.put("status", "AVAILABLE");
        row.put("confirmed_parts_price", 1_000L);
        row.put("assembly_fee", 70_000L);
        row.put("delivery_fee", 3_000L);
        row.put("final_price", 74_000L);
        row.put("lead_time_days", 2);
        row.put("stock_status", "재고 확인");
        row.put("warranty_days", 45);
        row.put("proposal_message", "저장된 제안");
        row.put("admin_note", "관리자 메모");
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
    }
}

package com.buildgraph.prototype.assembly;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.buildgraph.prototype.build.BuildGraphService;
import com.buildgraph.prototype.quote.QuoteDraftQueryService;
import com.buildgraph.prototype.user.CurrentUserService;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

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
}

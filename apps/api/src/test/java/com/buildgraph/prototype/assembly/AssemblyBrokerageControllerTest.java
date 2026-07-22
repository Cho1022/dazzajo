package com.buildgraph.prototype.assembly;

import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.buildgraph.prototype.common.ApiException;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(AssemblyBrokerageController.class)
class AssemblyBrokerageControllerTest {
    private static final String USER_TOKEN = "Bearer jwt-user-token";
    private static final String ADMIN_TOKEN = "Bearer jwt-admin-token";

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private AssemblyBrokerageService service;

    @MockitoBean
    private TechnicianProfileImageService profileImageService;

    @Test
    void createRequiresAuthenticatedUser() throws Exception {
        when(service.create(eq(null), eq("request-key"), anyMap()))
                .thenThrow(new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "로그인이 필요합니다."));

        mockMvc.perform(post("/api/assembly-requests")
                        .header("Idempotency-Key", "request-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    }

    @Test
    void createForwardsIdempotencyKeyAndRequest() throws Exception {
        when(service.create(eq(USER_TOKEN), eq("request-key"), anyMap())).thenReturn(Map.of(
                "id", "assembly-1", "requestNo", "ASM-20260711-TEST", "status", "OFFERED"
        ));

        mockMvc.perform(post("/api/assembly-requests")
                        .header("Authorization", USER_TOKEN)
                        .header("Idempotency-Key", "request-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"serviceType":"FULL_SERVICE","region":"서울","preferredDate":"2099-07-20","deliveryMethod":"DELIVERY","asPolicyAccepted":true}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("assembly-1"))
                .andExpect(jsonPath("$.status").value("OFFERED"));

        verify(service).create(eq(USER_TOKEN), eq("request-key"), anyMap());
    }

    @Test
    void userCanSelectOfferAndRetiredVirtualPaymentRouteIsPreserved() throws Exception {
        when(service.selectOffer(USER_TOKEN, "assembly-1", "offer-1"))
                .thenReturn(Map.of("id", "assembly-1", "status", "MATCHED"));
        when(service.confirmVirtualPayment(USER_TOKEN, "assembly-1"))
                .thenThrow(new ApiException(HttpStatus.GONE, "PAYMENT_ENDPOINT_RETIRED", "결제 시도 API를 사용해 주세요."));

        mockMvc.perform(post("/api/assembly-requests/assembly-1/offers/offer-1/select").header("Authorization", USER_TOKEN))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("MATCHED"));
        mockMvc.perform(post("/api/assembly-requests/assembly-1/payments/confirm-virtual").header("Authorization", USER_TOKEN))
                .andExpect(status().isGone()).andExpect(jsonPath("$.code").value("PAYMENT_ENDPOINT_RETIRED"));
    }

    @Test
    void userCanListAndCancelOwnedRequests() throws Exception {
        when(service.listForUser(USER_TOKEN, 0, 20)).thenReturn(Map.of("items", List.of(), "page", 0, "size", 20, "total", 0));
        when(service.cancelForUser(eq(USER_TOKEN), eq("assembly-1"), anyMap())).thenReturn(Map.of("id", "assembly-1", "status", "CANCELLED"));

        mockMvc.perform(get("/api/assembly-requests").header("Authorization", USER_TOKEN).param("page", "0").param("size", "20"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.total").value(0));
        mockMvc.perform(post("/api/assembly-requests/assembly-1/cancel")
                        .header("Authorization", USER_TOKEN).contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"일정 변경\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("CANCELLED"));
    }

    @Test
    void ownerAndAdminOfferResponsesExposeProposalFieldsWithoutReplacingAdminNote() throws Exception {
        Map<String, Object> offer = Map.of(
                "id", "offer-1",
                "warrantyDays", 30,
                "message", "정품 부품 검수 후 조립합니다.",
                "adminNote", "관리자 전용 메모"
        );
        Map<String, Object> response = Map.of("id", "assembly-1", "offers", List.of(offer));
        when(service.detailForUser(USER_TOKEN, "assembly-1")).thenReturn(response);
        when(service.adminRequestDetail(ADMIN_TOKEN, "assembly-1")).thenReturn(response);

        mockMvc.perform(get("/api/assembly-requests/assembly-1").header("Authorization", USER_TOKEN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.offers[0].warrantyDays").value(30))
                .andExpect(jsonPath("$.offers[0].message").value("정품 부품 검수 후 조립합니다."))
                .andExpect(jsonPath("$.offers[0].adminNote").value("관리자 전용 메모"));
        mockMvc.perform(get("/api/admin/assembly-requests/assembly-1").header("Authorization", ADMIN_TOKEN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.offers[0].warrantyDays").value(30))
                .andExpect(jsonPath("$.offers[0].message").value("정품 부품 검수 후 조립합니다."))
                .andExpect(jsonPath("$.offers[0].adminNote").value("관리자 전용 메모"));
    }

    @Test
    void adminTechnicianCrudRoutesAreWired() throws Exception {
        when(service.createTechnician(eq(ADMIN_TOKEN), anyMap())).thenReturn(Map.of("id", "tech-1", "displayName", "테스트 기사"));
        when(service.deleteTechnician(ADMIN_TOKEN, "tech-1")).thenReturn(Map.of("id", "tech-1", "deleted", true));
        when(service.restoreTechnician(ADMIN_TOKEN, "tech-1")).thenReturn(Map.of("id", "tech-1", "status", "INACTIVE"));
        when(service.approveTechnician(ADMIN_TOKEN, "tech-1")).thenReturn(Map.of("id", "tech-1", "verificationStatus", "APPROVED"));
        when(service.rejectTechnician(eq(ADMIN_TOKEN), eq("tech-1"), anyMap())).thenReturn(Map.of("id", "tech-1", "verificationStatus", "REJECTED"));

        mockMvc.perform(post("/api/admin/technicians").header("Authorization", ADMIN_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.id").value("tech-1"));
        mockMvc.perform(delete("/api/admin/technicians/tech-1").header("Authorization", ADMIN_TOKEN))
                .andExpect(status().isOk()).andExpect(jsonPath("$.deleted").value(true));
        mockMvc.perform(post("/api/admin/technicians/tech-1/restore").header("Authorization", ADMIN_TOKEN))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("INACTIVE"));
        mockMvc.perform(post("/api/admin/technicians/tech-1/approve").header("Authorization", ADMIN_TOKEN))
                .andExpect(status().isOk()).andExpect(jsonPath("$.verificationStatus").value("APPROVED"));
        mockMvc.perform(post("/api/admin/technicians/tech-1/reject").header("Authorization", ADMIN_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"정보 보완\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.verificationStatus").value("REJECTED"));
    }

    @Test
    void adminCanManageRequestStatusAndAvailableOffers() throws Exception {
        when(service.updateAdminRequestStatus(eq(ADMIN_TOKEN), eq("assembly-1"), anyMap())).thenReturn(Map.of("id", "assembly-1", "status", "CONFIRMED"));
        when(service.updateAdminOffer(eq(ADMIN_TOKEN), eq("assembly-1"), eq("offer-1"), anyMap())).thenReturn(Map.of("id", "assembly-1"));
        when(service.withdrawAdminOffer(eq(ADMIN_TOKEN), eq("assembly-1"), eq("offer-1"), anyMap())).thenReturn(Map.of("id", "assembly-1"));

        mockMvc.perform(patch("/api/admin/assembly-requests/assembly-1/status").header("Authorization", ADMIN_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"CONFIRMED\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("CONFIRMED"));
        mockMvc.perform(patch("/api/admin/assembly-requests/assembly-1/offers/offer-1").header("Authorization", ADMIN_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"assemblyFee\":70000}"))
                .andExpect(status().isOk());
        mockMvc.perform(post("/api/admin/assembly-requests/assembly-1/offers/offer-1/withdraw").header("Authorization", ADMIN_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"일정 불가\"}"))
                .andExpect(status().isOk());
    }
}

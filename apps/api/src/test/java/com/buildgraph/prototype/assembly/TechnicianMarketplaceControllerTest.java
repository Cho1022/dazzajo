package com.buildgraph.prototype.assembly;

import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(TechnicianMarketplaceController.class)
class TechnicianMarketplaceControllerTest {
    private static final String TOKEN = "Bearer jwt-technician-user";

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private TechnicianMarketplaceService service;

    @MockitoBean
    private TechnicianProfileImageService profileImageService;

    @Test
    void applicationAndProfileRoutesAreWired() throws Exception {
        when(service.apply(eq(TOKEN), anyMap())).thenReturn(Map.of("id", "tech-1", "verificationStatus", "PENDING"));
        when(service.profileIfPresent(TOKEN)).thenReturn(Optional.of(Map.of("id", "tech-1", "verificationStatus", "APPROVED")));
        when(service.updateProfile(eq(TOKEN), anyMap())).thenReturn(Map.of("id", "tech-1", "displayName", "수정 기사"));

        mockMvc.perform(post("/api/technician/applications").header("Authorization", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.verificationStatus").value("PENDING"));
        mockMvc.perform(get("/api/technician/profile").header("Authorization", TOKEN))
                .andExpect(status().isOk()).andExpect(jsonPath("$.verificationStatus").value("APPROVED"));
        mockMvc.perform(patch("/api/technician/profile").header("Authorization", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.displayName").value("수정 기사"));
    }

    @Test
    void missingTechnicianProfileIsANormalNoContentResponse() throws Exception {
        when(service.profileIfPresent(TOKEN)).thenReturn(Optional.empty());

        mockMvc.perform(get("/api/technician/profile").header("Authorization", TOKEN))
                .andExpect(status().isNoContent());
    }

    @Test
    void requestAndOfferRoutesAreWired() throws Exception {
        when(service.listRequests(TOKEN, "OPEN", 0, 20)).thenReturn(Map.of("items", List.of(), "page", 0, "size", 20, "total", 0));
        when(service.requestDetail(TOKEN, "request-1")).thenReturn(Map.of("id", "request-1", "contact", Map.of()));
        when(service.createOffer(eq(TOKEN), eq("request-1"), anyMap())).thenReturn(Map.of(
                "id", "request-1",
                "ownOffer", Map.of(
                        "status", "AVAILABLE",
                        "warrantyDays", 30,
                        "message", "정품 부품 검수 후 조립합니다.",
                        "note", "정품 부품 검수 후 조립합니다."
                )
        ));
        when(service.updateOffer(eq(TOKEN), eq("offer-1"), anyMap())).thenReturn(Map.of(
                "id", "offer-1",
                "status", "AVAILABLE",
                "warrantyDays", 45,
                "message", "보증 기간을 연장합니다.",
                "note", "보증 기간을 연장합니다."
        ));
        when(service.withdrawOffer(eq(TOKEN), eq("offer-1"), anyMap())).thenReturn(Map.of("id", "offer-1", "status", "WITHDRAWN"));

        mockMvc.perform(get("/api/technician/assembly-requests").header("Authorization", TOKEN)
                        .param("scope", "OPEN").param("page", "0").param("size", "20"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.total").value(0));
        mockMvc.perform(get("/api/technician/assembly-requests/request-1").header("Authorization", TOKEN))
                .andExpect(status().isOk()).andExpect(jsonPath("$.id").value("request-1"));
        mockMvc.perform(post("/api/technician/assembly-requests/request-1/offers").header("Authorization", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"warrantyDays\":30,\"message\":\"정품 부품 검수 후 조립합니다.\",\"note\":\"기존 메모\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ownOffer.status").value("AVAILABLE"))
                .andExpect(jsonPath("$.ownOffer.warrantyDays").value(30))
                .andExpect(jsonPath("$.ownOffer.message").value("정품 부품 검수 후 조립합니다."))
                .andExpect(jsonPath("$.ownOffer.note").value("정품 부품 검수 후 조립합니다."));
        mockMvc.perform(patch("/api/technician/offers/offer-1").header("Authorization", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"warrantyDays\":45,\"message\":\"보증 기간을 연장합니다.\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("AVAILABLE"))
                .andExpect(jsonPath("$.warrantyDays").value(45))
                .andExpect(jsonPath("$.message").value("보증 기간을 연장합니다."));
        mockMvc.perform(post("/api/technician/offers/offer-1/withdraw").header("Authorization", TOKEN)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"일정 불가\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("WITHDRAWN"));

        verify(service).createOffer(eq(TOKEN), eq("request-1"), argThat(body ->
                Integer.valueOf(30).equals(body.get("warrantyDays"))
                        && "정품 부품 검수 후 조립합니다.".equals(body.get("message"))
                        && "기존 메모".equals(body.get("note"))
        ));
    }
}

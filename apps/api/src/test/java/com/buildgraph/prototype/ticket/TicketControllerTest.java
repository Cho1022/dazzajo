package com.buildgraph.prototype.ticket;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.buildgraph.prototype.common.MockData;
import com.buildgraph.prototype.user.CurrentUserService;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(TicketController.class)
class TicketControllerTest {
    private static final String USER_TOKEN = "Bearer jwt-user-token";
    private static final CurrentUserService.CurrentUser USER = new CurrentUserService.CurrentUser(
            20L,
            "user-public-id",
            "user@example.com",
            "User",
            "USER",
            null
    );

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private TicketQueryService ticketQueryService;

    @MockitoBean
    private AsTicketDraftService asTicketDraftService;

    @MockitoBean
    private CurrentUserService currentUserService;

    @MockitoBean
    private SupportChatEventPublisher supportChatEventPublisher;

    @Test
    void userCanReadFinalAgentAsTicketStatus() throws Exception {
        when(currentUserService.requireUser(USER_TOKEN)).thenReturn(USER);
        when(ticketQueryService.ticket("ticket-public-id", USER)).thenReturn(MockData.map(
                "id", "ticket-public-id",
                "status", "OPEN",
                "symptom", "GPU temperature spike",
                "logUploadId", "log-upload-public-id",
                "analysisStatus", "RULE_READY",
                "reviewStatus", "APPROVED",
                "supportDecision", "REMOTE_POSSIBLE",
                "riskLevel", "MEDIUM",
                "causeCandidates", List.of(MockData.map("label", "GPU temperature spike")),
                "upgradeCandidates", List.of(),
                "adminNote", "Remote support link sent."
        ));

        mockMvc.perform(get("/api/as-tickets/ticket-public-id")
                        .header("Authorization", USER_TOKEN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("ticket-public-id"))
                .andExpect(jsonPath("$.analysisStatus").value("RULE_READY"))
                .andExpect(jsonPath("$.reviewStatus").value("APPROVED"))
                .andExpect(jsonPath("$.supportDecision").value("REMOTE_POSSIBLE"));

        verify(currentUserService).requireUser(USER_TOKEN);
        verify(ticketQueryService).ticket("ticket-public-id", USER);
    }

    @Test
    void creatingTicketBroadcastsSupportChatQueueWhenRoomExists() throws Exception {
        when(currentUserService.requireUser(USER_TOKEN)).thenReturn(USER);
        when(ticketQueryService.create(Map.of("symptom", "GPU 온도 상승"), USER)).thenReturn(MockData.map(
                "id", "ticket-public-id",
                "status", "OPEN",
                "symptom", "GPU 온도 상승",
                "supportChatRoomId", "00000000-0000-4000-8000-000000009001",
                "causeCandidates", List.of(),
                "upgradeCandidates", List.of()
        ));

        mockMvc.perform(post("/api/as-tickets")
                        .header("Authorization", USER_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "symptom": "GPU 온도 상승"
                                }
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.supportChatRoomId").value("00000000-0000-4000-8000-000000009001"));

        verify(ticketQueryService).create(Map.of("symptom", "GPU 온도 상승"), USER);
        verify(supportChatEventPublisher).publishRoomChanged("00000000-0000-4000-8000-000000009001");
    }

    @Test
    void userCanRequestRemoteSupportForOwnTicket() throws Exception {
        when(currentUserService.requireUser(USER_TOKEN)).thenReturn(USER);
        when(ticketQueryService.requestRemoteSupport("ticket-public-id", Map.of(
                "reason", "드라이버 오류를 원격으로 확인해 주세요.",
                "contactPhone", "010-1234-5678"
        ), USER)).thenReturn(MockData.map(
                "id", "ticket-public-id",
                "status", "OPEN",
                "symptom", "GPU temperature spike",
                "analysisStatus", "RULE_READY",
                "reviewStatus", "REQUIRED",
                "supportDecision", "REMOTE_POSSIBLE",
                "remoteSupportStatus", "REQUESTED",
                "causeCandidates", List.of(),
                "upgradeCandidates", List.of()
        ));

        mockMvc.perform(post("/api/as-tickets/ticket-public-id/remote-support-requests")
                        .header("Authorization", USER_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "reason": "드라이버 오류를 원격으로 확인해 주세요.",
                                  "contactPhone": "010-1234-5678"
                                }
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").value("ticket-public-id"))
                .andExpect(jsonPath("$.remoteSupportStatus").value("REQUESTED"));

        verify(currentUserService).requireUser(USER_TOKEN);
        verify(ticketQueryService).requestRemoteSupport("ticket-public-id", Map.of(
                "reason", "드라이버 오류를 원격으로 확인해 주세요.",
                "contactPhone", "010-1234-5678"
        ), USER);
    }

    @Test
    void userCanReadRemoteSupportStateAndRegisterAccessCode() throws Exception {
        when(currentUserService.requireUser(USER_TOKEN)).thenReturn(USER);
        when(ticketQueryService.userRemoteSupport("ticket-public-id", USER)).thenReturn(Map.of(
                "status", "WAITING_FOR_CODE",
                "provider", "CHROME_REMOTE_DESKTOP",
                "accessCodeRegistered", false
        ));
        when(ticketQueryService.registerRemoteAccessCode("ticket-public-id", "123-456 789", USER)).thenReturn(Map.of(
                "status", "CODE_READY",
                "provider", "CHROME_REMOTE_DESKTOP",
                "accessCodeRegistered", true
        ));

        mockMvc.perform(get("/api/as-tickets/ticket-public-id/remote-support")
                        .header("Authorization", USER_TOKEN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("WAITING_FOR_CODE"))
                .andExpect(jsonPath("$.accessCode").doesNotExist());

        mockMvc.perform(put("/api/as-tickets/ticket-public-id/remote-support/access-code")
                        .header("Authorization", USER_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                { "accessCode": "123-456 789" }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CODE_READY"))
                .andExpect(jsonPath("$.accessCode").doesNotExist());

        verify(ticketQueryService).userRemoteSupport("ticket-public-id", USER);
        verify(ticketQueryService).registerRemoteAccessCode("ticket-public-id", "123-456 789", USER);
    }

    @Test
    void userCanSubmitSupportFeedbackForOwnTicket() throws Exception {
        when(currentUserService.requireUser(USER_TOKEN)).thenReturn(USER);
        when(ticketQueryService.submitFeedback("ticket-public-id", Map.of(
                "rating", 5,
                "comment", "원격지원 후 해결됐습니다."
        ), USER)).thenReturn(MockData.map(
                "id", "ticket-public-id",
                "status", "RESOLVED",
                "symptom", "GPU temperature spike",
                "feedbackRating", 5,
                "feedbackComment", "원격지원 후 해결됐습니다.",
                "causeCandidates", List.of(),
                "upgradeCandidates", List.of()
        ));

        mockMvc.perform(post("/api/as-tickets/ticket-public-id/feedback")
                        .header("Authorization", USER_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "rating": 5,
                                  "comment": "원격지원 후 해결됐습니다."
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("ticket-public-id"))
                .andExpect(jsonPath("$.feedbackRating").value(5));

        verify(currentUserService).requireUser(USER_TOKEN);
        verify(ticketQueryService).submitFeedback("ticket-public-id", Map.of(
                "rating", 5,
                "comment", "원격지원 후 해결됐습니다."
        ), USER);
    }
}

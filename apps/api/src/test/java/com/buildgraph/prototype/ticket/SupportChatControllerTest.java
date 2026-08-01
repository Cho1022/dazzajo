package com.buildgraph.prototype.ticket;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
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

@WebMvcTest({SupportChatController.class, AdminSupportChatController.class})
class SupportChatControllerTest {
    private static final String USER_TOKEN = "Bearer jwt-user-token";
    private static final String ADMIN_TOKEN = "Bearer jwt-admin-token";
    private static final CurrentUserService.CurrentUser USER = new CurrentUserService.CurrentUser(
            1L, "00000000-0000-4000-8000-000000001004", "user@example.com", "Demo User", "USER", null
    );
    private static final CurrentUserService.CurrentUser ADMIN = new CurrentUserService.CurrentUser(
            2L, "00000000-0000-4000-8000-000000000001", "admin@example.com", "Admin", "ADMIN", null
    );

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private SupportChatService supportChatService;

    @MockitoBean
    private CurrentUserService currentUserService;

    @MockitoBean
    private SupportChatEventPublisher supportChatEventPublisher;

    @MockitoBean
    private VisitSupportReservationService visitSupportReservationService;

    @Test
    void currentChatWithoutTicketGuidesUserToSupportNew() throws Exception {
        when(currentUserService.requireUser(USER_TOKEN)).thenReturn(USER);
        when(supportChatService.current(USER, null)).thenReturn(MockData.map(
                "contact", null,
                "messages", List.of(),
                "supportNewPath", "/support/new",
                "pollingIntervalMs", 5000
        ));

        mockMvc.perform(get("/api/support/chat-sessions/current").header("Authorization", USER_TOKEN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.contact").doesNotExist())
                .andExpect(jsonPath("$.supportNewPath").value("/support/new"));
    }

    @Test
    void legacyRestMessageEndpointsAreRemoved() throws Exception {
        mockMvc.perform(post("/api/support/chat-sessions/chat-session-id/messages")
                        .header("Authorization", USER_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"content\":\"hello\"}"))
                .andExpect(status().isNotFound());
        mockMvc.perform(post("/api/admin/support/chat-sessions/chat-session-id/messages")
                        .header("Authorization", ADMIN_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"content\":\"hello\"}"))
                .andExpect(status().isNotFound());

        verifyNoInteractions(supportChatService);
    }

    @Test
    void legacyWebSocketTicketEndpointsAreRemoved() throws Exception {
        mockMvc.perform(post("/api/support/chat-sessions/chat-session-id/ws-ticket")
                        .header("Authorization", USER_TOKEN))
                .andExpect(status().isNotFound());
        mockMvc.perform(post("/api/admin/support/chat-sessions/chat-session-id/ws-ticket")
                        .header("Authorization", ADMIN_TOKEN))
                .andExpect(status().isNotFound());
        mockMvc.perform(post("/api/admin/support/chat-sessions/ws-ticket")
                        .header("Authorization", ADMIN_TOKEN))
                .andExpect(status().isMethodNotAllowed());
    }

    @Test
    void userReservationPublishesRoomChange() throws Exception {
        Map<String, Object> request = Map.of(
                "scheduledAt", "2099-07-10T14:30:00+09:00",
                "addressSnapshot", "서울시 강남구"
        );
        when(currentUserService.requireUser(USER_TOKEN)).thenReturn(USER);
        when(visitSupportReservationService.requestUserReservation("chat-session-id", request, USER))
                .thenReturn(chatDetailWithReservation("chat-session-id", "REQUESTED"));

        mockMvc.perform(put("/api/support/chat-sessions/chat-session-id/visit-reservation")
                        .header("Authorization", USER_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"scheduledAt":"2099-07-10T14:30:00+09:00","addressSnapshot":"서울시 강남구"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.contact.visitReservation.status").value("REQUESTED"));

        verify(supportChatEventPublisher).publishRoomChanged("chat-session-id");
    }

    @Test
    void adminCanScheduleAndCancelReservation() throws Exception {
        Map<String, Object> request = Map.of(
                "scheduledAt", "2099-07-10T14:30:00+09:00",
                "technicianNote", "방문 전 연락"
        );
        when(currentUserService.requireAdmin(ADMIN_TOKEN)).thenReturn(ADMIN);
        when(visitSupportReservationService.scheduleAdminReservation("chat-session-id", request, ADMIN))
                .thenReturn(chatDetailWithReservation("chat-session-id", "SCHEDULED"));
        when(visitSupportReservationService.cancelAdminReservation("chat-session-id", ADMIN))
                .thenReturn(chatDetailWithReservation("chat-session-id", "CANCELLED"));

        mockMvc.perform(put("/api/admin/support/chat-sessions/chat-session-id/visit-reservation")
                        .header("Authorization", ADMIN_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"scheduledAt":"2099-07-10T14:30:00+09:00","technicianNote":"방문 전 연락"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.contact.visitReservation.status").value("SCHEDULED"));
        mockMvc.perform(delete("/api/admin/support/chat-sessions/chat-session-id/visit-reservation")
                        .header("Authorization", ADMIN_TOKEN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.contact.visitReservation.status").value("CANCELLED"));

        verify(supportChatEventPublisher, org.mockito.Mockito.times(2)).publishRoomChanged("chat-session-id");
    }

    @Test
    void adminDeletionPublishesRoomRemoval() throws Exception {
        when(currentUserService.requireAdmin(ADMIN_TOKEN)).thenReturn(ADMIN);
        when(supportChatService.deleteAdminSession("chat-session-id", ADMIN))
                .thenReturn(deletedChatDetail("chat-session-id"));

        mockMvc.perform(delete("/api/admin/support/chat-sessions/chat-session-id")
                        .header("Authorization", ADMIN_TOKEN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.contact.status").value("ARCHIVED"));

        verify(supportChatEventPublisher).publishRoomChanged("chat-session-id");
    }

    @Test
    void adminCanLoadChatDetailWithoutMarkingUnread() throws Exception {
        when(currentUserService.requireAdmin(ADMIN_TOKEN)).thenReturn(ADMIN);
        when(supportChatService.adminDetail("chat-session-id", ADMIN, false))
                .thenReturn(MockData.map("contact", MockData.map("id", "chat-session-id"), "messages", List.of()));

        mockMvc.perform(get("/api/admin/support/chat-sessions/chat-session-id")
                        .queryParam("markRead", "false")
                        .header("Authorization", ADMIN_TOKEN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.contact.id").value("chat-session-id"));
    }

    private static Map<String, Object> chatDetailWithReservation(String sessionId, String status) {
        return MockData.map(
                "contact", MockData.map(
                        "id", sessionId,
                        "status", "ACTIVE",
                        "visitReservation", MockData.map(
                                "id", "reservation-public-id",
                                "status", status,
                                "scheduledAt", "2099-07-10T14:30:00+09:00"
                        )
                ),
                "messages", List.of()
        );
    }

    private static Map<String, Object> deletedChatDetail(String sessionId) {
        return MockData.map(
                "contact", MockData.map(
                        "id", sessionId,
                        "status", "ARCHIVED",
                        "ticketStatus", "CANCELLED",
                        "canSendMessage", false
                ),
                "messages", List.of()
        );
    }
}

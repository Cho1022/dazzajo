package com.buildgraph.prototype.ticket;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.buildgraph.prototype.ticket.SupportChatMessagingContract.ErrorEvent;
import com.buildgraph.prototype.ticket.SupportChatMessagingContract.MessageEvent;
import com.buildgraph.prototype.ticket.SupportChatMessagingContract.MessageRequest;
import com.buildgraph.prototype.ticket.SupportChatMessagingContract.RoomSummary;
import com.buildgraph.prototype.ticket.SupportChatMessagingContract.SavedMessage;
import com.buildgraph.prototype.user.CurrentUserService;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.OffsetDateTime;
import org.junit.jupiter.api.Test;

class SupportChatMessagingControllerTest {
    private static final CurrentUserService.CurrentUser USER = new CurrentUserService.CurrentUser(
            10L, "00000000-0000-4000-8000-000000001010", "user@example.com", "User", "USER", null
    );
    private static final String ROOM_ID = "00000000-0000-4000-8000-000000009001";
    private static final String CLIENT_ID = "00000000-0000-4000-8000-000000009101";

    private final SupportChatService supportChatService = org.mockito.Mockito.mock(SupportChatService.class);
    private final CurrentUserService currentUserService = org.mockito.Mockito.mock(CurrentUserService.class);
    private final SupportChatEventPublisher eventPublisher = org.mockito.Mockito.mock(SupportChatEventPublisher.class);
    private final SimpleMeterRegistry meterRegistry = new SimpleMeterRegistry();
    private final SupportChatMessagingController controller = new SupportChatMessagingController(
            supportChatService, currentUserService, eventPublisher, meterRegistry
    );

    @Test
    void senderReceivesSameCanonicalEventThroughRoomPublish() {
        MessageRequest request = new MessageRequest(ROOM_ID, CLIENT_ID, "안녕하세요");
        MessageEvent event = event();
        when(supportChatService.saveMessage(request, USER)).thenReturn(new SavedMessage(event, true));

        controller.send(request, new SupportChatPrincipal(USER));

        verify(supportChatService).saveMessage(request, USER);
        verify(eventPublisher).publishMessage(event);
        assertThat(meterRegistry.counter("support.chat.messages", "outcome", "success").count()).isEqualTo(1);
    }

    @Test
    void errorHandlerReturnsPrivateSafeErrorPayload() {
        SupportChatMessagingException error = new SupportChatMessagingException(
                CLIENT_ID, "SUPPORT_CHAT_INVALID_MESSAGE", "메시지를 확인해 주세요.", false
        );

        ErrorEvent event = controller.handleSupportChatError(error);

        assertThat(event.clientMessageId()).isEqualTo(CLIENT_ID);
        assertThat(event.code()).isEqualTo("SUPPORT_CHAT_INVALID_MESSAGE");
        assertThat(event.message()).doesNotContain("SQLException");
    }

    @Test
    void unauthenticatedPrincipalIsRejectedWithoutPublishing() {
        MessageRequest request = new MessageRequest(ROOM_ID, CLIENT_ID, "안녕하세요");

        assertThatThrownBy(() -> controller.send(request, null))
                .isInstanceOf(SupportChatMessagingException.class);
        assertThat(meterRegistry.counter("support.chat.messages", "outcome", "failure").count()).isEqualTo(1);
    }

    private static MessageEvent event() {
        RoomSummary room = new RoomSummary(
                ROOM_ID, "ticket-id", "ACTIVE", "OPEN", "AS 상담", "증상", "안녕하세요",
                OffsetDateTime.parse("2026-08-02T10:00:00+09:00"), 0, 1, null, true, null
        );
        return new MessageEvent(
                "MESSAGE_CREATED", "message-id", CLIENT_ID, ROOM_ID, USER.id(), "USER", USER.name(),
                "안녕하세요", OffsetDateTime.parse("2026-08-02T10:00:00+09:00"), room
        );
    }
}

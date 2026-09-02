package com.buildgraph.prototype.ticket;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.buildgraph.prototype.ticket.SupportChatMessagingContract.MessageEvent;
import com.buildgraph.prototype.ticket.SupportChatMessagingContract.RoomSummary;
import java.time.OffsetDateTime;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.simp.SimpMessagingTemplate;

class SupportChatEventPublisherTest {
    private static final String ROOM_ID = "00000000-0000-4000-8000-000000009001";
    private final SimpMessagingTemplate messagingTemplate = org.mockito.Mockito.mock(SimpMessagingTemplate.class);
    private final SupportChatService supportChatService = org.mockito.Mockito.mock(SupportChatService.class);
    private final SupportChatEventPublisher publisher = new SupportChatEventPublisher(messagingTemplate, supportChatService);

    @Test
    void messageIsPublishedToRoomAndAdminQueueAsIncrementalEvents() {
        RoomSummary room = room();
        MessageEvent event = new MessageEvent(
                "MESSAGE_CREATED", "message-id", "client-id", ROOM_ID, "sender-id", "USER", "User",
                "hello", OffsetDateTime.parse("2026-08-02T10:00:00+09:00"), room
        );

        publisher.publishMessage(event);

        verify(messagingTemplate).convertAndSend(
                eq(SupportChatInboundChannelInterceptor.ROOM_TOPIC_PREFIX + ROOM_ID), eq(event)
        );
        verify(messagingTemplate).convertAndSend(
                eq(SupportChatInboundChannelInterceptor.ADMIN_QUEUE_TOPIC),
                org.mockito.ArgumentMatchers.<Object>argThat(value -> value instanceof SupportChatMessagingContract.RoomEvent roomEvent
                        && "ROOM_UPDATED".equals(roomEvent.type())
                        && ROOM_ID.equals(roomEvent.roomId()))
        );
    }

    @Test
    void removedRoomPublishesAdminQueueRemovalEvent() {
        when(supportChatService.roomSummary(ROOM_ID)).thenReturn(Optional.empty());
        when(supportChatService.adminQueueRoomSummary(ROOM_ID)).thenReturn(Optional.empty());

        publisher.publishRoomChanged(ROOM_ID);

        verify(messagingTemplate).convertAndSend(
                eq(SupportChatInboundChannelInterceptor.ADMIN_QUEUE_TOPIC),
                org.mockito.ArgumentMatchers.<Object>argThat(value -> value instanceof SupportChatMessagingContract.RoomEvent roomEvent
                        && "ROOM_REMOVED".equals(roomEvent.type())
                        && ROOM_ID.equals(roomEvent.roomId()))
        );
    }

    private static RoomSummary room() {
        return new RoomSummary(
                ROOM_ID, "ticket-id", "ACTIVE", "OPEN", "AS 상담", "증상", "hello",
                OffsetDateTime.parse("2026-08-02T10:00:00+09:00"), 0, 1, null, true, null
        );
    }
}

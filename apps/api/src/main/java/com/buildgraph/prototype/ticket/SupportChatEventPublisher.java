package com.buildgraph.prototype.ticket;

import com.buildgraph.prototype.ticket.SupportChatMessagingContract.MessageEvent;
import com.buildgraph.prototype.ticket.SupportChatMessagingContract.RoomEvent;
import com.buildgraph.prototype.ticket.SupportChatMessagingContract.RoomSummary;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

@Component
public class SupportChatEventPublisher {
    private static final Logger log = LoggerFactory.getLogger(SupportChatEventPublisher.class);

    private final SimpMessagingTemplate messagingTemplate;
    private final SupportChatService supportChatService;

    public SupportChatEventPublisher(
            SimpMessagingTemplate messagingTemplate,
            SupportChatService supportChatService
    ) {
        this.messagingTemplate = messagingTemplate;
        this.supportChatService = supportChatService;
    }

    public void publishMessage(MessageEvent event) {
        safely(() -> messagingTemplate.convertAndSend(roomTopic(event.roomId()), event));
        publishAdminQueue(event.roomId(), event.room());
    }

    public void publishRoomChanged(String roomId) {
        safely(() -> {
            supportChatService.roomSummary(roomId).ifPresent(summary ->
                    messagingTemplate.convertAndSend(roomTopic(roomId), RoomEvent.updated(summary, true))
            );
            supportChatService.adminQueueRoomSummary(roomId)
                    .ifPresentOrElse(
                            summary -> messagingTemplate.convertAndSend(
                                    SupportChatInboundChannelInterceptor.ADMIN_QUEUE_TOPIC,
                                    RoomEvent.updated(summary, false)
                            ),
                            () -> messagingTemplate.convertAndSend(
                                    SupportChatInboundChannelInterceptor.ADMIN_QUEUE_TOPIC,
                                    RoomEvent.removed(roomId)
                            )
                    );
        });
    }

    private void publishAdminQueue(String roomId, RoomSummary summary) {
        safely(() -> messagingTemplate.convertAndSend(
                SupportChatInboundChannelInterceptor.ADMIN_QUEUE_TOPIC,
                RoomEvent.updated(summary, false)
        ));
    }

    private static String roomTopic(String roomId) {
        return SupportChatInboundChannelInterceptor.ROOM_TOPIC_PREFIX + roomId;
    }

    private static void safely(Runnable publish) {
        try {
            publish.run();
        } catch (RuntimeException error) {
            log.warn("Support chat event publish failed after the database change was committed.", error);
        }
    }
}

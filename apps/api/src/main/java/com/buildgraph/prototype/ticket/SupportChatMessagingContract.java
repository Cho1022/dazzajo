package com.buildgraph.prototype.ticket;

public final class SupportChatMessagingContract {
    private SupportChatMessagingContract() {
    }

    public record MessageRequest(String roomId, String clientMessageId, String content) {
    }

    public record UserSummary(String id, String email, String name) {
    }

    public record RoomSummary(
            String roomId,
            String asTicketId,
            String status,
            String ticketStatus,
            String title,
            String symptom,
            String lastMessage,
            Object lastMessageAt,
            int userUnreadCount,
            int adminUnreadCount,
            String assignedAdminId,
            boolean canSendMessage,
            UserSummary user
    ) {
    }

    public record MessageEvent(
            String type,
            String messageId,
            String clientMessageId,
            String roomId,
            String senderId,
            String senderRole,
            String senderName,
            String content,
            Object createdAt,
            RoomSummary room
    ) {
        static final String TYPE = "MESSAGE_CREATED";
    }

    public record RoomEvent(
            String type,
            String roomId,
            RoomSummary room,
            boolean refreshRequired
    ) {
        static RoomEvent updated(RoomSummary room, boolean refreshRequired) {
            return new RoomEvent("ROOM_UPDATED", room.roomId(), room, refreshRequired);
        }

        static RoomEvent removed(String roomId) {
            return new RoomEvent("ROOM_REMOVED", roomId, null, false);
        }
    }

    public record ErrorEvent(
            String clientMessageId,
            String code,
            String message,
            boolean retryable
    ) {
    }

    public record SavedMessage(MessageEvent event, boolean inserted) {
    }
}

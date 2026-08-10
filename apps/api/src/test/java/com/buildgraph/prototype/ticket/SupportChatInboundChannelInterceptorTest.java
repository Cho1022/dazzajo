package com.buildgraph.prototype.ticket;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.buildgraph.prototype.user.CurrentUserService;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.MessageBuilder;

class SupportChatInboundChannelInterceptorTest {
    private static final String ROOM_ID = "00000000-0000-4000-8000-000000009001";
    private static final CurrentUserService.CurrentUser USER = new CurrentUserService.CurrentUser(
            10L, "00000000-0000-4000-8000-000000001010", "user@example.com", "User", "USER", null
    );
    private static final CurrentUserService.CurrentUser ADMIN = new CurrentUserService.CurrentUser(
            20L, "00000000-0000-4000-8000-000000001020", "admin@example.com", "Admin", "ADMIN", null
    );

    private final CurrentUserService currentUserService = org.mockito.Mockito.mock(CurrentUserService.class);
    private final SupportChatService supportChatService = org.mockito.Mockito.mock(SupportChatService.class);
    private final MessageChannel channel = org.mockito.Mockito.mock(MessageChannel.class);
    private final SimpleMeterRegistry meterRegistry = new SimpleMeterRegistry();
    private final SupportChatInboundChannelInterceptor interceptor =
            new SupportChatInboundChannelInterceptor(currentUserService, supportChatService, meterRegistry);

    @Test
    void connectAuthenticatesBearerTokenAndSetsPrincipal() {
        when(currentUserService.requireUser("Bearer valid-token")).thenReturn(USER);
        StompHeaderAccessor accessor = accessor(StompCommand.CONNECT, null, null);
        accessor.setNativeHeader("Authorization", "Bearer valid-token");
        Message<byte[]> message = message(accessor);

        interceptor.preSend(message, channel);

        assertThat(accessor.getUser()).isNotNull();
        assertThat(accessor.getUser().getName()).isEqualTo(USER.id());
        verify(currentUserService).requireUser("Bearer valid-token");
        assertThat(meterRegistry.counter("support.chat.connections", "outcome", "success").count()).isEqualTo(1);
    }

    @Test
    void connectRejectsMissingOrInvalidTokenWithSafeError() {
        when(currentUserService.requireUser(null)).thenThrow(new IllegalArgumentException("token detail"));

        assertThatThrownBy(() -> interceptor.preSend(message(accessor(StompCommand.CONNECT, null, null)), channel))
                .isInstanceOf(SupportChatMessagingException.class)
                .satisfies(error -> assertThat(((SupportChatMessagingException) error).code())
                        .isEqualTo("SUPPORT_CHAT_UNAUTHORIZED"));
    }

    @Test
    void ownerCanSubscribeToOwnRoom() {
        when(supportChatService.userCanAccess(ROOM_ID, USER)).thenReturn(true);

        interceptor.preSend(message(accessor(
                StompCommand.SUBSCRIBE,
                SupportChatInboundChannelInterceptor.ROOM_TOPIC_PREFIX + ROOM_ID,
                new SupportChatPrincipal(USER)
        )), channel);

        verify(supportChatService).userCanAccess(ROOM_ID, USER);
    }

    @Test
    void userCannotSubscribeToAnotherRoomOrAdminQueue() {
        when(supportChatService.userCanAccess(ROOM_ID, USER)).thenReturn(false);

        assertForbidden(accessor(
                StompCommand.SUBSCRIBE,
                SupportChatInboundChannelInterceptor.ROOM_TOPIC_PREFIX + ROOM_ID,
                new SupportChatPrincipal(USER)
        ));
        assertForbidden(accessor(
                StompCommand.SUBSCRIBE,
                SupportChatInboundChannelInterceptor.ADMIN_QUEUE_TOPIC,
                new SupportChatPrincipal(USER)
        ));
    }

    @Test
    void adminCanSubscribeToAdminQueueAndAccessibleRoom() {
        when(currentUserService.requireAdminUser(ADMIN)).thenReturn(ADMIN);
        when(supportChatService.adminCanAccess(ROOM_ID)).thenReturn(true);

        interceptor.preSend(message(accessor(
                StompCommand.SUBSCRIBE,
                SupportChatInboundChannelInterceptor.ADMIN_QUEUE_TOPIC,
                new SupportChatPrincipal(ADMIN)
        )), channel);
        interceptor.preSend(message(accessor(
                StompCommand.SUBSCRIBE,
                SupportChatInboundChannelInterceptor.ROOM_TOPIC_PREFIX + ROOM_ID,
                new SupportChatPrincipal(ADMIN)
        )), channel);

        verify(supportChatService).adminCanAccess(ROOM_ID);
    }

    @Test
    void sendAllowsOnlyCanonicalApplicationDestination() {
        interceptor.preSend(message(accessor(
                StompCommand.SEND,
                SupportChatInboundChannelInterceptor.SEND_DESTINATION,
                new SupportChatPrincipal(USER)
        )), channel);

        assertForbidden(accessor(StompCommand.SEND, "/app/other", new SupportChatPrincipal(USER)));
    }

    private void assertForbidden(StompHeaderAccessor accessor) {
        assertThatThrownBy(() -> interceptor.preSend(message(accessor), channel))
                .isInstanceOf(SupportChatMessagingException.class)
                .satisfies(error -> assertThat(((SupportChatMessagingException) error).code())
                        .isEqualTo("SUPPORT_CHAT_FORBIDDEN"));
    }

    private static StompHeaderAccessor accessor(StompCommand command, String destination, java.security.Principal principal) {
        StompHeaderAccessor accessor = StompHeaderAccessor.create(command);
        accessor.setDestination(destination);
        accessor.setUser(principal);
        accessor.setLeaveMutable(true);
        return accessor;
    }

    private static Message<byte[]> message(StompHeaderAccessor accessor) {
        return MessageBuilder.createMessage(new byte[0], accessor.getMessageHeaders());
    }
}

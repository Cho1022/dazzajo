package com.buildgraph.prototype.ticket;

import com.buildgraph.prototype.user.CurrentUserService;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.stereotype.Component;

@Component
public class SupportChatInboundChannelInterceptor implements ChannelInterceptor {
    static final String SEND_DESTINATION = "/app/support-chat/messages";
    static final String ROOM_TOPIC_PREFIX = "/topic/support-chat/rooms/";
    static final String ADMIN_QUEUE_TOPIC = "/topic/support-chat/admin-queue";
    static final String ERROR_QUEUE = "/user/queue/support-chat-errors";

    private final CurrentUserService currentUserService;
    private final SupportChatService supportChatService;
    private final Counter connectionSuccessCounter;
    private final Counter connectionFailureCounter;
    private final Counter disconnectCounter;
    private final Counter subscriptionSuccessCounter;
    private final Counter subscriptionFailureCounter;

    public SupportChatInboundChannelInterceptor(
            CurrentUserService currentUserService,
            SupportChatService supportChatService,
            MeterRegistry meterRegistry
    ) {
        this.currentUserService = currentUserService;
        this.supportChatService = supportChatService;
        this.connectionSuccessCounter = meterRegistry.counter("support.chat.connections", "outcome", "success");
        this.connectionFailureCounter = meterRegistry.counter("support.chat.connections", "outcome", "failure");
        this.disconnectCounter = meterRegistry.counter("support.chat.connections", "outcome", "disconnected");
        this.subscriptionSuccessCounter = meterRegistry.counter("support.chat.subscriptions", "outcome", "success");
        this.subscriptionFailureCounter = meterRegistry.counter("support.chat.subscriptions", "outcome", "failure");
    }

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
        if (accessor == null || accessor.getCommand() == null) {
            return message;
        }
        if (accessor.getCommand() == StompCommand.CONNECT) {
            authenticate(accessor);
            return message;
        }
        if (accessor.getCommand() == StompCommand.DISCONNECT) {
            disconnectCounter.increment();
            return message;
        }

        SupportChatPrincipal principal = SupportChatPrincipal.from(accessor.getUser());
        if (accessor.getCommand() == StompCommand.SEND) {
            requireDestination(accessor, SEND_DESTINATION);
            return message;
        }
        if (accessor.getCommand() == StompCommand.SUBSCRIBE) {
            try {
                authorizeSubscription(accessor, principal);
                subscriptionSuccessCounter.increment();
            } catch (RuntimeException error) {
                subscriptionFailureCounter.increment();
                throw error;
            }
        }
        return message;
    }

    private void authenticate(StompHeaderAccessor accessor) {
        String authorization = accessor.getFirstNativeHeader(HttpHeaders.AUTHORIZATION);
        CurrentUserService.CurrentUser user;
        try {
            user = currentUserService.requireUser(authorization);
        } catch (RuntimeException error) {
            connectionFailureCounter.increment();
            throw unauthorized();
        }
        SupportChatPrincipal principal = new SupportChatPrincipal(user);
        var authentication = new UsernamePasswordAuthenticationToken(
                principal,
                "",
                List.of(new SimpleGrantedAuthority("ROLE_" + user.role()))
        );
        accessor.setUser(authentication);
        connectionSuccessCounter.increment();
    }

    private void authorizeSubscription(StompHeaderAccessor accessor, SupportChatPrincipal principal) {
        String destination = accessor.getDestination();
        if (ERROR_QUEUE.equals(destination)) {
            return;
        }
        if (ADMIN_QUEUE_TOPIC.equals(destination)) {
            requireAdmin(principal);
            return;
        }
        if (destination != null && destination.startsWith(ROOM_TOPIC_PREFIX)) {
            String roomId = destination.substring(ROOM_TOPIC_PREFIX.length());
            requireUuid(roomId);
            if ("ADMIN".equals(principal.user().role())) {
                requireAdmin(principal);
                if (supportChatService.adminCanAccess(roomId)) {
                    return;
                }
            } else if ("USER".equals(principal.user().role())
                    && supportChatService.userCanAccess(roomId, principal.user())) {
                return;
            }
            throw forbidden();
        }
        throw forbidden();
    }

    private void requireAdmin(SupportChatPrincipal principal) {
        if (!"ADMIN".equals(principal.user().role())) {
            throw forbidden();
        }
        try {
            currentUserService.requireAdminUser(principal.user());
        } catch (RuntimeException error) {
            throw forbidden();
        }
    }

    private static void requireDestination(StompHeaderAccessor accessor, String expected) {
        if (!expected.equals(accessor.getDestination())) {
            throw forbidden();
        }
    }

    private static void requireUuid(String value) {
        try {
            UUID.fromString(value);
        } catch (Exception error) {
            throw forbidden();
        }
    }

    private static SupportChatMessagingException unauthorized() {
        return new SupportChatMessagingException(
                null,
                "SUPPORT_CHAT_UNAUTHORIZED",
                "로그인이 필요합니다.",
                false
        );
    }

    private static SupportChatMessagingException forbidden() {
        return new SupportChatMessagingException(
                null,
                "SUPPORT_CHAT_FORBIDDEN",
                "이 상담 채널에 접근할 수 없습니다.",
                false
        );
    }
}

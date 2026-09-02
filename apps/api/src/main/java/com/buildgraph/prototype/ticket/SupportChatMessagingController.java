package com.buildgraph.prototype.ticket;

import com.buildgraph.prototype.ticket.SupportChatMessagingContract.ErrorEvent;
import com.buildgraph.prototype.ticket.SupportChatMessagingContract.MessageRequest;
import com.buildgraph.prototype.ticket.SupportChatMessagingContract.SavedMessage;
import com.buildgraph.prototype.user.CurrentUserService;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.security.Principal;
import org.springframework.http.HttpStatus;
import org.springframework.messaging.handler.annotation.MessageExceptionHandler;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.simp.annotation.SendToUser;
import org.springframework.stereotype.Controller;
import org.springframework.web.server.ResponseStatusException;

@Controller
public class SupportChatMessagingController {
    private final SupportChatService supportChatService;
    private final CurrentUserService currentUserService;
    private final SupportChatEventPublisher eventPublisher;
    private final MeterRegistry meterRegistry;
    private final Counter successCounter;
    private final Counter failureCounter;
    private final Timer processingTimer;

    public SupportChatMessagingController(
            SupportChatService supportChatService,
            CurrentUserService currentUserService,
            SupportChatEventPublisher eventPublisher,
            MeterRegistry meterRegistry
    ) {
        this.supportChatService = supportChatService;
        this.currentUserService = currentUserService;
        this.eventPublisher = eventPublisher;
        this.meterRegistry = meterRegistry;
        this.successCounter = meterRegistry.counter("support.chat.messages", "outcome", "success");
        this.failureCounter = meterRegistry.counter("support.chat.messages", "outcome", "failure");
        this.processingTimer = meterRegistry.timer("support.chat.message.processing");
    }

    @MessageMapping("/support-chat/messages")
    public void send(MessageRequest request, Principal principal) {
        String clientMessageId = request == null ? null : request.clientMessageId();
        Timer.Sample sample = Timer.start(meterRegistry);
        try {
            SupportChatPrincipal supportPrincipal = SupportChatPrincipal.from(principal);
            CurrentUserService.CurrentUser user = supportPrincipal.user();
            if ("ADMIN".equals(user.role())) {
                user = currentUserService.requireAdminUser(user);
            }
            SavedMessage saved = supportChatService.saveMessage(request, user);
            successCounter.increment();
            sample.stop(processingTimer);
            eventPublisher.publishMessage(saved.event());
        } catch (SupportChatMessagingException error) {
            failureCounter.increment();
            sample.stop(processingTimer);
            throw error;
        } catch (ResponseStatusException error) {
            failureCounter.increment();
            sample.stop(processingTimer);
            throw safeException(clientMessageId, error);
        } catch (RuntimeException error) {
            failureCounter.increment();
            sample.stop(processingTimer);
            throw new SupportChatMessagingException(
                    clientMessageId,
                    "SUPPORT_CHAT_INTERNAL_ERROR",
                    "메시지를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
                    true
            );
        }
    }

    @MessageExceptionHandler(SupportChatMessagingException.class)
    @SendToUser(destinations = "/queue/support-chat-errors", broadcast = false)
    public ErrorEvent handleSupportChatError(SupportChatMessagingException error) {
        return new ErrorEvent(error.clientMessageId(), error.code(), error.getMessage(), error.retryable());
    }

    private static SupportChatMessagingException safeException(String clientMessageId, ResponseStatusException error) {
        HttpStatus status = HttpStatus.resolve(error.getStatusCode().value());
        if (status == HttpStatus.NOT_FOUND || status == HttpStatus.FORBIDDEN) {
            return new SupportChatMessagingException(
                    clientMessageId,
                    "SUPPORT_CHAT_FORBIDDEN",
                    "이 상담방에 메시지를 보낼 수 없습니다.",
                    false
            );
        }
        if (status == HttpStatus.CONFLICT) {
            return new SupportChatMessagingException(
                    clientMessageId,
                    "SUPPORT_CHAT_CONFLICT",
                    safeMessage(error, "현재 상태에서는 메시지를 보낼 수 없습니다."),
                    false
            );
        }
        if (status == HttpStatus.BAD_REQUEST) {
            return new SupportChatMessagingException(
                    clientMessageId,
                    "SUPPORT_CHAT_INVALID_MESSAGE",
                    safeMessage(error, "메시지 내용을 확인해 주세요."),
                    false
            );
        }
        return new SupportChatMessagingException(
                clientMessageId,
                "SUPPORT_CHAT_INTERNAL_ERROR",
                "메시지를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
                true
        );
    }

    private static String safeMessage(ResponseStatusException error, String fallback) {
        String reason = error.getReason();
        return reason == null || reason.isBlank() ? fallback : reason;
    }
}

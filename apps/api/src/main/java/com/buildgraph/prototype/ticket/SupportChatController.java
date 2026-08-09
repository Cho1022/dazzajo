package com.buildgraph.prototype.ticket;

import com.buildgraph.prototype.user.CurrentUserService;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/support/chat-sessions")
public class SupportChatController {
    private final SupportChatService supportChatService;
    private final CurrentUserService currentUserService;
    private final SupportChatEventPublisher supportChatEventPublisher;
    private final VisitSupportReservationService visitSupportReservationService;

    public SupportChatController(
            SupportChatService supportChatService,
            CurrentUserService currentUserService,
            SupportChatEventPublisher supportChatEventPublisher,
            VisitSupportReservationService visitSupportReservationService
    ) {
        this.supportChatService = supportChatService;
        this.currentUserService = currentUserService;
        this.supportChatEventPublisher = supportChatEventPublisher;
        this.visitSupportReservationService = visitSupportReservationService;
    }

    @GetMapping("/current")
    Map<String, Object> current(
            @RequestParam(value = "asTicketId", required = false) String asTicketId,
            @RequestParam(value = "summary", required = false, defaultValue = "false") boolean summary,
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        CurrentUserService.CurrentUser user = currentUserService.requireUser(authorization);
        // summary=true(닫힌 위젯 배지): 전체 대화 조회 없이 룸 요약만 → 상시 폴링 부하 감축.
        return summary
                ? supportChatService.currentSummary(user, asTicketId)
                : supportChatService.current(user, asTicketId);
    }

    @GetMapping("/{id}")
    Map<String, Object> detail(
            @PathVariable String id,
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        CurrentUserService.CurrentUser user = currentUserService.requireUser(authorization);
        return supportChatService.detail(id, user);
    }

    @PutMapping("/{id}/visit-reservation")
    Map<String, Object> putVisitReservation(
            @PathVariable String id,
            @RequestBody(required = false) Map<String, Object> request,
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        CurrentUserService.CurrentUser user = currentUserService.requireUser(authorization);
        Map<String, Object> detail = visitSupportReservationService.requestUserReservation(id, request == null ? Map.of() : request, user);
        supportChatEventPublisher.publishRoomChanged(id);
        return detail;
    }
}

package com.buildgraph.prototype.ticket;

import com.buildgraph.prototype.user.CurrentUserService;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class TicketController {
    private final TicketQueryService ticketQueryService;
    private final AsTicketDraftService asTicketDraftService;
    private final CurrentUserService currentUserService;
    private final SupportChatEventPublisher supportChatEventPublisher;

    public TicketController(
            TicketQueryService ticketQueryService,
            AsTicketDraftService asTicketDraftService,
            CurrentUserService currentUserService,
            SupportChatEventPublisher supportChatEventPublisher
    ) {
        this.ticketQueryService = ticketQueryService;
        this.asTicketDraftService = asTicketDraftService;
        this.currentUserService = currentUserService;
        this.supportChatEventPublisher = supportChatEventPublisher;
    }

    @PostMapping("/as-tickets")
    @ResponseStatus(HttpStatus.CREATED)
    Map<String, Object> create(
            @RequestBody(required = false) Map<String, Object> request,
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        CurrentUserService.CurrentUser user = currentUserService.requireUser(authorization);
        Map<String, Object> ticket = ticketQueryService.create(request, user);
        String supportChatRoomId = stringOrNull(ticket.get("supportChatRoomId"));
        if (supportChatRoomId != null) {
            supportChatEventPublisher.publishRoomChanged(supportChatRoomId);
        }
        return ticket;
    }

    @GetMapping("/as-tickets/{id}")
    Map<String, Object> ticket(
            @PathVariable String id,
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        CurrentUserService.CurrentUser user = currentUserService.requireUser(authorization);
        return ticketQueryService.ticket(id, user);
    }

    @PostMapping("/as-tickets/{id}/remote-support-requests")
    @ResponseStatus(HttpStatus.CREATED)
    Map<String, Object> requestRemoteSupport(
            @PathVariable String id,
            @RequestBody(required = false) Map<String, Object> request,
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        CurrentUserService.CurrentUser user = currentUserService.requireUser(authorization);
        return ticketQueryService.requestRemoteSupport(id, request == null ? Map.of() : request, user);
    }

    @GetMapping("/as-tickets/{id}/remote-support")
    Map<String, Object> remoteSupport(
            @PathVariable String id,
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        CurrentUserService.CurrentUser user = currentUserService.requireUser(authorization);
        return ticketQueryService.userRemoteSupport(id, user);
    }

    @PutMapping("/as-tickets/{id}/remote-support/access-code")
    Map<String, Object> registerRemoteSupportAccessCode(
            @PathVariable String id,
            @RequestBody(required = false) Map<String, Object> request,
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        CurrentUserService.CurrentUser user = currentUserService.requireUser(authorization);
        Object accessCode = request == null ? null : request.get("accessCode");
        return ticketQueryService.registerRemoteAccessCode(id, accessCode, user);
    }

    @PostMapping("/as-tickets/{id}/feedback")
    Map<String, Object> submitFeedback(
            @PathVariable String id,
            @RequestBody(required = false) Map<String, Object> request,
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        CurrentUserService.CurrentUser user = currentUserService.requireUser(authorization);
        return ticketQueryService.submitFeedback(id, request == null ? Map.of() : request, user);
    }

    @GetMapping("/as-ticket-drafts/{id}")
    Map<String, Object> draft(
            @PathVariable String id,
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        CurrentUserService.CurrentUser user = currentUserService.requireUser(authorization);
        return asTicketDraftService.draft(id, user);
    }

    private static String stringOrNull(Object value) {
        if (value == null) {
            return null;
        }
        String text = value.toString().trim();
        return text.isBlank() ? null : text;
    }
}

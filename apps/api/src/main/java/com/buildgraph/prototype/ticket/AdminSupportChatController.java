package com.buildgraph.prototype.ticket;

import com.buildgraph.prototype.user.CurrentUserService;
import java.util.Map;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/support/chat-sessions")
public class AdminSupportChatController {
    private final SupportChatService supportChatService;
    private final CurrentUserService currentUserService;
    private final SupportChatEventPublisher supportChatEventPublisher;
    private final VisitSupportReservationService visitSupportReservationService;

    public AdminSupportChatController(
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

    @GetMapping
    Map<String, Object> sessions(@RequestHeader(value = "Authorization", required = false) String authorization) {
        currentUserService.requireAdmin(authorization);
        return supportChatService.adminList();
    }

    @GetMapping("/{id}")
    Map<String, Object> detail(
            @PathVariable String id,
            @org.springframework.web.bind.annotation.RequestParam(value = "markRead", defaultValue = "true") boolean markRead,
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        CurrentUserService.CurrentUser admin = currentUserService.requireAdmin(authorization);
        return supportChatService.adminDetail(id, admin, markRead);
    }

    @DeleteMapping("/{id}")
    Map<String, Object> deleteSession(
            @PathVariable String id,
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        CurrentUserService.CurrentUser admin = currentUserService.requireAdmin(authorization);
        Map<String, Object> detail = supportChatService.deleteAdminSession(id, admin);
        supportChatEventPublisher.publishRoomChanged(id);
        return detail;
    }

    @PutMapping("/{id}/visit-reservation")
    Map<String, Object> putVisitReservation(
            @PathVariable String id,
            @RequestBody(required = false) Map<String, Object> request,
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        CurrentUserService.CurrentUser admin = currentUserService.requireAdmin(authorization);
        Map<String, Object> detail = visitSupportReservationService.scheduleAdminReservation(id, request == null ? Map.of() : request, admin);
        supportChatEventPublisher.publishRoomChanged(id);
        return detail;
    }

    @DeleteMapping("/{id}/visit-reservation")
    Map<String, Object> deleteVisitReservation(
            @PathVariable String id,
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        CurrentUserService.CurrentUser admin = currentUserService.requireAdmin(authorization);
        Map<String, Object> detail = visitSupportReservationService.cancelAdminReservation(id, admin);
        supportChatEventPublisher.publishRoomChanged(id);
        return detail;
    }
}

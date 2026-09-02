package com.buildgraph.prototype.admin;

import com.buildgraph.prototype.agent.AgentQueryService;
import com.buildgraph.prototype.build.BuildGraphLayoutService;
import com.buildgraph.prototype.common.PipelineJobRunRecorder;
import com.buildgraph.prototype.price.PriceQueryService;
import com.buildgraph.prototype.rag.RagEmbeddingService;
import com.buildgraph.prototype.rag.RagQueryService;
import com.buildgraph.prototype.ticket.SupportChatEventPublisher;
import com.buildgraph.prototype.ticket.TicketQueryService;
import com.buildgraph.prototype.user.CurrentUserService;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin")
public class AdminController {
    private final AdminQueryService adminQueryService;
    private final AgentQueryService agentQueryService;
    private final RagQueryService ragQueryService;
    private final RagEmbeddingService ragEmbeddingService;
    private final TicketQueryService ticketQueryService;
    private final SupportChatEventPublisher supportChatEventPublisher;
    private final PriceQueryService priceQueryService;
    private final BuildGraphLayoutService buildGraphLayoutService;
    private final CurrentUserService currentUserService;
    private final PipelineJobRunRecorder pipelineJobRunRecorder;

    public AdminController(
            AdminQueryService adminQueryService,
            AgentQueryService agentQueryService,
            RagQueryService ragQueryService,
            RagEmbeddingService ragEmbeddingService,
            TicketQueryService ticketQueryService,
            SupportChatEventPublisher supportChatEventPublisher,
            PriceQueryService priceQueryService,
            BuildGraphLayoutService buildGraphLayoutService,
            CurrentUserService currentUserService,
            PipelineJobRunRecorder pipelineJobRunRecorder
    ) {
        this.adminQueryService = adminQueryService;
        this.agentQueryService = agentQueryService;
        this.ragQueryService = ragQueryService;
        this.ragEmbeddingService = ragEmbeddingService;
        this.ticketQueryService = ticketQueryService;
        this.supportChatEventPublisher = supportChatEventPublisher;
        this.priceQueryService = priceQueryService;
        this.buildGraphLayoutService = buildGraphLayoutService;
        this.currentUserService = currentUserService;
        this.pipelineJobRunRecorder = pipelineJobRunRecorder;
    }

    @GetMapping("/pipeline-job-runs")
    Map<String, Object> pipelineJobRuns(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @org.springframework.web.bind.annotation.RequestParam(value = "limit", required = false) Integer limit
    ) {
        currentUserService.requireAdmin(authorization);
        return pipelineJobRunRecorder.listRecent(limit);
    }

    @GetMapping("/dashboard")
    Map<String, Object> dashboard(@RequestHeader(value = "Authorization", required = false) String authorization) {
        currentUserService.requireAdmin(authorization);
        return adminQueryService.dashboard();
    }

    @GetMapping("/audit-logs/recent")
    Map<String, Object> auditLogs(@RequestHeader(value = "Authorization", required = false) String authorization) {
        currentUserService.requireAdmin(authorization);
        return adminQueryService.auditLogs();
    }

    @GetMapping("/build-graph-layouts/default")
    Map<String, Object> buildGraphLayout(@RequestHeader(value = "Authorization", required = false) String authorization) {
        currentUserService.requireAdmin(authorization);
        return buildGraphLayoutService.getDefaultLayout();
    }

    @PutMapping("/build-graph-layouts/default")
    Map<String, Object> saveBuildGraphLayout(
            @RequestBody(required = false) Map<String, Object> request,
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        CurrentUserService.CurrentUser admin = currentUserService.requireAdmin(authorization);
        return buildGraphLayoutService.saveDefaultLayout(request == null ? Map.of() : request, admin);
    }

    @DeleteMapping("/build-graph-layouts/default")
    Map<String, Object> resetBuildGraphLayout(@RequestHeader(value = "Authorization", required = false) String authorization) {
        CurrentUserService.CurrentUser admin = currentUserService.requireAdmin(authorization);
        return buildGraphLayoutService.resetDefaultLayout(admin);
    }

    @GetMapping("/agent-sessions")
    Map<String, Object> agentSessions(@RequestHeader(value = "Authorization", required = false) String authorization) {
        currentUserService.requireAdmin(authorization);
        return agentQueryService.agentSessions();
    }

    @GetMapping("/agent-sessions/{id}")
    Map<String, Object> agentSession(@PathVariable String id, @RequestHeader(value = "Authorization", required = false) String authorization) {
        currentUserService.requireAdmin(authorization);
        return agentQueryService.adminSession(id);
    }

    @GetMapping("/tool-invocations")
    Map<String, Object> toolInvocations(@RequestHeader(value = "Authorization", required = false) String authorization) {
        currentUserService.requireAdmin(authorization);
        return agentQueryService.toolInvocations();
    }

    @GetMapping("/tool-invocations/{id}")
    Map<String, Object> toolInvocation(@PathVariable String id, @RequestHeader(value = "Authorization", required = false) String authorization) {
        currentUserService.requireAdmin(authorization);
        return agentQueryService.toolInvocation(id);
    }

    @GetMapping("/rag-evidence")
    Map<String, Object> ragEvidenceList(@RequestHeader(value = "Authorization", required = false) String authorization) {
        currentUserService.requireAdmin(authorization);
        return ragQueryService.adminEvidenceList();
    }

    @GetMapping("/rag-evidence/{id}")
    Map<String, Object> ragEvidence(@PathVariable String id, @RequestHeader(value = "Authorization", required = false) String authorization) {
        currentUserService.requireAdmin(authorization);
        return ragQueryService.adminEvidence(id);
    }

    @PostMapping("/rag-embeddings/backfill")
    Map<String, Object> backfillRagEmbeddings(
            @RequestBody(required = false) Map<String, Object> request,
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        currentUserService.requireAdmin(authorization);
        Integer limit = request == null || request.get("limit") == null ? null : Integer.valueOf(String.valueOf(request.get("limit")));
        return ragEmbeddingService.backfillReusableEmbeddings(limit);
    }

    @GetMapping("/as-tickets")
    Map<String, Object> tickets(@RequestHeader(value = "Authorization", required = false) String authorization) {
        currentUserService.requireAdmin(authorization);
        return Map.of("items", ticketQueryService.tickets());
    }

    @GetMapping("/as-tickets/{id}")
    Map<String, Object> ticket(@PathVariable String id, @RequestHeader(value = "Authorization", required = false) String authorization) {
        currentUserService.requireAdmin(authorization);
        return ticketQueryService.adminTicket(id);
    }

    @PatchMapping("/as-tickets/{id}")
    Map<String, Object> updateTicket(
            @PathVariable String id,
            @RequestBody(required = false) Map<String, Object> request,
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        CurrentUserService.CurrentUser admin = currentUserService.requireAdmin(authorization);
        Map<String, Object> ticket = ticketQueryService.update(id, request, admin);
        String supportChatRoomId = stringOrNull(ticket.get("supportChatRoomId"));
        if (supportChatRoomId != null) {
            supportChatEventPublisher.publishRoomChanged(supportChatRoomId);
        }
        return ticket;
    }

    @PostMapping("/as-tickets/{id}/assign-to-me")
    Map<String, Object> assignTicketToMe(
            @PathVariable String id,
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        CurrentUserService.CurrentUser admin = currentUserService.requireAdmin(authorization);
        return broadcastTicketUpdate(ticketQueryService.assignToCurrentAdmin(id, admin));
    }

    @PostMapping("/as-tickets/{id}/request-more-info")
    Map<String, Object> requestMoreTicketInformation(
            @PathVariable String id,
            @RequestBody(required = false) Map<String, Object> request,
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        CurrentUserService.CurrentUser admin = currentUserService.requireAdmin(authorization);
        String adminNote = request == null ? null : stringOrNull(request.get("adminNote"));
        return broadcastTicketUpdate(ticketQueryService.requestMoreInformation(id, adminNote, admin));
    }

    @PostMapping("/as-tickets/{id}/approve-remote-support")
    Map<String, Object> approveRemoteTicketSupport(
            @PathVariable String id,
            @RequestBody(required = false) Map<String, Object> request,
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        CurrentUserService.CurrentUser admin = currentUserService.requireAdmin(authorization);
        String adminNote = request == null ? null : stringOrNull(request.get("adminNote"));
        return broadcastTicketUpdate(ticketQueryService.approveRemoteSupport(id, adminNote, admin));
    }

    @GetMapping("/as-tickets/{id}/remote-support")
    Map<String, Object> remoteTicketSupport(
            @PathVariable String id,
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        CurrentUserService.CurrentUser admin = currentUserService.requireAdmin(authorization);
        return ticketQueryService.adminRemoteSupport(id, admin);
    }

    @GetMapping("/as-tickets/{id}/remote-support/access-code")
    Map<String, Object> remoteTicketSupportAccessCode(
            @PathVariable String id,
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        CurrentUserService.CurrentUser admin = currentUserService.requireAdmin(authorization);
        return ticketQueryService.remoteAccessCodeForAdmin(id, admin);
    }

    @PostMapping("/as-tickets/{id}/remote-support/start")
    Map<String, Object> startRemoteTicketSupport(
            @PathVariable String id,
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        CurrentUserService.CurrentUser admin = currentUserService.requireAdmin(authorization);
        return ticketQueryService.startRemoteSupport(id, admin);
    }

    @PostMapping("/as-tickets/{id}/remote-support/complete")
    Map<String, Object> completeRemoteTicketSupport(
            @PathVariable String id,
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        CurrentUserService.CurrentUser admin = currentUserService.requireAdmin(authorization);
        return ticketQueryService.completeRemoteSupport(id, admin);
    }

    @DeleteMapping("/as-tickets/{id}")
    Map<String, Object> deleteTicket(
            @PathVariable String id,
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        CurrentUserService.CurrentUser admin = currentUserService.requireAdmin(authorization);
        Map<String, Object> result = ticketQueryService.delete(id, admin);
        String supportChatRoomId = stringOrNull(result.get("supportChatRoomId"));
        if (supportChatRoomId != null) {
            supportChatEventPublisher.publishRoomChanged(supportChatRoomId);
        }
        return result;
    }

    @GetMapping("/price-jobs")
    Map<String, Object> priceJobs(@RequestHeader(value = "Authorization", required = false) String authorization) {
        currentUserService.requireAdmin(authorization);
        return priceQueryService.priceJobs();
    }

    @PostMapping("/price-jobs/run")
    @ResponseStatus(HttpStatus.CREATED)
    Map<String, Object> runPriceJob(@RequestHeader(value = "Authorization", required = false) String authorization) {
        CurrentUserService.CurrentUser admin = currentUserService.requireAdmin(authorization);
        return priceQueryService.runPriceJob(admin);
    }

    private static String stringOrNull(Object value) {
        if (value == null) {
            return null;
        }
        String text = value.toString().trim();
        return text.isBlank() || "null".equalsIgnoreCase(text) ? null : text;
    }

    private Map<String, Object> broadcastTicketUpdate(Map<String, Object> ticket) {
        String supportChatRoomId = stringOrNull(ticket.get("supportChatRoomId"));
        if (supportChatRoomId != null) {
            supportChatEventPublisher.publishRoomChanged(supportChatRoomId);
        }
        return ticket;
    }
}

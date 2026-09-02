package com.buildgraph.prototype.config.security;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.buildgraph.prototype.admin.AdminController;
import com.buildgraph.prototype.admin.AdminQueryService;
import com.buildgraph.prototype.agent.AgentQueryService;
import com.buildgraph.prototype.agent.AgentDiagnosisChatService;
import com.buildgraph.prototype.agent.PcAgentAsService;
import com.buildgraph.prototype.agent.PcAgentController;
import com.buildgraph.prototype.agent.PcAgentDiagnosisAsRequestService;
import com.buildgraph.prototype.build.BuildGraphLayoutService;
import com.buildgraph.prototype.common.PipelineJobRunRecorder;
import com.buildgraph.prototype.rag.RagEmbeddingService;
import com.buildgraph.prototype.rag.RagQueryService;
import com.buildgraph.prototype.ticket.AsTicketDraftService;
import com.buildgraph.prototype.ticket.SupportChatEventPublisher;
import com.buildgraph.prototype.ticket.TicketController;
import com.buildgraph.prototype.ticket.TicketQueryService;
import com.buildgraph.prototype.price.PriceQueryService;
import com.buildgraph.prototype.user.CurrentUserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Map;
import java.util.zip.GZIPOutputStream;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@WebMvcTest({PcAgentController.class, AdminController.class, TicketController.class})
@Import({AgentSecurityConfig.class, SecurityErrorResponseWriter.class})
class PcAgentControllerSecurityTest {
    private static final String AGENT_TOKEN = "raw-agent-token";
    private static final String OTHER_AGENT_TOKEN = "other-raw-agent-token";
    private static final String IDEMPOTENCY_KEY = "demo-key-1";
    private static final String ADMIN_TOKEN = "Bearer jwt-admin-token";
    private static final String USER_TOKEN = "Bearer jwt-user-token";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockitoBean
    private PcAgentAsService pcAgentAsService;

    @MockitoBean
    private PcAgentDiagnosisAsRequestService diagnosisAsRequestService;

    @MockitoBean
    private AgentDiagnosisChatService agentDiagnosisChatService;

    @MockitoBean
    private AgentTokenAuthenticationService agentTokenAuthenticationService;

    @MockitoBean
    private AgentIdempotencyService agentIdempotencyService;

    @MockitoBean
    private TicketQueryService ticketQueryService;

    @MockitoBean
    private AsTicketDraftService asTicketDraftService;

    @MockitoBean
    private SupportChatEventPublisher supportChatEventPublisher;

    @MockitoBean
    private CurrentUserService currentUserService;

    @MockitoBean
    private AdminQueryService adminQueryService;

    @MockitoBean
    private AgentQueryService agentQueryService;

    @MockitoBean
    private RagQueryService ragQueryService;

    @MockitoBean
    private RagEmbeddingService ragEmbeddingService;

    @MockitoBean
    private PriceQueryService priceQueryService;

    @MockitoBean
    private BuildGraphLayoutService buildGraphLayoutService;

    @MockitoBean
    private PipelineJobRunRecorder pipelineJobRunRecorder;

    @Test
    void registerAllowsBootstrapWithoutAgentBearerToken() throws Exception {
        when(pcAgentAsService.register(anyMap())).thenReturn(Map.of(
                "deviceId", "device-public-id",
                "agentToken", AGENT_TOKEN,
                "tokenType", "Bearer",
                "status", "ACTIVE"
        ));

        mockMvc.perform(post("/api/agent/devices/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "activationToken": "valid-agent-activation-token",
                                  "deviceFingerprintHash": "fingerprint-hash",
                                  "registrationIdempotencyKey": "register-key",
                                  "osVersion": "Windows 11",
                                  "agentVersion": "0.1.0",
                                  "policyVersion": "policy-v1"
                                }
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.deviceId").value("device-public-id"))
                .andExpect(jsonPath("$.agentToken").value(AGENT_TOKEN))
                .andExpect(jsonPath("$.tokenType").value("Bearer"))
                .andExpect(jsonPath("$.status").value("ACTIVE"))
                .andExpect(jsonPath("$.deviceInternalId").doesNotExist())
                .andExpect(jsonPath("$.userInternalId").doesNotExist())
                .andExpect(jsonPath("$.agentTokenHash").doesNotExist());

        verify(pcAgentAsService).register(anyMap());
        verifyNoInteractions(agentTokenAuthenticationService);
    }

    @Test
    void diagnosisAsRequestRequiresAgentTokenBeforeService() throws Exception {
        mockMvc.perform(post("/api/agent/as-requests")
                        .header("Idempotency-Key", "9a0e3c21-6648-41e7-a88e-17be1761b806")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));

        verifyNoInteractions(diagnosisAsRequestService);
    }

    @Test
    void diagnosisAsRequestRequiresIdempotencyKey() throws Exception {
        authenticateAgent();

        mockMvc.perform(post("/api/agent/as-requests")
                        .header("Authorization", "Bearer " + AGENT_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));

        verifyNoInteractions(diagnosisAsRequestService);
    }

    @Test
    void diagnosisAsRequestUsesAgentPrincipalAndIdempotencyReplayBoundary() throws Exception {
        String diagnosisId = "9a0e3c21-6648-41e7-a88e-17be1761b806";
        AgentPrincipal principal = authenticateAgent();
        when(agentIdempotencyService.reserve(eq(principal), anyString(), anyString(), eq(diagnosisId), anyString()))
                .thenReturn(AgentIdempotencyDecision.proceed(501L));
        when(diagnosisAsRequestService.create(eq(principal), any(PcAgentDiagnosisAsRequestService.CreateRequest.class), eq(diagnosisId)))
                .thenReturn(Map.of(
                        "requestId", "ticket-public-id",
                        "requestNumber", "AS-20260714-000001",
                        "status", "OPEN",
                        "webPath", "/support/ticket-public-id"
                ));

        mockMvc.perform(post("/api/agent/as-requests")
                        .header("Authorization", "Bearer " + AGENT_TOKEN)
                        .header("Idempotency-Key", diagnosisId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "diagnosisId": "9a0e3c21-6648-41e7-a88e-17be1761b806",
                                  "resultId": "result-1",
                                  "deviceId": "device-public-id",
                                  "requestType": "PHYSICAL_INSPECTION",
                                  "symptom": "게임 실행 후 프레임 저하",
                                  "diagnosisTitle": "GPU 냉각 계통 이상 가능성이 높습니다.",
                                  "diagnosisSummary": "고온과 팬 정지, 열 제한이 함께 확인되었습니다.",
                                  "evidenceSummary": [{"component":"gpu","metricType":"temperature","value":95}],
                                  "diagnosedAt": "2026-07-14T01:00:00Z",
                                  "mode": "LIVE",
                                  "consentAccepted": true
                                }
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.requestId").value("ticket-public-id"))
                .andExpect(jsonPath("$.requestNumber").value("AS-20260714-000001"));

        verify(diagnosisAsRequestService).create(
                eq(principal),
                any(PcAgentDiagnosisAsRequestService.CreateRequest.class),
                eq(diagnosisId)
        );
    }

    @Test
    void registerRejectsAuthorizationHeaderToAvoidJwtAgentTokenMixing() throws Exception {
        mockMvc.perform(post("/api/agent/devices/register")
                        .header("Authorization", USER_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "activationToken": "valid-agent-activation-token",
                                  "deviceFingerprintHash": "fingerprint-hash",
                                  "registrationIdempotencyKey": "register-key",
                                  "osVersion": "Windows 11",
                                  "agentVersion": "0.1.0",
                                  "policyVersion": "policy-v1"
                                }
                                """))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));

        verifyNoInteractions(pcAgentAsService);
        verifyNoInteractions(agentTokenAuthenticationService);
    }

    @Test
    void authenticatedAgentConsentRequiresIdempotencyKey() throws Exception {
        authenticateAgent();

        mockMvc.perform(post("/api/agent/consents")
                        .header("Authorization", "Bearer " + AGENT_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "consentType": "SERVER_UPLOAD",
                                  "policyVersion": "policy-v1",
                                  "accepted": true
                                }
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));

        verifyNoInteractions(pcAgentAsService);
    }

    @Test
    void authenticatedAgentHeartbeatRequiresIdempotencyKey() throws Exception {
        authenticateAgent();

        mockMvc.perform(post("/api/agent/heartbeat")
                        .header("Authorization", "Bearer " + AGENT_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "agentVersion": "0.1.0",
                                  "serviceStatus": "RUNNING",
                                  "policyVersion": "policy-v1"
                                }
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));

        verifyNoInteractions(pcAgentAsService);
    }

    @Test
    void consentAndHeartbeatRejectInvalidAgentTokenBeforeIdempotency() throws Exception {
        when(agentTokenAuthenticationService.authenticate("bad-agent-token"))
                .thenReturn(AgentTokenAuthenticationResult.invalid());

        mockMvc.perform(post("/api/agent/consents")
                        .header("Authorization", "Bearer bad-agent-token")
                        .header("Idempotency-Key", "consent-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "consentType": "SERVER_UPLOAD",
                                  "policyVersion": "policy-v1",
                                  "accepted": true
                                }
                                """))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));

        mockMvc.perform(post("/api/agent/heartbeat")
                        .header("Authorization", "Bearer bad-agent-token")
                        .header("Idempotency-Key", "heartbeat-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "agentVersion": "0.1.0",
                                  "serviceStatus": "RUNNING",
                                  "policyVersion": "policy-v1"
                                }
                                """))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));

        verifyNoInteractions(agentIdempotencyService);
        verifyNoInteractions(pcAgentAsService);
    }

    @Test
    void duplicateConsentIdempotencyKeyReplaysStoredResponse() throws Exception {
        AgentPrincipal principal = authenticateAgent();
        when(agentIdempotencyService.reserve(eq(principal), anyString(), anyString(), eq("consent-key"), anyString()))
                .thenReturn(AgentIdempotencyDecision.proceed(401L))
                .thenReturn(AgentIdempotencyDecision.replay(
                        200,
                        "{\"id\":\"consent-public-id\",\"accepted\":true}",
                        MediaType.APPLICATION_JSON_VALUE
                ));
        when(pcAgentAsService.saveConsent(eq(principal), anyMap(), eq("consent-key"))).thenReturn(Map.of(
                "id", "consent-public-id",
                "accepted", true
        ));

        mockMvc.perform(post("/api/agent/consents")
                        .header("Authorization", "Bearer " + AGENT_TOKEN)
                        .header("Idempotency-Key", "consent-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "consentType": "SERVER_UPLOAD",
                                  "policyVersion": "policy-v1",
                                  "accepted": true
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("consent-public-id"))
                .andExpect(jsonPath("$.accepted").value(true));

        mockMvc.perform(post("/api/agent/consents")
                        .header("Authorization", "Bearer " + AGENT_TOKEN)
                        .header("Idempotency-Key", "consent-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "consentType": "SERVER_UPLOAD",
                                  "policyVersion": "policy-v1",
                                  "accepted": true
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("consent-public-id"))
                .andExpect(jsonPath("$.accepted").value(true));

        verify(pcAgentAsService).saveConsent(eq(principal), anyMap(), eq("consent-key"));
    }

    @Test
    void consentSameIdempotencyKeyWithDifferentBodyReturnsConflict() throws Exception {
        AgentPrincipal principal = authenticateAgent();
        when(agentIdempotencyService.reserve(eq(principal), anyString(), anyString(), eq("consent-key"), anyString()))
                .thenReturn(AgentIdempotencyDecision.conflict());

        mockMvc.perform(post("/api/agent/consents")
                        .header("Authorization", "Bearer " + AGENT_TOKEN)
                        .header("Idempotency-Key", "consent-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "consentType": "SERVER_UPLOAD",
                                  "policyVersion": "policy-v2",
                                  "accepted": false
                                }
                                """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CONFLICT_STATE"));

        verifyNoInteractions(pcAgentAsService);
    }

    @Test
    void agentHappyPathEndpointsUseAgentPrincipalAndIdempotencyKey() throws Exception {
        AgentPrincipal principal = authenticateAgent();
        when(agentIdempotencyService.reserve(eq(principal), anyString(), anyString(), eq(IDEMPOTENCY_KEY), anyString()))
                .thenReturn(
                        AgentIdempotencyDecision.proceed(101L),
                        AgentIdempotencyDecision.proceed(102L),
                        AgentIdempotencyDecision.proceed(103L)
                );
        when(pcAgentAsService.saveConsent(eq(principal), anyMap(), eq(IDEMPOTENCY_KEY))).thenReturn(Map.of(
                "id", "consent-public-id",
                "accepted", true
        ));
        when(pcAgentAsService.heartbeat(eq(principal), anyMap(), eq(IDEMPOTENCY_KEY))).thenReturn(Map.of(
                "deviceId", "device-public-id",
                "status", "ACTIVE"
        ));
        when(pcAgentAsService.uploadLogs(eq(principal), any(), any(), eq(IDEMPOTENCY_KEY))).thenReturn(Map.of(
                "logUploadId", "log-upload-id",
                "ticketId", "ticket-public-id",
                "analysisStatus", "RULE_READY"
        ));

        mockMvc.perform(post("/api/agent/consents")
                        .header("Authorization", "Bearer " + AGENT_TOKEN)
                        .header("Idempotency-Key", IDEMPOTENCY_KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "consentType": "SERVER_UPLOAD",
                                  "policyVersion": "policy-v1",
                                  "accepted": true
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("consent-public-id"))
                .andExpect(jsonPath("$.accepted").value(true));

        mockMvc.perform(post("/api/agent/heartbeat")
                        .header("Authorization", "Bearer " + AGENT_TOKEN)
                        .header("Idempotency-Key", IDEMPOTENCY_KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "agentVersion": "0.1.0",
                                  "serviceStatus": "RUNNING",
                                  "policyVersion": "policy-v1"
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.deviceId").value("device-public-id"));

        MockMultipartFile file = new MockMultipartFile(
                "file",
                "agent-log.jsonl.gz",
                "application/gzip",
                gzip("demo log\n")
        );
        mockMvc.perform(multipart("/api/agent/log-uploads")
                        .file(file)
                        .header("Authorization", "Bearer " + AGENT_TOKEN)
                        .header("Idempotency-Key", IDEMPOTENCY_KEY)
                        .param("rangeMinutes", "30")
                        .param("symptom", "GPU temperature spike"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.ticketId").value("ticket-public-id"))
                .andExpect(jsonPath("$.analysisStatus").value("RULE_READY"));
    }

    @Test
    void logUploadRequiresAgentTokenBeforeIdempotencyKey() throws Exception {
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "agent-log.jsonl.gz",
                "application/gzip",
                gzip("demo log\n")
        );

        mockMvc.perform(multipart("/api/agent/log-uploads")
                        .file(file)
                        .header("Idempotency-Key", "upload-key")
                        .param("rangeMinutes", "30"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));

        verifyNoInteractions(agentIdempotencyService);
        verifyNoInteractions(pcAgentAsService);
    }

    @Test
    void logUploadRejectsBadAgentTokenBeforeIdempotency() throws Exception {
        when(agentTokenAuthenticationService.authenticate("bad-agent-token"))
                .thenReturn(AgentTokenAuthenticationResult.invalid());
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "agent-log.jsonl.gz",
                "application/gzip",
                gzip("demo log\n")
        );

        mockMvc.perform(multipart("/api/agent/log-uploads")
                        .file(file)
                        .header("Authorization", "Bearer bad-agent-token")
                        .header("Idempotency-Key", "upload-key")
                        .param("rangeMinutes", "30"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));

        verifyNoInteractions(agentIdempotencyService);
        verifyNoInteractions(pcAgentAsService);
    }

    @Test
    void asRagPreviewRequiresAgentTokenBeforeService() throws Exception {
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "agent-log.jsonl.gz",
                "application/gzip",
                gzip("demo log\n")
        );

        mockMvc.perform(multipart("/api/agent/log-uploads/as-rag-preview")
                        .file(file)
                        .header("Idempotency-Key", "preview-key")
                        .param("symptomType", "REMOTE_DRIVER_OS"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));

        verifyNoInteractions(agentIdempotencyService);
        verifyNoInteractions(pcAgentAsService);
    }

    @Test
    void asRagPreviewRejectsBadAgentTokenBeforeService() throws Exception {
        when(agentTokenAuthenticationService.authenticate("bad-agent-token"))
                .thenReturn(AgentTokenAuthenticationResult.invalid());
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "agent-log.jsonl.gz",
                "application/gzip",
                gzip("demo log\n")
        );

        mockMvc.perform(multipart("/api/agent/log-uploads/as-rag-preview")
                        .file(file)
                        .header("Authorization", "Bearer bad-agent-token")
                        .header("Idempotency-Key", "preview-key")
                        .param("symptomType", "REMOTE_DRIVER_OS"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));

        verifyNoInteractions(agentIdempotencyService);
        verifyNoInteractions(pcAgentAsService);
    }

    @Test
    void asRagPreviewPassesAgentPrincipalAndIdempotencyKeyToService() throws Exception {
        AgentPrincipal principal = authenticateAgent();
        when(pcAgentAsService.previewAsRag(eq(principal), any(), any(), eq("preview-key"))).thenReturn(Map.of(
                "recommendedService", "REMOTE_SUPPORT",
                "recommendedDecision", "REMOTE_POSSIBLE",
                "confidence", "HIGH",
                "summary", "드라이버 오류 반복으로 원격지원이 적합합니다."
        ));
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "agent-log.jsonl.gz",
                "application/gzip",
                gzip("demo log\n")
        );

        mockMvc.perform(multipart("/api/agent/log-uploads/as-rag-preview")
                        .file(file)
                        .header("Authorization", "Bearer " + AGENT_TOKEN)
                        .header("Idempotency-Key", "preview-key")
                        .param("symptomType", "REMOTE_DRIVER_OS"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.recommendedService").value("REMOTE_SUPPORT"))
                .andExpect(jsonPath("$.recommendedDecision").value("REMOTE_POSSIBLE"));

        verify(pcAgentAsService).previewAsRag(eq(principal), any(), any(), eq("preview-key"));
    }

    @Test
    void diagnosisChatRequiresAgentTokenBeforeService() throws Exception {
        mockMvc.perform(post("/api/agent/diagnosis-chat")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "message": "원인이 뭐야?"
                                }
                                """))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));

        verifyNoInteractions(agentDiagnosisChatService);
        verifyNoInteractions(agentIdempotencyService);
    }

    @Test
    void diagnosisChatUsesAgentTokenWithoutIdempotencyOrTicketService() throws Exception {
        AgentPrincipal principal = authenticateAgent();
        when(agentDiagnosisChatService.reply(eq(principal), anyMap())).thenReturn(Map.of(
                "assistantMessage", "드라이버 오류 가능성이 높습니다.",
                "model", "buildgraph-agent-diagnosis-rule-v1",
                "escalation", Map.of("required", false)
        ));

        mockMvc.perform(post("/api/agent/diagnosis-chat")
                        .header("Authorization", "Bearer " + AGENT_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "message": "원인이 뭐야?",
                                  "diagnosis": {
                                    "recommendedService": "REMOTE_SUPPORT"
                                  }
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assistantMessage").value("드라이버 오류 가능성이 높습니다."))
                .andExpect(jsonPath("$.model").value("buildgraph-agent-diagnosis-rule-v1"));

        verify(agentDiagnosisChatService).reply(eq(principal), anyMap());
        verifyNoInteractions(agentIdempotencyService);
        verify(pcAgentAsService, times(0)).uploadLogs(any(), any(), any(), anyString());
    }

    @Test
    void authenticatedAgentLogUploadRequiresIdempotencyKey() throws Exception {
        authenticateAgent();
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "agent-log.jsonl.gz",
                "application/gzip",
                gzip("demo log\n")
        );

        mockMvc.perform(multipart("/api/agent/log-uploads")
                        .file(file)
                        .header("Authorization", "Bearer " + AGENT_TOKEN)
                        .param("rangeMinutes", "30"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));

        verifyNoInteractions(pcAgentAsService);
    }

    @Test
    void authenticatedAgentLogUploadRequiresMultipartFile() throws Exception {
        AgentPrincipal principal = authenticateAgent();
        when(agentIdempotencyService.reserve(eq(principal), anyString(), anyString(), eq("upload-key"), anyString()))
                .thenReturn(AgentIdempotencyDecision.proceed(300L));

        mockMvc.perform(multipart("/api/agent/log-uploads")
                        .header("Authorization", "Bearer " + AGENT_TOKEN)
                        .header("Idempotency-Key", "upload-key")
                        .param("rangeMinutes", "30"))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(pcAgentAsService);
    }

    @Test
    void logUploadPassesIdempotencyKeyToServiceForReplayHandling() throws Exception {
        AgentPrincipal principal = authenticateAgent();
        when(pcAgentAsService.uploadLogs(eq(principal), any(), any(), eq("upload-key"))).thenReturn(Map.of(
                "ticketId", "ticket-public-id",
                "analysisStatus", "RULE_READY"
        ));
        MockMultipartFile firstFile = new MockMultipartFile(
                "file",
                "agent-log.jsonl.gz",
                "application/gzip",
                gzip("demo log\n")
        );
        MockMultipartFile retryFile = new MockMultipartFile(
                "file",
                "agent-log.jsonl.gz",
                "application/gzip",
                gzip("demo log\n")
        );

        mockMvc.perform(multipart("/api/agent/log-uploads")
                        .file(firstFile)
                        .header("Authorization", "Bearer " + AGENT_TOKEN)
                        .header("Idempotency-Key", "upload-key")
                        .param("rangeMinutes", "30"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.ticketId").value("ticket-public-id"));

        mockMvc.perform(multipart("/api/agent/log-uploads")
                        .file(retryFile)
                        .header("Authorization", "Bearer " + AGENT_TOKEN)
                        .header("Idempotency-Key", "upload-key")
                        .param("rangeMinutes", "30"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.ticketId").value("ticket-public-id"));

        verify(pcAgentAsService, times(2)).uploadLogs(eq(principal), any(), any(), eq("upload-key"));
    }

    @Test
    void sameUploadKeyWithDifferentBodyReturnsServiceConflict() throws Exception {
        AgentPrincipal principal = authenticateAgent();
        when(pcAgentAsService.uploadLogs(eq(principal), any(), any(), eq("upload-key")))
                .thenThrow(new org.springframework.web.server.ResponseStatusException(
                        org.springframework.http.HttpStatus.CONFLICT,
                        "Idempotency-Key was already used with a different upload request."
                ));

        mockMvc.perform(multipart("/api/agent/log-uploads")
                        .file(new MockMultipartFile(
                                "file",
                                "agent-log.jsonl.gz",
                                "application/gzip",
                                gzip("changed log\n")
                        ))
                        .header("Authorization", "Bearer " + AGENT_TOKEN)
                        .header("Idempotency-Key", "upload-key")
                        .param("rangeMinutes", "30"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CONFLICT_STATE"));

        verify(pcAgentAsService).uploadLogs(eq(principal), any(), any(), eq("upload-key"));
    }

    @Test
    void sameUploadKeyFromDifferentAgentsDoesNotConflict() throws Exception {
        AgentPrincipal firstAgent = authenticateAgent();
        AgentPrincipal secondAgent = new AgentPrincipal(11L, "other-device-public-id", 21L, "ACTIVE");
        when(agentTokenAuthenticationService.authenticate(OTHER_AGENT_TOKEN))
                .thenReturn(AgentTokenAuthenticationResult.authenticated(secondAgent));
        when(agentIdempotencyService.reserve(eq(firstAgent), anyString(), anyString(), eq("shared-upload-key"), anyString()))
                .thenReturn(AgentIdempotencyDecision.proceed(401L));
        when(agentIdempotencyService.reserve(eq(secondAgent), anyString(), anyString(), eq("shared-upload-key"), anyString()))
                .thenReturn(AgentIdempotencyDecision.proceed(402L));
        when(pcAgentAsService.uploadLogs(eq(firstAgent), any(), any(), eq("shared-upload-key"))).thenReturn(Map.of(
                "ticketId", "first-ticket-id",
                "analysisStatus", "RULE_READY"
        ));
        when(pcAgentAsService.uploadLogs(eq(secondAgent), any(), any(), eq("shared-upload-key"))).thenReturn(Map.of(
                "ticketId", "second-ticket-id",
                "analysisStatus", "RULE_READY"
        ));

        mockMvc.perform(multipart("/api/agent/log-uploads")
                        .file(new MockMultipartFile(
                                "file",
                                "agent-log.jsonl.gz",
                                "application/gzip",
                                gzip("same logical log\n")
                        ))
                        .header("Authorization", "Bearer " + AGENT_TOKEN)
                        .header("Idempotency-Key", "shared-upload-key")
                        .param("rangeMinutes", "30"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.ticketId").value("first-ticket-id"));

        mockMvc.perform(multipart("/api/agent/log-uploads")
                        .file(new MockMultipartFile(
                                "file",
                                "agent-log.jsonl.gz",
                                "application/gzip",
                                gzip("same logical log\n")
                        ))
                        .header("Authorization", "Bearer " + OTHER_AGENT_TOKEN)
                        .header("Idempotency-Key", "shared-upload-key")
                        .param("rangeMinutes", "30"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.ticketId").value("second-ticket-id"));

        verify(pcAgentAsService).uploadLogs(eq(firstAgent), any(), any(), eq("shared-upload-key"));
        verify(pcAgentAsService).uploadLogs(eq(secondAgent), any(), any(), eq("shared-upload-key"));
        verify(pcAgentAsService, times(2)).uploadLogs(any(), any(), any(), eq("shared-upload-key"));
    }

    @Test
    void minimalAgentAsHappyPathCanRunThroughHttpEndpoints() throws Exception {
        AgentPrincipal principal = authenticateAgent();
        when(agentIdempotencyService.reserve(eq(principal), anyString(), anyString(), anyString(), anyString()))
                .thenReturn(
                        AgentIdempotencyDecision.proceed(201L),
                        AgentIdempotencyDecision.proceed(202L),
                        AgentIdempotencyDecision.proceed(203L),
                        AgentIdempotencyDecision.replay(
                                201,
                                """
                                        {
                                          "uploadJobId": "upload-job-public-id",
                                          "logUploadId": "log-upload-public-id",
                                          "ticketId": "ticket-public-id",
                                          "analysisStatus": "RULE_READY",
                                          "reviewStatus": "REQUIRED",
                                          "supportDecision": "NEEDS_MORE_INFO"
                                        }
                                        """,
                                MediaType.APPLICATION_JSON_VALUE
                        )
                );
        when(pcAgentAsService.register(anyMap())).thenReturn(Map.of(
                "deviceId", "device-public-id",
                "agentToken", AGENT_TOKEN,
                "status", "ACTIVE"
        ));
        when(pcAgentAsService.saveConsent(eq(principal), anyMap(), eq("consent-key"))).thenReturn(Map.of(
                "id", "consent-public-id",
                "accepted", true
        ));
        when(pcAgentAsService.heartbeat(eq(principal), anyMap(), eq("heartbeat-key"))).thenReturn(Map.of(
                "deviceId", "device-public-id",
                "status", "ACTIVE"
        ));
        when(pcAgentAsService.uploadLogs(eq(principal), any(), any(), eq("upload-key"))).thenReturn(Map.of(
                "uploadJobId", "upload-job-public-id",
                "logUploadId", "log-upload-public-id",
                "ticketId", "ticket-public-id",
                "analysisStatus", "RULE_READY",
                "reviewStatus", "REQUIRED",
                "supportDecision", "NEEDS_MORE_INFO"
        ));
        when(ticketQueryService.update(eq("ticket-public-id"), eq(Map.of(
                "supportDecision", "REMOTE_POSSIBLE",
                "reviewStatus", "APPROVED",
                "adminNote", "Remote support link sent."
        )), isNull())).thenReturn(Map.of(
                "id", "ticket-public-id",
                "analysisStatus", "RULE_READY",
                "reviewStatus", "APPROVED",
                "supportDecision", "REMOTE_POSSIBLE"
        ));
        when(ticketQueryService.ticket(eq("ticket-public-id"), isNull())).thenReturn(Map.of(
                "id", "ticket-public-id",
                "status", "OPEN",
                "analysisStatus", "RULE_READY",
                "reviewStatus", "APPROVED",
                "supportDecision", "REMOTE_POSSIBLE"
        ));

        MvcResult registerResult = mockMvc.perform(post("/api/agent/devices/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "activationToken": "valid-agent-activation-token",
                                  "deviceFingerprintHash": "fingerprint-hash",
                                  "registrationIdempotencyKey": "register-key",
                                  "osVersion": "Windows 11",
                                  "agentVersion": "0.1.0",
                                  "policyVersion": "policy-v1"
                                }
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.agentToken").value(AGENT_TOKEN))
                .andReturn();
        String issuedAgentToken = objectMapper.readTree(registerResult.getResponse().getContentAsString())
                .get("agentToken")
                .asText();

        mockMvc.perform(post("/api/agent/consents")
                        .header("Authorization", "Bearer " + issuedAgentToken)
                        .header("Idempotency-Key", "consent-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "consentType": "SERVER_UPLOAD",
                                  "policyVersion": "policy-v1",
                                  "accepted": true
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accepted").value(true));

        mockMvc.perform(post("/api/agent/heartbeat")
                        .header("Authorization", "Bearer " + issuedAgentToken)
                        .header("Idempotency-Key", "heartbeat-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "agentVersion": "0.1.0",
                                  "serviceStatus": "RUNNING",
                                  "policyVersion": "policy-v1"
                                }
                                """))
                .andExpect(status().isOk());

        MockMultipartFile file = new MockMultipartFile(
                "file",
                "agent-log.jsonl.gz",
                "application/gzip",
                gzip("demo log\n")
        );
        mockMvc.perform(multipart("/api/agent/log-uploads")
                        .file(file)
                        .header("Authorization", "Bearer " + issuedAgentToken)
                        .header("Idempotency-Key", "upload-key")
                        .param("rangeMinutes", "30")
                        .param("symptom", "GPU temperature spike"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.ticketId").value("ticket-public-id"))
                .andExpect(jsonPath("$.analysisStatus").value("RULE_READY"));

        MockMultipartFile retryFile = new MockMultipartFile(
                "file",
                "agent-log.jsonl.gz",
                "application/gzip",
                gzip("demo log\n")
        );
        mockMvc.perform(multipart("/api/agent/log-uploads")
                        .file(retryFile)
                        .header("Authorization", "Bearer " + issuedAgentToken)
                        .header("Idempotency-Key", "upload-key")
                        .param("rangeMinutes", "30")
                        .param("symptom", "GPU temperature spike"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.ticketId").value("ticket-public-id"))
                .andExpect(jsonPath("$.analysisStatus").value("RULE_READY"));

        mockMvc.perform(patch("/api/admin/as-tickets/ticket-public-id")
                        .header("Authorization", ADMIN_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "supportDecision": "REMOTE_POSSIBLE",
                                  "reviewStatus": "APPROVED",
                                  "adminNote": "Remote support link sent."
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.supportDecision").value("REMOTE_POSSIBLE"));

        mockMvc.perform(get("/api/as-tickets/ticket-public-id")
                        .header("Authorization", USER_TOKEN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.analysisStatus").value("RULE_READY"))
                .andExpect(jsonPath("$.supportDecision").value("REMOTE_POSSIBLE"));

        verify(pcAgentAsService, times(2)).uploadLogs(eq(principal), any(), any(), eq("upload-key"));
    }

    private static byte[] gzip(String content) {
        try {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            try (GZIPOutputStream gzipOutput = new GZIPOutputStream(output)) {
                gzipOutput.write(content.getBytes());
            }
            return output.toByteArray();
        } catch (IOException exception) {
            throw new IllegalStateException(exception);
        }
    }

    private AgentPrincipal authenticateAgent() {
        AgentPrincipal principal = new AgentPrincipal(10L, "device-public-id", 20L, "ACTIVE");
        when(agentTokenAuthenticationService.authenticate(AGENT_TOKEN))
                .thenReturn(AgentTokenAuthenticationResult.authenticated(principal));
        return principal;
    }
}

import { expect, test, type Request, type Route } from '@playwright/test';

const screenshotDir = '../../artifacts/qa/agent-as';
type MockTicket = Record<string, unknown> & { id: string };

const beforeDecisionTicket = {
  id: 'qa-ticket-before',
  status: 'OPEN',
  analysisStatus: 'RULE_READY',
  reviewStatus: 'REQUIRED',
  supportDecision: 'NEEDS_MORE_INFO',
  riskLevel: 'MEDIUM',
  symptom: 'GPU temperature spike during gaming',
  logUploadId: 'log-upload-before',
  logSummaryText: 'GPU 온도 상승 신호가 있지만 방문/원격 판단에는 추가 확인이 필요합니다.',
  logSummary: {
    summaryText: 'GPU 온도 상승 신호가 있지만 방문/원격 판단에는 추가 확인이 필요합니다.',
    dataQuality: { level: 'PARTIAL' },
    incidentWindow: {
      startedAt: '2026-07-02T06:00:00Z',
      endedAt: '2026-07-02T06:30:00Z',
      symptomType: 'REMOTE_DRIVER_OS'
    },
    correlations: [
      { type: 'AS_RAG_MATCH', summary: 'GPU thermal throttling 신호가 감지됐습니다.' }
    ],
    rawSamples: [
      {
        refId: 'sample-1',
        schemaVersion: '1',
        collectedAt: '2026-07-02T06:18:20Z',
        agentId: 'agent-qa-001',
        sequence: 42,
        kind: 'SYSTEM_METRIC',
        payload: {
          gpuTemperatureC: 95,
          message: 'gpu temperature reached 95c',
          diagnosticContext: 'masked-context-'.repeat(24)
        },
        privacyFlags: { containsRawPath: false, masked: true }
      },
      {
        sampleId: 'legacy-sample-2',
        text: JSON.stringify({
          capturedAt: '2026-07-02T06:19:20Z',
          event: 'frame_drop',
          fpsAvg: 47
        })
      }
    ]
  },
  supportRouting: {
    recommendedDecision: 'NEEDS_MORE_INFO',
    confidence: 'LOW',
    reasonCodes: ['GPU_THERMAL_SPIKE'],
    remoteActions: ['CHECK_GPU_DRIVER'],
    visitReasons: [],
    blockingFactors: ['INSUFFICIENT_LOG_RANGE'],
    recommendedService: 'DIAGNOSIS_ONLY',
    recommendedServiceLabel: '우선 진단만 받기',
    requiresAdminApproval: true
  },
  assignedAdminId: null,
  causeCandidates: [
    { label: 'GPU thermal throttling', confidence: 'HIGH', evidenceIds: ['gpu-temperature-95c'] }
  ],
  upgradeCandidates: [],
  adminNote: null,
  remoteSupportLink: null,
  remoteSupportStatus: null,
  safetyAdviceLevel: 'STOP_USE_UNTIL_REVIEW',
  safetyNotices: [
    { code: 'THERMAL_DAMAGE_RISK', message: '담당자 검토 전까지 고부하 작업을 중지해 주세요.' }
  ],
  visitSupportRequired: false,
  createdAt: '2026-07-02T06:30:00Z'
};

const afterDecisionTicket = {
  ...beforeDecisionTicket,
  id: 'qa-ticket-after',
  status: 'IN_PROGRESS',
  reviewStatus: 'APPROVED',
  supportDecision: 'REMOTE_POSSIBLE',
  assignedAdminId: 'admin-public-id',
  adminNote: 'Remote support link sent.',
  remoteSupportLink: 'https://support.example.test/session/qa-ticket-after',
  remoteSupportStatus: 'LINK_SENT'
};

const visitRecommendedTicket = {
  ...beforeDecisionTicket,
  id: 'qa-ticket-visit',
  supportDecision: 'VISIT_REQUIRED',
  riskLevel: 'HIGH',
  symptom: 'Kernel-Power 반복 종료와 WHEA 오류',
  logSummaryText: 'Kernel-Power와 WHEA 오류가 반복되어 현장 점검 가능성이 높습니다.',
  supportRouting: {
    recommendedDecision: 'VISIT_REQUIRED',
    confidence: 'HIGH',
    reasonCodes: ['KERNEL_POWER_REPEAT', 'WHEA_ERROR_REPEAT'],
    remoteActions: [],
    visitReasons: ['POWER_OR_BOARD_CHECK_REQUIRED'],
    blockingFactors: [],
    recommendedService: 'VISIT_SUPPORT',
    recommendedServiceLabel: '방문지원 신청',
    requiresAdminApproval: true
  }
};

const code43AgentTicket = {
  ...beforeDecisionTicket,
  id: 'qa-ticket-code43',
  status: 'OPEN',
  reviewStatus: 'REQUIRED',
  supportDecision: null,
  symptom: '게임 중 화면이 끊기고 검은 화면이 나타납니다.',
  userId: 'user-code43-public-id',
  userEmail: 'code43-user@example.com',
  userName: 'Code43 User',
  logUploadId: null,
  diagnosisId: '9a0e3c21-6648-41e7-a88e-17be1761b806',
  diagnosisMode: 'DEMO',
  diagnosisTitle: '그래픽 장치 오류 상태가 확인되었습니다',
  diagnosisSummary: 'Intel Arc A350M이 Code 43을 보고해 원격 지원을 권장합니다.',
  diagnosisEvidence: [
    {
      taskId: 'windows_display_devices',
      component: 'gpu',
      metricType: 'display_device_status',
      value: {
        deviceName: 'Intel(R) Arc(TM) A350M Graphics',
        instanceId: 'PCI\\VEN_8086&DEV_5694',
        problemCode: 43,
        problemCodeQueryStatus: 'OK'
      },
      status: 'DEVICE_REPORTED_PROBLEM',
      source: 'Win32_PnPEntity',
      sampledAt: '2026-07-20T11:18:25Z'
    },
    {
      taskId: 'current_system_status',
      component: 'system',
      metricType: 'observation_window',
      value: { sampleCount: 3, sampleTimestamps: ['2026-07-20T11:18:21Z'] },
      status: 'OBSERVED',
      source: 'MetricsStore',
      sampledAt: '2026-07-20T11:18:21Z'
    },
    {
      taskId: 'evidence_finalize',
      component: 'system',
      metricType: 'evidence_summary',
      value: [{ taskId: 'windows_display_devices', status: 'COMPLETED', evidenceCount: 3 }],
      status: 'COMPLETED',
      source: 'DiagnosisOrchestrator',
      sampledAt: '2026-07-20T11:18:17Z'
    }
  ],
  diagnosisResult: {
    recommendedActions: ['그래픽 드라이버 재설치 또는 이전 버전 롤백', '원격 AS 기사 연결']
  },
  diagnosisEvents: [
    { eventId: 'event-code43-1', progressPercent: 35, message: '그래픽 장치 상태 확인 중' },
    { eventId: 'event-code43-2', progressPercent: 100, message: 'Code 43 진단 완료' }
  ],
  logSummaryText: null,
  logSummary: null,
  supportRouting: {
    recommendedDecision: 'REMOTE_POSSIBLE',
    confidence: 'HIGH',
    reasonCodes: ['GRAPHICS_DEVICE_CODE_43'],
    remoteActions: ['그래픽 드라이버 재설치 또는 이전 버전 롤백', '원격 AS 기사 연결'],
    visitReasons: [],
    blockingFactors: [],
    recommendedService: 'REMOTE_SUPPORT',
    recommendedServiceLabel: '원격지원 신청',
    requiresAdminApproval: true
  },
  causeCandidates: [],
  upgradeCandidates: []
};

const noSampleTicket = {
  ...beforeDecisionTicket,
  id: 'qa-ticket-no-samples',
  logSummary: {
    ...beforeDecisionTicket.logSummary,
    rawSamples: []
  }
};

const diagnosisOnlyTicket = {
  ...beforeDecisionTicket,
  id: 'qa-ticket-diagnosis-evidence',
  logUploadId: null,
  logSummaryText: null,
  logSummary: null,
  diagnosisEvidence: [
    {
      taskId: 'gpu-temperature',
      component: 'gpu',
      metricType: 'temperature',
      value: 95,
      unit: 'C',
      availability: 'AVAILABLE',
      status: 'ABNORMAL',
      source: 'nvidia-smi',
      sampledAt: '2026-07-02T06:18:20Z'
    }
  ]
};

test('captures Agent AS demo UI evidence and verifies admin decision reflection', async ({ page }) => {
  // 화면 증적 캡처 + 티켓 상담방 채팅 흐름까지 한 번에 도는 긴 테스트라 병렬 부하에서 30초를 넘길 수 있다.
  test.slow();
  await mockAgentAsSupportStomp(page);
  const consoleErrors: string[] = [];
  const apiCalls: string[] = [];
  const tickets = new Map<string, MockTicket>([
    [beforeDecisionTicket.id, beforeDecisionTicket],
    [afterDecisionTicket.id, afterDecisionTicket],
    [visitRecommendedTicket.id, visitRecommendedTicket],
    [code43AgentTicket.id, code43AgentTicket],
    [noSampleTicket.id, noSampleTicket],
    [diagnosisOnlyTicket.id, diagnosisOnlyTicket]
  ]);
  let currentTestRole: 'USER' | 'ADMIN' = 'USER';
  let reviewActionPayload: Record<string, unknown> | undefined;
  let deletedTicketId: string | undefined;

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.token', 'jwt-user-token');
  });

  await page.route('**/api/auth/me', async (route) => {
    recordApiCall(apiCalls, route.request());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(currentTestRole === 'ADMIN'
        ? { id: 'admin-001', email: 'admin@example.com', role: 'ADMIN' }
        : { id: 'user-001', email: 'user@example.com', role: 'USER' })
    });
  });
  await page.route('**/api/support/chat-sessions/current**', async (route) => {
    recordApiCall(apiCalls, route.request());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ contact: chatRoom, messages: [], supportNewPath: '/support/new' })
    });
  });
  await page.route(/\/api\/as-tickets\/[^/]+$/, async (route) => {
    recordApiCall(apiCalls, route.request());
    const ticketId = lastPathSegment(route.request().url());
    await fulfillTicket(route, tickets.get(ticketId));
  });
  await page.route('**/api/admin/as-tickets', async (route) => {
    recordApiCall(apiCalls, route.request());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: Array.from(tickets.values()), page: 0, size: 20, total: tickets.size })
    });
  });
  await page.route(/\/api\/admin\/as-tickets\/[^/]+$/, async (route) => {
    recordApiCall(apiCalls, route.request());
    const ticketId = lastPathSegment(route.request().url());
    if (route.request().method() === 'DELETE') {
      deletedTicketId = ticketId;
      tickets.delete(ticketId);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: ticketId,
          deleted: true,
          deletedAt: '2026-07-16T06:00:00Z'
        })
      });
      return;
    }
    await fulfillTicket(route, tickets.get(ticketId));
  });
  await page.route(/\/api\/admin\/as-tickets\/[^/]+\/approve-remote-support$/, async (route) => {
    recordApiCall(apiCalls, route.request());
    const match = new URL(route.request().url()).pathname.match(/\/api\/admin\/as-tickets\/([^/]+)\/approve-remote-support$/);
    const ticketId = match?.[1] ?? beforeDecisionTicket.id;
    reviewActionPayload = route.request().postDataJSON() as Record<string, unknown>;
    const current = tickets.get(ticketId) ?? beforeDecisionTicket;
    const updated = {
      ...current,
      id: ticketId,
      status: 'IN_PROGRESS',
      requestType: 'REMOTE_SUPPORT',
      reviewStatus: 'APPROVED',
      supportDecision: 'REMOTE_POSSIBLE',
      assignedAdminId: 'admin-001',
      adminNote: reviewActionPayload.adminNote,
      reviewedAt: '2026-07-16T06:00:00Z',
      remoteSupportStatus: 'WAITING_FOR_CODE'
    };
    tickets.set(ticketId, updated);
    await fulfillTicket(route, updated);
  });
  await page.route(/\/api\/(?:admin\/)?as-tickets\/[^/]+\/remote-support$/, async (route) => {
    recordApiCall(apiCalls, route.request());
    const match = new URL(route.request().url()).pathname.match(/\/api\/(?:admin\/)?as-tickets\/([^/]+)\/remote-support$/);
    const ticket = tickets.get(match?.[1] ?? beforeDecisionTicket.id) ?? beforeDecisionTicket;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: ticket.remoteSupportStatus ?? 'REQUESTED',
        provider: 'CHROME_REMOTE_DESKTOP',
        accessCodeRegistered: false,
        maskedAccessCode: null,
        accessCodeRegisteredAt: null,
        startedAt: null,
        completedAt: null
      })
    });
  });

  // 티켓 상세에 상담방 채팅이 박히면서 관리자 채팅 API도 모킹한다.
  // (모킹이 없으면 dev proxy가 죽은 포트로 향해 콘솔 에러 단언이 깨진다.)
  const chatRoom = {
    id: 'qa-chat-room-1',
    asTicketId: beforeDecisionTicket.id,
    status: 'ACTIVE',
    ticketStatus: 'OPEN',
    title: 'AS 상담방',
    symptom: 'GPU temperature spike during gaming',
    lastMessagePreview: '게임 중 GPU 온도가 계속 올라갑니다.',
    lastMessageAt: '2026-07-02T07:00:00Z',
    adminUnreadCount: 1,
    canSendMessage: true,
    user: { id: 'user-001', email: 'user@example.com', name: 'QA User' }
  };
  let chatMessages: Array<Record<string, unknown>> = [
    { id: 'chat-msg-1', role: 'SYSTEM', content: '상담방이 생성되었습니다. 문의 내용을 남기면 담당자가 확인합니다.', createdAt: '2026-07-02T06:31:00Z' },
    { id: 'chat-msg-2', role: 'USER', content: '게임 중 GPU 온도가 계속 올라갑니다.', senderName: 'QA User', createdAt: '2026-07-02T07:00:00Z' }
  ];
  let chatMessagePayload: Record<string, unknown> | undefined;
  await page.route('**/api/support/chat-sessions/qa-chat-room-1**', async (route) => {
    recordApiCall(apiCalls, route.request());
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/ws-ticket')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ contact: chatRoom, messages: chatMessages, pollingIntervalMs: 5000 })
    });
  });
  await page.route('**/api/admin/support/chat-sessions', async (route) => {
    recordApiCall(apiCalls, route.request());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [chatRoom], pollingIntervalMs: 5000 })
    });
  });
  await page.route('**/api/admin/support/chat-sessions/qa-chat-room-1**', async (route) => {
    recordApiCall(apiCalls, route.request());
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/ws-ticket')) {
      // ticket 없이 응답하면 openSupportChatSocket이 WebSocket을 열지 않고 조용히 폴링으로 남는다.
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
      return;
    }
    if (route.request().method() === 'POST' && url.pathname.endsWith('/messages')) {
      chatMessagePayload = route.request().postDataJSON() as Record<string, unknown>;
      chatMessages = [
        ...chatMessages,
        {
          id: `chat-msg-${chatMessages.length + 1}`,
          role: 'ADMIN',
          content: String(chatMessagePayload.content ?? ''),
          senderName: 'BuildGraph Admin',
          createdAt: '2026-07-02T07:05:00Z'
        }
      ];
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ contact: chatRoom, messages: chatMessages, pollingIntervalMs: 5000 })
    });
  });

  await page.goto('/support/new');
  await expect(page.getByRole('main')).toContainText('AS 접수');
  await expect(page.getByRole('main')).toContainText('문제 발생 전후 로그');
  await expect(page.getByRole('main')).toContainText('선택 구간 로그 파일');
  await page.screenshot({ path: `${screenshotDir}/01-support-new.png`, fullPage: true });

  await page.goto('/support/qa-ticket-before');
  await expect(page.getByRole('main')).toContainText('규칙 진단 완료');
  await expect(page.getByRole('main')).toContainText('검토 필요');
  await expect(page.getByRole('main')).toContainText('추가 정보 필요');
  await expect(page.getByRole('main')).toContainText('안전 안내');
  await expect(page.getByRole('main')).toContainText('고부하 작업을 중지');
  await expect(page.getByRole('main')).not.toContainText('담당자 확인 자료');
  await expect(page.getByRole('main')).not.toContainText('[object Object]');
  await expect(page.getByRole('main')).toContainText('지원 진행');
  await expect(page.getByRole('main')).toContainText('담당자 확인 중');
  const openTicketChatButton = page.getByRole('main').getByRole('button', { name: '상담방 열기' });
  await expect(openTicketChatButton).toBeVisible();
  await openTicketChatButton.click();
  await expect(page.getByText('PC Agent 상담방')).toBeVisible();
  await expect(page.getByRole('main')).not.toContainText('undefined');
  await page.screenshot({ path: `${screenshotDir}/02-support-ticket-before-decision.png`, fullPage: true });

  await page.evaluate(() => {
    localStorage.setItem('buildgraph.token', 'jwt-admin-token');
  });
  currentTestRole = 'ADMIN';
  // auth/me 응답 캐시는 앱 런타임 단위이므로 관리자 세션 전환은 새 런타임에서 검증한다.
  await page.reload();
  await page.goto('/admin/as-tickets');
  await expect(page.getByRole('main')).toContainText('추천 서비스');
  await expect(page.getByRole('main')).toContainText('방문지원 신청');
  await expect(page.getByRole('main')).toContainText('원격지원 신청');
  await expect(page.getByRole('main')).toContainText('code43-user@example.com');

  for (const column of ['상태', '검토', '결정', '추천 서비스']) {
    await expect(page.getByRole('columnheader', { name: column, exact: true })).toHaveCSS('white-space', 'nowrap');
  }

  const nowrapValues = [
    page.getByTitle('OPEN').first(),
    page.getByTitle('REQUIRED').first(),
    page.getByTitle('VISIT_REQUIRED').first(),
    page.getByText('방문지원 신청', { exact: true }).first()
  ];
  for (const value of nowrapValues) {
    await expect(value).toHaveCSS('white-space', 'nowrap');
    expect(await value.evaluate((element) => (
      element.scrollWidth <= element.clientWidth + 1
      && element.scrollHeight <= element.clientHeight + 1
    ))).toBe(true);
  }

  const ticketListPanel = page.getByTestId('admin-as-ticket-list-panel');
  const ticketSummaryPanel = page.getByTestId('admin-as-ticket-summary-panel');
  await expect(ticketListPanel).toContainText('그래픽 장치 오류');
  await expect(ticketSummaryPanel).toContainText('최근 접수');
  await expect(ticketSummaryPanel.getByRole('link', { name: '상세 보기', exact: true })).toHaveAttribute('href', '/admin/as-tickets/qa-ticket-before');
  await expect(ticketSummaryPanel).not.toContainText('ticketId');
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const listBox = await ticketListPanel.boundingBox();
    const summaryBox = await ticketSummaryPanel.boundingBox();
    expect(listBox).not.toBeNull();
    expect(summaryBox).not.toBeNull();
    expect(summaryBox!.y).toBeGreaterThan(listBox!.y + listBox!.height);
  }

  await page.goto('/admin/as-tickets/qa-ticket-code43');
  const code43Overview = page.getByTestId('admin-as-ticket-overview');
  await expect(code43Overview).toContainText('Intel(R) Arc(TM) A350M Graphics에서 Windows PnP problem code 43이 확인됐습니다.');
  await expect(code43Overview).toContainText('장치 상태: DEVICE_REPORTED_PROBLEM.');
  await expect(page.getByRole('main')).toContainText('그래픽 드라이버 재설치 또는 이전 버전 롤백');
  await expect(page.getByRole('main')).toContainText('규칙 진단 완료');
  await expect(page.getByRole('main')).toContainText('원격지원 신청');
  await expect(code43Overview).not.toContainText('[object Object]');
  await expect(code43Overview).not.toContainText('sampleTimestamps');
  const showCode43Evidence = code43Overview.getByRole('button', { name: '에이전트 데이터 보기 (3건)', exact: true });
  await showCode43Evidence.click();
  await expect(code43Overview.getByTestId('agent-log-samples-panel')).toContainText('"sampleCount": 3');
  await expect(code43Overview.getByTestId('agent-log-samples-panel')).toContainText('"taskId": "windows_display_devices"');
  await expect(code43Overview.getByTestId('agent-log-samples-panel')).not.toContainText('[object Object]');

  await page.goto('/admin/as-tickets/qa-ticket-before');
  await expect(page.getByRole('main')).toContainText('관리자 검토');
  await expect(page.getByRole('main')).toContainText('Agent 권장 처리');
  // DB 필드 직접 수정 폼은 제거하고, 구조화된 검토 정보와 티켓 상담방을 함께 제공한다.
  await expect(page.getByRole('main')).not.toContainText('지원 결정 저장');
  await expect(page.getByTestId('admin-ticket-support-chat')).toBeVisible();
  await expect(page.getByRole('main')).toContainText('사용자 요청 지원');
  await expect(page.getByRole('main')).toContainText('우선 진단만 받기');
  await expect(page.getByRole('main')).toContainText('GPU 온도 상승 신호');
  await expect(page.getByTestId('admin-ticket-issue-spotlight')).toHaveCount(0);
  const receipt = page.getByTestId('admin-ticket-receipt');
  await expect(receipt).toContainText('추정 원인');
  await expect(receipt).toContainText('GPU thermal throttling');
  await expect(receipt).toContainText('권장 처리');
  await expect(receipt).toContainText('우선 진단만 받기');

  const ticketOverview = page.getByTestId('admin-as-ticket-overview');
  await expect(ticketOverview).not.toContainText('[object Object]');
  const evidenceCode = ticketOverview.getByTestId('structured-evidence-list').filter({ hasText: 'GPU thermal throttling' }).locator('pre code');
  await expect(evidenceCode).toContainText('"label": "GPU thermal throttling"');
  const overviewLabels = await ticketOverview.locator('dt').allTextContents();
  expect(overviewLabels.slice(0, 4)).toEqual(['상태', '접수 시각', '사용자', '담당자']);
  for (const removedLabel of [
    '추천 근거 코드',
    '원격 조치 후보',
    '방문 판단 근거',
    '차단 요인',
    '원인 후보',
    '업그레이드 후보',
    '원격지원',
    '방문지원'
  ]) {
    expect(overviewLabels).not.toContain(removedLabel);
  }

  const showAgentLogs = ticketOverview.getByRole('button', { name: '에이전트 데이터 보기 (2건)', exact: true });
  await expect(showAgentLogs).toHaveAttribute('aria-expanded', 'false');
  await expect(ticketOverview.getByTestId('agent-log-samples-panel')).toHaveCount(0);
  await showAgentLogs.click();
  await expect(ticketOverview.getByTestId('agent-log-samples-panel')).toBeVisible();
  await expect(ticketOverview).toContainText('개인정보가 마스킹된 핵심 업로드 로그 샘플이며 최대 20건까지 표시됩니다.');
  await expect(ticketOverview).toContainText('SYSTEM_METRIC');
  await expect(ticketOverview).toContainText('#42');
  await expect(ticketOverview).toContainText('gpu temperature reached 95c');
  await expect(ticketOverview).toContainText('frame_drop');

  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => (
      document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
    ))).toBe(true);
  }

  await ticketOverview.getByRole('button', { name: '에이전트 데이터 닫기', exact: true }).click();
  await expect(ticketOverview.getByTestId('agent-log-samples-panel')).toHaveCount(0);

  await page.goto('/admin/as-tickets/qa-ticket-no-samples');
  await expect(page.getByTestId('admin-as-ticket-overview')).toContainText('업로드된 로그가 있으나 표시 가능한 샘플이 없습니다.');

  await page.goto('/admin/as-tickets/qa-ticket-diagnosis-evidence');
  const diagnosisOverview = page.getByTestId('admin-as-ticket-overview');
  await diagnosisOverview.getByRole('button', { name: '에이전트 데이터 보기 (1건)', exact: true }).click();
  await expect(diagnosisOverview.getByTestId('agent-log-samples-panel')).toContainText('실시간 진단 근거');
  await expect(diagnosisOverview.getByTestId('agent-log-samples-panel')).toContainText('gpu · temperature');
  await expect(diagnosisOverview.getByTestId('agent-log-samples-panel')).toContainText('nvidia-smi');
  await expect(page.getByRole('main')).toContainText('PC Agent 실시간 진단 근거 1건 연결됨');

  // 상담방 답변과 관리자 검토 액션은 서로의 상태를 덮어쓰지 않고 함께 동작한다.
  await page.goto('/admin/as-tickets/qa-ticket-before');
  const ticketChat = page.getByTestId('admin-ticket-support-chat');
  await expect(ticketChat).toContainText('게임 중 GPU 온도가 계속 올라갑니다.');
  await ticketChat.getByPlaceholder('관리자 답변을 입력하세요').fill('원격 지원 링크를 보내드렸습니다.');
  await ticketChat.getByRole('button', { name: '답변 전송' }).click();
  await expect(ticketChat).toContainText('원격 지원 링크를 보내드렸습니다.');
  chatMessagePayload = await page.evaluate(() => (
    window as unknown as { __agentAsChatPayload?: Record<string, unknown> }
  ).__agentAsChatPayload);
  expect(chatMessagePayload).toMatchObject({ content: '원격 지원 링크를 보내드렸습니다.' });
  await expect(ticketChat.getByPlaceholder('관리자 답변을 입력하세요')).toHaveValue('');

  await page.getByLabel('관리자 메모').fill('Remote support approved.');
  await page.getByRole('button', { name: '원격 지원 승인' }).click();
  await expect(page.getByRole('main')).toContainText('처리 결과');
  await expect(page.getByRole('main')).toContainText('원격 지원 가능');
  await expect(page.getByRole('main')).toContainText('지원 코드 등록 대기');
  await expect(page.getByRole('main')).toContainText('Remote support approved.');
  await expect(page.getByRole('main')).not.toContainText('undefined');
  expect(reviewActionPayload).toMatchObject({
    adminNote: 'Remote support approved.'
  });
  await expect(page.getByRole('main')).not.toContainText('undefined');
  await page.screenshot({ path: `${screenshotDir}/03-admin-ticket-chat-and-review.png`, fullPage: true });

  await page.evaluate(() => {
    localStorage.setItem('buildgraph.token', 'jwt-user-token');
  });
  // 결정 반영 사용자측 화면은 결정이 저장된 정적 시드 티켓(qa-ticket-after)으로 확인한다.
  await page.goto('/support/qa-ticket-after');
  await expect(page.getByRole('main')).toContainText('승인됨');
  await expect(page.getByRole('main')).toContainText('원격 지원 가능');
  await expect(page.getByRole('main')).toContainText('원격 지원이 승인되었습니다');
  await expect(page.getByRole('main')).toContainText('지원 코드');
  await page.screenshot({ path: `${screenshotDir}/04-support-ticket-after-decision.png`, fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/support/qa-ticket-after');
  await expect(page.getByRole('main')).toContainText('원격 지원 가능');
  await expect(page.getByRole('main')).toContainText('원격 지원이 승인되었습니다');
  await page.screenshot({ path: `${screenshotDir}/05-mobile-ticket.png`, fullPage: true });

  await page.evaluate(() => {
    localStorage.setItem('buildgraph.token', 'jwt-admin-token');
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/admin/as-tickets');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'AS 티켓 qa-ticket-no-samples 삭제', exact: true }).click();
  await expect(page.getByRole('button', { name: 'AS 티켓 qa-ticket-no-samples 삭제', exact: true })).toHaveCount(0);
  expect(deletedTicketId).toBe('qa-ticket-no-samples');

  expect(apiCalls).toEqual(expect.arrayContaining([
    'GET /api/as-tickets/qa-ticket-before',
    'GET /api/admin/as-tickets/qa-ticket-before',
    'POST /api/admin/as-tickets/qa-ticket-before/approve-remote-support',
    'GET /api/admin/support/chat-sessions',
    'DELETE /api/admin/as-tickets/qa-ticket-no-samples'
  ]));
  expect(consoleErrors).toEqual([]);
});

function recordApiCall(apiCalls: string[], request: Request) {
  apiCalls.push(`${request.method()} ${new URL(request.url()).pathname}`);
}

function lastPathSegment(url: string) {
  const pathname = new URL(url).pathname;
  return pathname.slice(pathname.lastIndexOf('/') + 1);
}

async function fulfillTicket(route: Route, ticket: unknown) {
  if (!ticket) {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'NOT_FOUND', message: 'Ticket not found' })
    });
    return;
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ticket) });
}

async function mockAgentAsSupportStomp(page: Page) {
  await page.addInitScript(() => {
    type FakeSocketShape = EventTarget & {
      readyState: number;
      frames: string[];
      serverMessage: (data: string) => void;
    };
    const sockets: FakeSocketShape[] = [];

    class FakeWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = FakeWebSocket.CONNECTING;
      binaryType: BinaryType = 'blob';
      protocol = 'v12.stomp';
      extensions = '';
      bufferedAmount = 0;
      frames: string[] = [];
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor(public readonly url: string) {
        super();
        sockets.push(this as unknown as FakeSocketShape);
        setTimeout(() => {
          this.readyState = FakeWebSocket.OPEN;
          const event = new Event('open');
          this.onopen?.(event);
        }, 0);
      }

      send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
        const frame = String(data);
        this.frames.push(frame);
        if (frame.startsWith('CONNECT\n') || frame.startsWith('STOMP\n')) {
          setTimeout(() => this.serverMessage('CONNECTED\nversion:1.2\nheart-beat:0,0\n\n\0'), 0);
          return;
        }
        if (frame.startsWith('SEND\n')) {
          const payload = JSON.parse(frame.slice(frame.indexOf('\n\n') + 2).replace(/\0$/, '')) as {
            roomId: string;
            clientMessageId: string;
            content: string;
          };
          (window as unknown as { __agentAsChatPayload?: Record<string, unknown> }).__agentAsChatPayload = payload;
          const destination = `/topic/support-chat/rooms/${payload.roomId}`;
          const subscription = [...this.frames].reverse().find((candidate) =>
            candidate.startsWith('SUBSCRIBE\n') && stompHeader(candidate, 'destination') === destination
          );
          if (!subscription) return;
          const event = {
            type: 'MESSAGE_CREATED',
            messageId: '00000000-0000-4000-8000-000000009999',
            clientMessageId: payload.clientMessageId,
            roomId: payload.roomId,
            senderId: 'admin-001',
            senderRole: 'ADMIN',
            senderName: 'BuildGraph Admin',
            content: payload.content,
            createdAt: '2026-07-02T07:05:00Z',
            room: {
              roomId: payload.roomId,
              asTicketId: 'qa-ticket-before',
              status: 'ACTIVE',
              ticketStatus: 'OPEN',
              title: 'AS 상담방',
              symptom: 'GPU temperature spike during gaming',
              lastMessage: payload.content,
              lastMessageAt: '2026-07-02T07:05:00Z',
              userUnreadCount: 1,
              adminUnreadCount: 0,
              canSendMessage: true,
              user: { id: 'user-001', email: 'user@example.com', name: 'QA User' }
            }
          };
          this.serverMessage(
            `MESSAGE\nsubscription:${stompHeader(subscription, 'id')}\ndestination:${destination}\nmessage-id:test-message\ncontent-type:application/json\n\n${JSON.stringify(event)}\0`
          );
        }
      }

      serverMessage(data: string) {
        this.onmessage?.(new MessageEvent('message', { data }));
      }

      close() {
        this.readyState = FakeWebSocket.CLOSED;
        this.onclose?.(new CloseEvent('close', { code: 1000 }));
      }
    }

    function stompHeader(frame: string, name: string) {
      return frame.split('\n').find((line) => line.startsWith(`${name}:`))?.slice(name.length + 1);
    }

    (window as unknown as { WebSocket: typeof WebSocket }).WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });
}

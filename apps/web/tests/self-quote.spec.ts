import { expect, test, type Page } from '@playwright/test';
import { FUSED_BOARD_SIZE } from '../src/features/parts/components/slot-board/fusedPlateConfig';

type KakaoPostcodeData = {
  zonecode: string;
  address: string;
  roadAddress: string;
  jibunAddress: string;
  userSelectedType: 'R' | 'J';
  bname: string;
  buildingName: string;
  apartment: 'Y' | 'N';
};

const checkoutDraft = {
  id: 'draft-checkout-test',
  status: 'ACTIVE',
  name: '셀프 견적',
  items: [
    {
      id: 'draft-item-checkout-gpu',
      partId: 'part-checkout-gpu',
      category: 'GPU',
      name: 'RTX 5070 구매 테스트',
      manufacturer: 'NVIDIA',
      quantity: 1,
      unitPriceAtAdd: 980000,
      currentPrice: 980000,
      lineTotal: 980000,
      attributes: {},
      externalOffer: {
        imageUrl: 'https://example.test/checkout-gpu.png',
        supplierName: '그래픽테스트몰',
        offerUrl: 'https://example.test/checkout-gpu',
        lowPrice: 980000,
        source: 'NAVER_SHOPPING_SEARCH'
      }
    },
    {
      id: 'draft-item-checkout-cpu',
      partId: 'part-checkout-cpu',
      category: 'CPU',
      name: 'Ryzen 7 구매 테스트',
      manufacturer: 'AMD',
      quantity: 1,
      unitPriceAtAdd: 420000,
      currentPrice: 420000,
      lineTotal: 420000,
      attributes: {},
      externalOffer: {
        imageUrl: 'https://example.test/checkout-cpu.png',
        supplierName: '구매처 미확인',
        offerUrl: null,
        lowPrice: 420000,
        source: 'MANUAL_CURRENT_LINEUP'
      }
    }
  ],
  totalPrice: 1400000,
  itemCount: 2
};

function buildGraphResponse(mode = 'ISSUE_PATH') {
  return {
    mode,
    summary: '현재 장바구니 기준으로 GPU, 파워, 케이스 영향 관계를 확인했습니다.',
    nodes: [
      { id: 'part-CPU', type: 'PART', category: 'CPU', label: 'CPU', status: 'PASS', detail: '소켓 기준 부품' },
      { id: 'part-MOTHERBOARD', type: 'PART', category: 'MOTHERBOARD', label: '메인보드', status: 'PASS', detail: 'DDR 규격 확인' },
      { id: 'part-RAM', type: 'PART', category: 'RAM', label: 'RAM', status: 'PASS', detail: '메모리 규격' },
      { id: 'part-GPU', type: 'PART', category: 'GPU', label: 'RTX 5070', status: 'PASS', detail: '선택한 그래픽카드' },
      { id: 'part-PSU', type: 'PART', category: 'PSU', label: '750W 파워', status: 'WARN', detail: '전력 여유 확인' },
      { id: 'part-CASE', type: 'PART', category: 'CASE', label: 'Airflow Case', status: 'PASS', detail: '장착 길이 확인' },
      { id: 'part-COOLER', type: 'PART', category: 'COOLER', label: '쿨러', status: 'PASS', detail: '높이 여유 확인' },
      { id: 'part-STORAGE', type: 'PART', category: 'STORAGE', label: 'SSD', status: 'PASS', detail: '저장장치' }
    ],
    edges: [
      {
        id: 'edge-cpu-board-socket',
        source: 'part-CPU',
        target: 'part-MOTHERBOARD',
        type: 'REQUIRES',
        status: 'PASS',
        label: '소켓 일치',
        summary: 'CPU와 메인보드 소켓이 일치합니다.'
      },
      {
        id: 'edge-gpu-psu-power',
        source: 'part-GPU',
        target: 'part-PSU',
        type: 'AFFECTS',
        status: 'WARN',
        label: '전력 여유',
        summary: 'GPU 권장 정격 파워를 기준으로 PSU 여유를 확인합니다.'
      }
    ],
    focusNodeIds: ['part-GPU', 'part-PSU'],
    insights: [],
    toolResults: []
  };
}

function compositeScoreFixture(score = 734, label = '기본형') {
  return {
    policyVersion: 'build-composite-score-v1',
    score,
    rawScore: score,
    maxScore: 1000,
    grade: score >= 850 ? 'A' : score >= 750 ? 'B' : 'C',
    label,
    summary: '호환성은 통과했지만 성능과 운영 여유를 함께 보면 보완 여지가 있습니다.',
    components: [
      { key: 'performance', label: '성능', score: 288, maxScore: 430, percent: 67, summary: 'CPU/GPU/RAM/저장장치/쿨링 기반' },
      { key: 'compatibility', label: '호환·장착 안전성', score: 220, maxScore: 220, percent: 100, summary: '호환 통과' },
      { key: 'balance', label: '병목·여유 균형', score: 112, maxScore: 160, percent: 70, summary: '전력과 부품 체급 균형' },
      { key: 'upgrade', label: '확장·운영 여유', score: 74, maxScore: 110, percent: 67, summary: '확장성 참고' },
      { key: 'evidence', label: '근거 신뢰도', score: 40, maxScore: 80, percent: 50, summary: 'Tool/벤치 근거' }
    ],
    caps: [],
    requestFit: {
      status: 'PASS',
      score: 100,
      budgetWon: 800000,
      totalPrice: 800000,
      priceDiff: 0,
      summary: '요청 예산에 맞습니다.'
    },
    curve: [],
    missingCategories: []
  };
}

function problemGraphResponse() {
  const base = buildGraphResponse();
  return {
    ...base,
    nodes: base.nodes.map((node) => {
      if (node.category === 'GPU') {
        return { ...node, status: 'FAIL', detail: '파워 용량이 부족합니다.' };
      }
      if (node.category === 'PSU') {
        return { ...node, status: 'WARN', detail: '전력 여유가 빠듯합니다.' };
      }
      return node;
    }),
    edges: [
      {
        id: 'edge-gpu-psu-power',
        source: 'part-GPU',
        target: 'part-PSU',
        type: 'AFFECTS',
        status: 'FAIL',
        label: '전력 150W 부족',
        summary: 'GPU 권장 정격 파워보다 PSU 용량이 부족합니다.'
      }
    ],
    insights: [
      {
        id: 'insight-gpu-power',
        status: 'FAIL',
        title: '파워 용량 부족',
        description: 'GPU 교체 전에 850W 이상 파워를 먼저 검토하세요.',
        relatedNodeIds: ['part-GPU', 'part-PSU']
      }
    ]
  };
}

type MockPartOptions = {
  compatibility?: { status: 'PASS' | 'WARN' | 'FAIL'; statusLabel?: string; summary?: string } | null;
  price?: number;
  supplierName?: string;
};

function candidatePart(id: string, category: string, name: string, options: MockPartOptions = {}) {
  return {
    id,
    category,
    name,
    manufacturer: '테스트제조사',
    price: options.price ?? 100000,
    status: 'ACTIVE',
    attributes: { shortSpec: `${name} 사양` },
    externalOffer: {
      imageUrl: `https://example.test/${id}.png`,
      supplierName: options.supplierName ?? '후보테스트몰',
      offerUrl: `https://example.test/${id}`,
      lowPrice: options.price ?? 100000,
      source: 'NAVER_SHOPPING_SEARCH'
    },
    compatibility: options.compatibility === undefined
      ? { status: 'PASS', statusLabel: '호환 가능', summary: '현재 견적과 호환됩니다.', checkedTools: ['compatibility'] }
      : options.compatibility
  };
}

const emptyDraft = {
  id: 'draft-slot-test',
  status: 'ACTIVE',
  name: '셀프 견적',
  items: [],
  totalPrice: 0,
  itemCount: 0
};

function draftItem(
  partId: string,
  category: string,
  name: string,
  price: number,
  quantity = 1,
  attributes: Record<string, unknown> = {}
) {
  return {
    id: `draft-item-${partId}`,
    partId,
    category,
    name,
    manufacturer: '테스트제조사',
    quantity,
    unitPriceAtAdd: price,
    currentPrice: price,
    lineTotal: price * quantity,
    attributes
  };
}

const fullDraftItems = [
  draftItem('part-cpu-full', 'CPU', '풀보드 CPU', 420000),
  draftItem('part-board-full', 'MOTHERBOARD', '풀보드 메인보드', 250000),
  draftItem('part-ram-full', 'RAM', '풀보드 DDR5 램', 90000, 5),
  draftItem('part-gpu-full', 'GPU', '풀보드 RTX GPU', 980000),
  draftItem('part-ssd-full-1', 'STORAGE', '풀보드 NVMe SSD 1', 120000),
  draftItem('part-ssd-full-2', 'STORAGE', '풀보드 NVMe SSD 2', 130000),
  draftItem('part-ssd-full-3', 'STORAGE', '풀보드 NVMe SSD 3', 140000),
  draftItem('part-psu-full', 'PSU', '풀보드 850W 파워', 160000),
  draftItem('part-case-full', 'CASE', '풀보드 케이스', 110000),
  draftItem('part-cooler-full', 'COOLER', '풀보드 쿨러', 90000)
];

const fullDraft = {
  id: 'draft-slot-full',
  status: 'ACTIVE',
  name: '셀프 견적',
  items: fullDraftItems,
  totalPrice: fullDraftItems.reduce((sum, item) => sum + item.lineTotal, 0),
  itemCount: fullDraftItems.reduce((sum, item) => sum + item.quantity, 0)
};

async function loginAsUser(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.token', 'jwt-user-token');
    localStorage.setItem('buildgraph.homeLoginChoice.dismissed', 'true');
  });
}

async function mockKakaoPostcode(page: Page, overrides: Partial<KakaoPostcodeData> = {}) {
  await page.addInitScript((postcodeOverrides: Partial<KakaoPostcodeData>) => {
    (window as unknown as { kakao: unknown }).kakao = {
      Postcode: class {
        private readonly options: { oncomplete: (data: unknown) => void };

        constructor(options: { oncomplete: (data: unknown) => void }) {
          this.options = options;
        }

        open() {
          this.options.oncomplete({
            zonecode: '06236',
            address: '서울시 강남구 테헤란로 1',
            roadAddress: '서울시 강남구 테헤란로 1',
            jibunAddress: '서울시 강남구 역삼동 1',
            userSelectedType: 'R',
            bname: '역삼동',
            buildingName: '',
            apartment: 'N',
            ...postcodeOverrides
          });
        }
      }
    };
  }, overrides);
}

async function selectCheckoutAddress(page: Page, expectedAddress = '서울시 강남구 테헤란로 1 (역삼동)', expectedZonecode = '06236') {
  await page.getByRole('button', { name: '주소 찾기' }).click();
  await expect(page.getByLabel('우편번호')).toHaveValue(expectedZonecode);
  await expect(page.locator('input[autocomplete="address-line1"]')).toHaveValue(expectedAddress);
}

async function mockEmptyPriceHistory(route: Parameters<Parameters<Page['route']>[1]>[0], partId: string) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      partId,
      partName: partId,
      currentPrice: 0,
      days: 3650,
      source: 'NAVER_SHOPPING_SEARCH',
      items: [],
      summary: {
        sampleCount: 0,
        currentPrice: 0,
        minPrice: 0,
        maxPrice: 0,
        firstPrice: 0,
        lastPrice: 0,
        changeAmount: 0,
        changeRatePercent: 0
      }
    })
  });
}

test.beforeEach(async ({ page }) => {
  // E2E는 실행 환경의 실제 API 인증 상태에 의존하지 않는다. AppHeader의 부수 인증 요청이
  // fixture 토큰을 401로 지워 견적·3D·체크아웃 테스트를 빈 상태로 만드는 연쇄 실패를 막는다.
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'user-test', email: 'user@example.com', name: 'Demo User', role: 'USER' })
    });
  });
  await page.route('**/api/technician/profile', async (route) => {
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'not applied' }) });
  });
  await page.route('**/api/support/chat-sessions/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ contact: null, messages: [] }) });
  });
  await page.route('**/api/build-graph-layouts/default', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ layoutKey: 'DEFAULT', source: 'TEST_DEFAULT', positions: {}, anchors: {} })
    });
  });
  await page.route('**/api/build-graphs/resolve', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildGraphResponse(body.focus?.mode ?? 'ISSUE_PATH'))
    });
  });
});


test('renders 8 empty slots on the slot board without the legacy list workspace', async ({ page }) => {
  await loginAsUser(page);

  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(emptyDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });
  await page.goto('/self-quote');

  await expect(page.getByRole('heading', { name: '셀프 견적 · 구성 관계도' })).toHaveCount(0);
  const board = page.getByTestId('slot-board');
  await expect(board).toBeVisible();
  // 슬롯 카드 8개는 실장도 보기에서 검증한다(기본 배치도는 배치판 아트 + 클릭 영역).
  await page.getByRole('button', { name: '실장도 보기' }).click();
  for (const category of ['CPU', 'MOTHERBOARD', 'RAM', 'GPU', 'STORAGE', 'PSU', 'CASE', 'COOLER']) {
    await expect(page.getByTestId(`slot-${category}`)).toBeVisible();
  }
  await expect(board.getByText('+ 부품 선택')).toHaveCount(8);
  await expect(page.getByTestId('slot-CPU').locator('img')).toHaveAttribute('src', '/slot-board/parts/cpu.svg');
  await expect(page.getByTestId('slot-STORAGE').locator('img')).toHaveAttribute('src', '/slot-board/parts/ssd.svg');

  const summaryBar = page.getByTestId('quote-summary-bar');
  await expect(summaryBar).toContainText('0 / 8');
  await expect(summaryBar).toContainText('부품 없음');
  await expect(page.getByTestId('slot-status-bar')).toHaveCount(0);
  await expect(page.getByTestId('quote-checkout-actions')).toHaveCount(0);

  // 구 목록/장바구니/노드 그래프 UI는 렌더링하지 않는다.
  await expect(page.getByRole('heading', { name: '견적 장바구니', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '견적 관계도' })).toHaveCount(0);
  await expect(page.getByPlaceholder('부품명, 제조사, 사양 검색')).toHaveCount(0);
  await expect(page.getByTestId('graph-flow-canvas')).toHaveCount(0);
});

test('opens draft history, compares with current draft, and restores only after confirmation', async ({ page }) => {
  await loginAsUser(page);
  const historyId = '11111111-1111-4111-8111-111111111111';
  let restoreRequested = false;
  let changeGroupHeader: string | null = null;
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(checkoutDraft) });
  });
  await page.route('**/api/quote-drafts/current/history', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        retentionDays: 30,
        maxItems: 20,
        maxProblemItems: 5,
        items: [{
          id: historyId,
          actionType: 'ITEM_REPLACE',
          actionLabel: 'GPU 교체 전',
          relatedCategories: ['GPU'],
          totalPrice: 1320000,
          itemCount: 2,
          evaluationStatus: 'VALID',
          score: 710,
          maxScore: 1000,
          issueCodes: [],
          evaluatedAt: '2026-07-21T01:00:01Z',
          createdAt: '2026-07-21T01:00:00Z',
          expiresAt: '2026-08-20T01:00:00Z'
        }]
      })
    });
  });
  await page.route(`**/api/quote-drafts/current/history/${historyId}/comparison**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        history: { id: historyId, actionType: 'ITEM_REPLACE', actionLabel: 'GPU 교체 전', relatedCategories: ['GPU'], totalPrice: 1320000, itemCount: 2, evaluationStatus: 'VALID', score: 710, maxScore: 1000, issueCodes: [], evaluatedAt: '2026-07-21T01:00:01Z', createdAt: '2026-07-21T01:00:00Z', expiresAt: '2026-08-20T01:00:00Z' },
        past: { items: [{ partId: 'old-gpu', category: 'GPU', name: 'RTX 5060', quantity: 1, unitPriceAtAdd: 900000, lineTotal: 900000 }], totalPrice: 1320000, itemCount: 2, compositeScore: { score: 710, maxScore: 1000 }, fps: { avgFps: 120 }, issues: [], evaluationAvailable: true },
        current: { items: [{ partId: 'part-checkout-gpu', category: 'GPU', name: 'RTX 5070 구매 테스트', quantity: 1, unitPriceAtAdd: 980000, lineTotal: 980000 }], totalPrice: 1400000, itemCount: 2, compositeScore: { score: 760, maxScore: 1000 }, fps: { avgFps: 140 }, issues: [], evaluationAvailable: true },
        differences: [{ category: 'GPU', categoryLabel: 'GPU', changeType: 'REPLACED', beforeItems: [{ partId: 'part-checkout-gpu', category: 'GPU', name: 'RTX 5070 구매 테스트', quantity: 1, unitPriceAtAdd: 980000, lineTotal: 980000 }], afterItems: [{ partId: 'old-gpu', category: 'GPU', name: 'RTX 5060', quantity: 1, unitPriceAtAdd: 900000, lineTotal: 900000 }] }],
        issueChanges: { added: [], resolved: [] },
        game: 'pubg', resolution: 'qhd', restorable: true, unavailableItems: [], requiresCompatibilityConfirmation: false,
        evaluationBasis: 'CURRENT_CATALOG_DATA', historicalPriceBasis: 'SNAPSHOT_UNIT_PRICE'
      })
    });
  });
  await page.route(`**/api/quote-drafts/current/history/${historyId}/restore`, async (route) => {
    restoreRequested = true;
    changeGroupHeader = route.request().headers()['x-quote-draft-change-group'] ?? null;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(checkoutDraft) });
  });

  await page.goto('/self-quote');
  await page.getByTestId('checklist-CPU').click();
  await expect(page.getByTestId('slot-candidate-panel')).toBeVisible();
  await page.getByTestId('quote-history-open').click({ force: true });
  await expect(page.getByTestId('slot-candidate-panel')).toHaveCount(0);
  const panel = page.getByTestId('quote-draft-history-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('GPU 교체 전');
  await panel.getByTestId('quote-history-entry').click();
  await expect(panel).toContainText('RTX 5060');
  await expect(panel).toContainText('RTX 5070 구매 테스트');
  await expect(panel).toContainText('710 / 1000');
  await expect(panel).toContainText('760 / 1000');
  const historyVisual = panel.getByTestId('quote-history-performance-comparison');
  await expect(historyVisual).toBeVisible();
  await expect(historyVisual).toContainText('현재 견적 → 복원 후');
  await expect(historyVisual.getByTestId('quote-history-score-ghost-gauge')).toBeVisible();
  await expect(historyVisual.getByTestId('quote-history-score-ghost-base')).toHaveText('760');
  await expect(historyVisual.getByTestId('quote-history-score-compare-score')).toHaveText('710');
  await expect(historyVisual.getByTestId('quote-history-score-compare-delta')).toHaveText('-50점');
  await expect(historyVisual.getByTestId('quote-history-price-comparison')).toContainText('1,320,000원');
  await expect(historyVisual.getByTestId('quote-history-price-comparison')).toContainText('1,400,000원');
  await expect(historyVisual.getByTestId('quote-history-fps-comparison')).toContainText('120FPS');
  await expect(historyVisual.getByTestId('quote-history-fps-comparison')).toContainText('140FPS');
  await expect(panel).toContainText('현재 RTX 5070 구매 테스트');
  await expect(panel).toContainText('복원 후 RTX 5060');
  await expect(panel).toContainText('가격은 기록 당시 단가');

  page.once('dialog', (dialog) => dialog.accept());
  await panel.getByTestId('quote-history-restore').click();
  await expect.poll(() => restoreRequested).toBe(true);
  expect(changeGroupHeader).toMatch(/^[0-9a-f-]{36}$/);
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-view', 'LIST');
  await expect(panel.getByTestId('quote-history-restore-success')).toContainText('견적을 복원했습니다');
  await expect(panel.getByTestId('quote-history-restore')).toHaveCount(0);
  await page.getByTestId('quote-draft-history-panel-backdrop').dispatchEvent('click');
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: '변경 기록 닫기' }).click();
  await expect(panel).toHaveCount(0);
});

test('keeps valid draft history visible while collapsing zero-score and pending records', async ({ page }) => {
  await loginAsUser(page);
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(checkoutDraft) });
  });
  await page.route('**/api/quote-drafts/current/history', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        retentionDays: 30,
        maxItems: 20,
        maxProblemItems: 5,
        items: [
          {
            id: '11111111-1111-4111-8111-111111111111', actionType: 'ITEM_REPLACE', actionLabel: '정상 GPU 교체 전', relatedCategories: ['GPU'],
            totalPrice: 1320000, itemCount: 8, evaluationStatus: 'VALID', score: 710, maxScore: 1000, issueCodes: [],
            evaluatedAt: '2026-07-21T01:00:01Z', createdAt: '2026-07-21T01:00:00Z', expiresAt: '2026-08-20T01:00:00Z'
          },
          {
            id: '22222222-2222-4222-8222-222222222222', actionType: 'ITEM_REPLACE', actionLabel: '호환 불가 케이스 교체 전', relatedCategories: ['CASE'],
            totalPrice: 1290000, itemCount: 8, evaluationStatus: 'INVALID', score: 0, maxScore: 1000, issueCodes: ['CASE_GPU_CLEARANCE_FAIL'],
            evaluatedAt: '2026-07-21T01:01:01Z', createdAt: '2026-07-21T01:01:00Z', expiresAt: '2026-08-20T01:01:00Z'
          },
          {
            id: '33333333-3333-4333-8333-333333333333', actionType: 'ITEM_REPLACE', actionLabel: '평가 대기 메인보드 교체 전', relatedCategories: ['MOTHERBOARD'],
            totalPrice: 1350000, itemCount: 8, evaluationStatus: 'PENDING', score: null, maxScore: null, issueCodes: [],
            evaluatedAt: null, createdAt: '2026-07-21T01:02:00Z', expiresAt: '2026-08-20T01:02:00Z'
          }
        ]
      })
    });
  });

  await page.goto('/self-quote');
  await page.getByTestId('quote-history-open').click();
  const panel = page.getByTestId('quote-draft-history-panel');
  await expect(panel.getByTestId('quote-history-valid-group')).toContainText('정상 견적 기록 1건');
  await expect(panel.getByTestId('quote-history-valid-group')).toContainText('710점');
  await expect(panel.getByTestId('quote-history-pending-group')).toContainText('평가 중인 기록 1건');
  const problemGroup = panel.getByTestId('quote-history-problem-group');
  await expect(problemGroup).toContainText('호환 문제 기록 1건');
  await expect(problemGroup.getByText('호환 불가 케이스 교체 전')).toBeHidden();
  await problemGroup.getByText('호환 문제 기록 1건').click();
  await expect(problemGroup.getByText('호환 불가 케이스 교체 전')).toBeVisible();
  await expect(problemGroup).toContainText('0점 · 호환 문제');
});

test('keeps self quote and the primary navigation inside a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsUser(page);
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(emptyDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });
  await page.goto('/self-quote');

  await expect(page.getByTestId('quote-checklist')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

// AI가 상품을 하나로 특정하지 못하면 "'9800X3D'... CPU 후보 목록에서 확인해 주세요"라며
// /self-quote?category=CPU&q=9800X3D 로 보낸다. 그 q를 후보 패널이 받지 않으면
// 안내와 달리 걸러지지 않은 전체 목록에 떨어져 사용자는 다시 "아무 일도 안 일어났다"고 느낀다.
test('AI가 넘긴 검색어를 달고 도착하면 후보 패널이 그 검색어로 열린다', async ({ page }) => {
  await loginAsUser(page);
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(emptyDraft) });
  });
  const partsQueries: string[] = [];
  await page.route('**/api/parts**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/api/parts')) {
      partsQueries.push(url.searchParams.get('q') ?? '');
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 })
    });
  });

  await page.goto('/self-quote?category=CPU&q=9800X3D');

  const searchBox = page.getByRole('textbox', { name: 'CPU 부품 검색' });
  await expect(searchBox).toHaveValue('9800X3D');
  await expect.poll(() => partsQueries.includes('9800X3D')).toBe(true);
  // 취급하지 않는 모델이면 '결과 없음'이 사실을 그대로 말해 준다.
  await expect(page.getByText("'9800X3D' 검색 결과가 없습니다.")).toBeVisible();

  // 패널을 닫으면 검색어도 주소에서 함께 사라진다 — 다음에 여는 슬롯까지 따라가지 않게.
  await page.getByRole('button', { name: '후보 패널 닫기' }).click();
  await expect(page).toHaveURL('/self-quote');
});

test('AI part location focus spotlights all 8 categories across fused, motherboard, and 3D views', async ({ page }) => {
  await loginAsUser(page);
  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.authUser', JSON.stringify({
      id: 'user-board-focus',
      email: 'user@example.com',
      name: 'Board Focus User',
      role: 'USER'
    }));
  });
  const draftMutationMethods: string[] = [];
  const buildChatBodies: Array<Record<string, unknown>> = [];
  const focusCases = [
    { category: 'CPU', prompt: 'CPU 위치가 어디 있어?' },
    { category: 'MOTHERBOARD', prompt: '메인보드 위치 표시해줘' },
    { category: 'RAM', prompt: '램 위치가 어디 있어?' },
    { category: 'GPU', prompt: '그래픽카드가 어디 달려 있어?' },
    { category: 'STORAGE', prompt: 'M.2 슬롯 어디야?' },
    { category: 'PSU', prompt: '파워 장착 위치 보여줘' },
    { category: 'CASE', prompt: '케이스 위치 강조해줘' },
    { category: 'COOLER', prompt: '쿨러 자리가 어디야?' }
  ] as const;
  const promptCategories = new Map<string, string[]>(
    focusCases.map((item) => [item.prompt, [item.category]])
  );
  promptCategories.set('CPU랑 RAM 위치 보여줘', ['CPU', 'RAM']);

  await page.route('**/api/quote-drafts/current**', async (route) => {
    if (route.request().method() !== 'GET') draftMutationMethods.push(route.request().method());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fullDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/price-history')) {
      await mockEmptyPriceHistory(route, 'board-focus-part');
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });
  await page.route('**/api/ai/build-chat', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
    buildChatBodies.push(body);
    const message = String(body.message ?? '');
    const categories = promptCategories.get(message) ?? [];
    const label = `${categories.join(' · ')} 위치`;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        answerType: 'GENERAL',
        message: `${label}를 현재 구성도에서 강조했습니다.`,
        builds: [],
        warnings: [],
        boardFocus: { type: 'PART_LOCATION', categories, label }
      })
    });
  });

  await page.goto('/self-quote');
  const input = page.getByRole('textbox', { name: 'AI 챗봇에게 PC 사양 질문' });
  const send = page.getByRole('button', { name: '질문 보내기' });

  for (const item of focusCases) {
    await page.getByRole('radio', { name: '배치도' }).click();
    await input.fill(item.prompt);
    await send.click();
    await expect(page.getByTestId('slot-board-ai-focus-status')).toContainText('위치 강조 중');

    const otherCategory = item.category === 'GPU' ? 'CPU' : 'GPU';
    const fusedArea = page.getByTestId(`slot-fused-area-wrap-${item.category}`);
    const fusedLayer = page.getByTestId(
      item.category === 'RAM' ? 'slot-fused-layer-RAM-1' : `slot-fused-layer-${item.category}`
    );
    await expect(fusedArea).toHaveAttribute('data-ai-spotlight', 'true');
    await expect(fusedArea).toHaveCSS('outline-style', 'none');
    await expect(fusedLayer).toHaveCSS('outline-style', 'none');
    await expect(page.getByTestId(`slot-fused-area-wrap-${otherCategory}`)).toHaveAttribute('data-ai-dimmed', 'true');

    await page.getByRole('button', { name: '실장도 보기' }).click();
    await expect(page.getByTestId(`slot-${item.category}`)).toHaveAttribute('data-ai-spotlight', 'true');
    await expect(page.getByTestId(`slot-${otherCategory}`)).toHaveAttribute('data-ai-dimmed', 'true');

    await page.getByRole('radio', { name: '3D' }).click();
    await expect(page.getByTestId(`slot-${item.category}`)).toHaveAttribute('data-ai-spotlight', 'true');
    await expect(page.getByTestId(`slot-${item.category}`)).toHaveCSS('outline-style', 'solid');
    await expect(page.getByTestId(`slot-${otherCategory}`)).toHaveAttribute('data-ai-dimmed', 'true');
  }

  await input.fill('CPU랑 RAM 위치 보여줘');
  await send.click();
  await expect(page.getByTestId('slot-CPU')).toHaveAttribute('data-ai-spotlight', 'true');
  await expect(page.getByTestId('slot-RAM')).toHaveAttribute('data-ai-spotlight', 'true');
  await expect(page.getByTestId('slot-GPU')).toHaveAttribute('data-ai-dimmed', 'true');
  await expect(page).toHaveURL('/self-quote');
  expect(draftMutationMethods).toHaveLength(0);
  expect(buildChatBodies).toHaveLength(focusCases.length + 1);
  for (const body of buildChatBodies) {
    // 성능 문맥(게임·해상도)은 "더 부드럽게"처럼 목표 수치 없는 요청을 해석하는 기준이라 함께 실린다.
    expect(body.uiContext).toEqual({
      surface: 'SELF_QUOTE',
      capabilities: ['BOARD_PART_FOCUS', 'PART_CANDIDATE_PANEL', 'GAME_PERFORMANCE_COMPARE', 'QUOTE_DRAFT_HISTORY'],
      performance: { gameQuery: 'pubg', resolution: '4K' }
    });
  }

  await page.getByTestId('slot-board-ai-focus-clear').click();
  await expect(page.getByTestId('slot-board-ai-focus-status')).toHaveCount(0);

  await input.fill('램 위치가 어디 있어?');
  await send.click();
  await expect(page.getByTestId('slot-board-ai-focus-status')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('slot-board-ai-focus-status')).toHaveCount(0);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await input.fill('램 위치가 어디 있어?');
  await send.click();
  await expect(page.getByTestId('slot-RAM')).toHaveCSS('animation-name', 'none');
  await expect(page.getByTestId('slot-RAM')).toHaveCSS('outline-style', 'solid');
  await page.getByTestId('slot-board').click({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId('slot-board-ai-focus-status')).toHaveCount(0);
});

// AI 답변의 중요 문구(부품명·가격·FPS·해상도·게임명)는 <strong>으로 강조하되,
// 서버 message 원문은 한 글자도 더하거나 빼지 않는다(E2E 오라클·캐시 계약과 같은 전제).
test('AI chat bolds key facts without altering the raw message text', async ({ page }) => {
  await loginAsUser(page);
  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.authUser', JSON.stringify({
      id: 'user-test', email: 'user@example.com', name: 'Chat Emphasis User', role: 'USER'
    }));
  });
  const chatMessage = '요청하신 예산에 맞춰 그래픽카드 추천 TOP2를 정리했습니다. '
    + '1) RTX 5070 벤투스 2X — 1,234,000원 2) RTX 5060 Ti 8GB — 850,000원 '
    + '발로란트 QHD 기준 약 240FPS로 확인됩니다. 교체: 기존 GPU → RTX 5070 벤투스 2X. '
    + '총액은 1,900,000원 → 2,284,000원 (+384,000원)입니다.\n'
    // 견적 반영 피드백 문구(AiDraftApplicationFeedbackCoordinator 표기) — 점수·해상도별 성능·판정 어휘 강조 검증용
    + '완성 견적이 담겼습니다. 현재 종합 점수는 806점입니다. '
    + '배그 예상 성능은 FHD 209 · QHD 140 · 4K 80FPS입니다. '
    + 'FHD·QHD는 120Hz 이상으로 쾌적하고, 4K는 120Hz에 못 미치니 참고하세요.';
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(emptyDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });
  await page.route('**/api/ai/build-chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ answerType: 'GENERAL', message: chatMessage, builds: [], warnings: [] })
    });
  });

  await page.goto('/self-quote');
  await page.getByRole('textbox', { name: 'AI 챗봇에게 PC 사양 질문' }).fill('예산 250만원으로 그래픽카드 추천해줘');
  await page.getByRole('button', { name: '질문 보내기' }).click();

  const assertEmphasis = async (expectedSentenceSpans: number) => {
    const text = page.getByTestId('ai-chat-message-assistant').last().getByTestId('ai-message-text');
    // 원문 보존: 문장 리빌이 끝난 뒤 서버 문구가 그대로 렌더됐는지 문장별로 확인한다.
    await expect(text).toContainText('1) RTX 5070 벤투스 2X — 1,234,000원', { timeout: 10000 });
    await expect(text).toContainText('총액은 1,900,000원 → 2,284,000원 (+384,000원)입니다.');
    // 렌더 경로 고정: 리빌 경로는 문장 span, 세션 복원 경로는 Fragment(스팬 0개)로 그린다.
    await expect(text.getByTestId('ai-message-sentence')).toHaveCount(expectedSentenceSpans);
    // 정규화 없는 raw 비교 — 구조·토큰 규칙이 공백 하나도 더하거나 빼지 않는다.
    expect(await text.getByTestId('ai-message-paragraph').nth(1).textContent()).toBe('1) RTX 5070 벤투스 2X — 1,234,000원');
    expect(await text.textContent()).toContain('교체: 기존 GPU → RTX 5070 벤투스 2X. 총액은');
    expect(await text.textContent()).toContain('FHD·QHD는 120Hz 이상으로 쾌적하고, 4K는 120Hz에 못 미치니 참고하세요.');
    // 강조: 번호 목록·교체 요약의 부품명, 가격, FPS, 해상도, 게임명이 <strong>으로 감싸진다.
    const strongs = text.locator('strong');
    await expect(strongs.filter({ hasText: 'RTX 5070 벤투스 2X' }).first()).toBeVisible();
    await expect(strongs.filter({ hasText: '기존 GPU → RTX 5070 벤투스 2X' })).toHaveCount(1);
    await expect(strongs.filter({ hasText: '1,234,000원' })).toHaveCount(1);
    await expect(strongs.filter({ hasText: '240FPS' })).toHaveCount(1);
    // 'QHD' 부분일치 3곳: '발로란트 QHD' 문장의 단독 토큰, 'QHD 140' 성능 쌍, 'FHD·QHD는'의 단독 토큰
    await expect(strongs.filter({ hasText: 'QHD' })).toHaveCount(3);
    await expect(strongs.filter({ hasText: '발로란트' })).toHaveCount(1);
    await expect(strongs.filter({ hasText: 'TOP2' })).toHaveCount(1);
    // 견적 반영 피드백: 점수·해상도별 성능·주사율·판정 어휘(쾌적/못 미치니)·게임명이 굵어진다.
    await expect(strongs.filter({ hasText: '806점' })).toHaveCount(1);
    await expect(strongs.filter({ hasText: '배그' })).toHaveCount(1);
    await expect(strongs.filter({ hasText: 'FHD 209' })).toHaveCount(1);
    await expect(strongs.filter({ hasText: 'QHD 140' })).toHaveCount(1);
    await expect(strongs.filter({ hasText: '4K 80FPS' })).toHaveCount(1);
    await expect(strongs.filter({ hasText: '120Hz' })).toHaveCount(2);
    await expect(strongs.filter({ hasText: '쾌적하고' })).toHaveCount(1);
    await expect(strongs.filter({ hasText: '못 미치니' })).toHaveCount(1);
  };
  await assertEmphasis(9);
  // 사용자 말풍선은 강조 대상이 아니다.
  await expect(page.getByTestId('ai-chat-message-user').last().locator('strong')).toHaveCount(0);

  // 새로고침 → 세션 복원 경로(리빌 없이 한 번에 렌더)에서도 동일하게 강조된다.
  await page.reload();
  await assertEmphasis(0);
});


test('AI location focus marks an empty mounting position and clears on a board part click', async ({ page }) => {
  await loginAsUser(page);
  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.authUser', JSON.stringify({
      id: 'user-empty-board-focus', email: 'user@example.com', name: 'Empty Focus User', role: 'USER'
    }));
  });
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(emptyDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });
  await page.route('**/api/ai/build-chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        answerType: 'GENERAL',
        message: '파워 위치를 현재 구성도에서 강조했습니다.',
        builds: [],
        warnings: [],
        boardFocus: { type: 'PART_LOCATION', categories: ['PSU'], label: '파워 위치' }
      })
    });
  });

  await page.goto('/self-quote?category=CPU');
  await page.getByRole('textbox', { name: 'AI 챗봇에게 PC 사양 질문' }).fill('파워 장착 위치 보여줘');
  await page.getByRole('button', { name: '질문 보내기' }).click();

  await page.getByRole('button', { name: '실장도 보기' }).click();
  await expect(page.getByTestId('slot-PSU')).toHaveAttribute('data-mounted', 'false');
  await expect(page.getByTestId('slot-PSU')).toHaveAttribute('data-ai-spotlight', 'true');
  await expect(page.getByTestId('slot-ai-unmounted-PSU')).toContainText('미장착');
  await expect(page.getByTestId('slot-CPU')).toHaveAttribute('data-selected', 'false');
  await expect(page.getByTestId('slot-CPU')).toHaveAttribute('data-next', 'false');
  await expect(page).toHaveURL('/self-quote?category=CPU');

  await page.getByTestId('slot-board-ai-focus-clear').click();
  await expect(page.getByTestId('slot-CPU')).toHaveAttribute('data-selected', 'true');
  await expect(page.getByTestId('slot-CPU')).toHaveAttribute('data-next', 'true');

  await page.getByRole('textbox', { name: 'AI 챗봇에게 PC 사양 질문' }).fill('파워 장착 위치 보여줘');
  await page.getByRole('button', { name: '질문 보내기' }).click();
  await expect(page.getByTestId('slot-CPU')).toHaveAttribute('data-selected', 'false');

  await page.getByTestId('slot-candidate-panel').getByRole('button', { name: '후보 패널 닫기' }).click();
  await page.getByTestId('slot-GPU').getByRole('button', { name: 'GPU 슬롯 열기' }).click();
  await expect(page.getByTestId('slot-board-ai-focus-status')).toHaveCount(0);
  await expect(page).toHaveURL('/self-quote?category=GPU');
});

test('fills all 8 slots from the current quote draft and shows mini slot overflow', async ({ page }) => {
  await loginAsUser(page);

  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fullDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });

  await page.goto('/self-quote');
  // 장착 카드·미니 슬롯 표기는 실장도 보기에서 검증한다.
  await page.getByRole('button', { name: '실장도 보기' }).click();

  // 상품명·가격 전문은 체크리스트(품목 지도)가 담당하고, 보드 카드는 이미지+카테고리 요약 카드다.
  await expect(page.getByTestId('checklist-CPU')).toContainText('풀보드 CPU');
  await expect(page.getByTestId('checklist-MOTHERBOARD')).toContainText('풀보드 메인보드');
  await expect(page.getByTestId('checklist-GPU')).toContainText('풀보드 RTX GPU');
  await expect(page.getByTestId('checklist-PSU')).toContainText('풀보드 850W 파워');
  await expect(page.getByTestId('checklist-CASE')).toContainText('풀보드 케이스');
  await expect(page.getByTestId('checklist-COOLER')).toContainText('풀보드 쿨러');
  await expect(page.getByTestId('checklist-GPU')).toContainText('980,000원');
  await expect(page.getByTestId('slot-GPU')).not.toContainText('풀보드 RTX GPU');
  await expect(page.getByTestId('slot-GPU')).toHaveAttribute('title', '풀보드 RTX GPU');
  await expect(page.getByTestId('slot-GPU').getByTestId('slot-part-image')).toBeVisible();

  // RAM mini slot 4칸: quantity 합산(5) 기준 4칸 + 초과 +1
  const ramSlot = page.getByTestId('slot-RAM');
  await expect(ramSlot.locator('[data-mini-slot-filled="true"]')).toHaveCount(4);
  await expect(ramSlot.getByText('+1')).toBeVisible();

  // SSD mini slot 2칸: item 개수(3) 기준 2칸 + 초과 +1. 복수 장착은 hover 툴팁에 '외 N개'로 요약.
  const ssdSlot = page.getByTestId('slot-STORAGE');
  await expect(ssdSlot.locator('[data-mini-slot-filled="true"]')).toHaveCount(2);
  await expect(ssdSlot.getByText('+1')).toBeVisible();
  await expect(ssdSlot).toHaveAttribute('title', '풀보드 NVMe SSD 1 외 2개');

  const summaryBar = page.getByTestId('quote-summary-bar');
  await expect(summaryBar).toContainText('8 / 8');
  await expect(summaryBar).toContainText(`${fullDraft.totalPrice.toLocaleString()}원`);
  await expect(page.getByTestId('slot-status-bar')).toHaveCount(0);
});

test('renders the slot board as an information-first compatibility diagram with mounted part media', async ({ page }) => {
  await loginAsUser(page);
  const visualDraftItems = [
    {
      ...draftItem('part-visual-cpu', 'CPU', 'AMD Ryzen 7 7800X3D', 420000),
      attributes: { shortSpec: 'AM5 / 8코어' }
    },
    {
      ...draftItem('part-visual-board', 'MOTHERBOARD', 'B650 메인보드', 250000),
      attributes: { shortSpec: 'AM5 / DDR5 / PCIe 4.0' }
    },
    {
      ...draftItem('part-visual-gpu', 'GPU', 'NVIDIA GeForce RTX 4070 Ti SUPER', 1229000),
      attributes: { shortSpec: 'PCIe x16 4.0 / 16GB', interface: 'PCIe x16 4.0' },
      externalOffer: {
        imageUrl: 'https://example.test/visual-gpu.png',
        supplierName: '그래픽테스트몰',
        offerUrl: 'https://example.test/visual-gpu',
        lowPrice: 1229000,
        source: 'NAVER_SHOPPING_SEARCH'
      }
    },
    {
      ...draftItem('part-visual-psu', 'PSU', 'Classic II 750W', 120000),
      attributes: { shortSpec: '750W / ATX 3.1' }
    }
  ];

  await page.route('**/api/build-graphs/resolve', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...buildGraphResponse(),
        edges: [
          {
            id: 'edge-gpu-board-pcie',
            source: 'part-GPU',
            target: 'part-MOTHERBOARD',
            type: 'REQUIRES',
            status: 'PASS',
            label: 'PCIe x16 4.0',
            summary: '그래픽카드를 PCIe x16 슬롯에 장착할 수 있습니다.'
          },
          {
            id: 'edge-psu-board-power',
            source: 'part-PSU',
            target: 'part-MOTHERBOARD',
            type: 'REQUIRES',
            status: 'PASS',
            label: '24핀 전원',
            summary: '메인보드 주 전원 연결입니다.'
          }
        ]
      })
    });
  });
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...emptyDraft,
        items: visualDraftItems,
        totalPrice: visualDraftItems.reduce((sum, item) => sum + item.lineTotal, 0),
        itemCount: visualDraftItems.reduce((sum, item) => sum + item.quantity, 0)
      })
    });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });

  await page.goto('/self-quote');

  const board = page.getByTestId('slot-board');
  // 헤더 제거 리디자인: 제목 텍스트 대신 판 위 플로팅 보기 전환이 보드 존재를 보증한다.
  await expect(page.getByRole('radiogroup', { name: '보드 보기 방식' })).toBeVisible();
  // 기본 보기는 배치도(fused) — 실장도 카드/관계선 검증을 위해 3단 토글에서 실장도로 전환한다.
  await expect(board).toHaveAttribute('data-visual-mode', 'fused');
  const modeGroup = page.getByRole('radiogroup', { name: '보드 보기 방식' });
  await expect(modeGroup.getByRole('radio', { name: '배치도' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: '실장도 보기' }).click();
  await expect(board).toHaveAttribute('data-visual-mode', 'motherboard');
  await expect(page.getByRole('switch', { name: '보드 정보 표시' })).toHaveCount(0);
  // 장식용 배경 평면도는 리디자인에서 제거됨 — 범례가 색 체계를 설명한다.
  await expect(page.getByTestId('slot-board-motherboard-art')).toHaveCount(0);
  await expect(page.getByTestId('iso-part-GPU')).toHaveCount(0);
  // 한 화면 높이를 확보하기 위해 중복 호환 범례는 보드 헤더에서 노출하지 않는다.
  await expect(page.getByTestId('slot-board-legend')).toHaveCount(0);

  // 카드는 카테고리 통일 에셋+짧은 요약(사양) 중심 — 상품명 전문은 hover 툴팁과 체크리스트가 담당한다.
  const gpuSlot = page.getByTestId('slot-GPU');
  await expect(gpuSlot.getByTestId('slot-part-image')).toHaveAttribute('src', '/slot-board/parts/gpu.svg');
  await expect(gpuSlot).toHaveAttribute('title', 'NVIDIA GeForce RTX 4070 Ti SUPER');
  await expect(gpuSlot).toContainText('PCIe x16 4.0');
  await expect(gpuSlot).not.toContainText('호환 가능');

  // 정상 관계선은 상태 점만 — 상세 문장은 title 툴팁으로 확인한다.
  const gpuEdge = page.getByTestId('slot-edge-GPU-MOTHERBOARD');
  await expect(gpuEdge).toHaveAttribute('data-status', 'PASS');
  await expect(gpuEdge).toHaveAttribute('title', '그래픽카드를 PCIe x16 슬롯에 장착할 수 있습니다.');
  const psuEdge = page.getByTestId('slot-edge-PSU-MOTHERBOARD');
  await expect(psuEdge).toHaveAttribute('data-status', 'PASS');
  await expect(psuEdge).toHaveText('');
});

test('toggles the slot board across 배치도/실장도/3D views and persists the selected mode', async ({ page }) => {
  await loginAsUser(page);
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fullDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });

  await page.goto('/self-quote');

  const board = page.getByTestId('slot-board');
  const modeGroup = page.getByRole('radiogroup', { name: '보드 보기 방식' });
  const fusedRadio = modeGroup.getByRole('radio', { name: '배치도' });
  const isometricRadio = modeGroup.getByRole('radio', { name: '3D' });

  // 기본값은 배치도(fused): 배치판 아트가 보이고, 실장도 평면도/3D 부품은 없다.
  await expect(board).toHaveAttribute('data-visual-mode', 'fused');
  await expect(fusedRadio).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('slot-board-fused-plate')).toBeVisible();
  await expect(page.getByTestId('slot-board-edges')).toHaveCount(0);
  await expect(page.getByTestId('iso-part-GPU')).toHaveCount(0);

  // 실장도: 복원된 평면도 관계선이 보이고 배치판은 사라진다.
  await page.getByRole('button', { name: '실장도 보기' }).click();
  await expect(page.getByRole('button', { name: '실장도 접기' })).toBeVisible();
  await expect(board).toHaveAttribute('data-visual-mode', 'motherboard');
  await expect(page.getByTestId('slot-board-fused-plate')).toHaveCount(0);
  await expect(page.getByTestId('slot-board-edges')).toBeVisible();
  await expect(page.getByTestId('slot-GPU')).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('buildgraph.selfQuote.slotBoardVisualMode'))).toBe('motherboard');

  // 3D: 등각 씬과 부품 글리프가 보이고, 보드 정보 표시 스위치가 나타난다.
  await isometricRadio.click();
  await expect(isometricRadio).toHaveAttribute('aria-checked', 'true');
  await expect(board).toHaveAttribute('data-visual-mode', 'isometric');
  await expect(page.getByTestId('slot-board-motherboard-art')).toBeVisible();
  await expect(page.getByRole('switch', { name: '보드 정보 표시' })).toBeVisible();
  await expect(page.getByTestId('iso-part-CPU')).toBeVisible();
  await expect(page.getByTestId('iso-part-MOTHERBOARD')).toBeVisible();
  await expect(page.getByTestId('iso-part-GPU')).toBeVisible();
  await expect(page.getByTestId('iso-part-PSU')).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('buildgraph.selfQuote.slotBoardVisualMode'))).toBe('isometric');

  // 새로고침 후에도 3D 선택이 유지된다.
  await page.reload();
  await expect(page.getByTestId('slot-board')).toHaveAttribute('data-visual-mode', 'isometric');
  await expect(page.getByRole('radio', { name: '3D' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('iso-part-GPU')).toBeVisible();

  // 배치도로 복귀 + 저장 확인, 새로고침 후에도 배치도가 유지된다.
  await page.getByRole('radio', { name: '배치도' }).click();
  await expect(page.getByTestId('slot-board')).toHaveAttribute('data-visual-mode', 'fused');
  await expect(page.getByTestId('slot-board-fused-plate')).toBeVisible();
  await expect(page.getByTestId('slot-board-motherboard-art')).toHaveCount(0);
  await expect(page.getByTestId('iso-part-GPU')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('buildgraph.selfQuote.slotBoardVisualMode'))).toBe('fused');

  await page.reload();
  await expect(page.getByTestId('slot-board')).toHaveAttribute('data-visual-mode', 'fused');
  await expect(page.getByRole('radio', { name: '배치도' })).toHaveAttribute('aria-checked', 'true');
});

test('keeps the 선택됨 badge exclusive to the 영향 지도 view', async ({ page }) => {
  await loginAsUser(page);
  await page.route('**/api/build-graphs/resolve', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildGraphResponse()) });
  });
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fullDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });

  await page.goto('/self-quote');

  const board = page.getByTestId('slot-board');
  const boardBadges = board.getByText('선택됨');

  // 배치도(기본): 체크리스트로 부품을 선택해도 보드에는 선택됨 배지가 뜨지 않는다.
  await page.getByTestId('checklist-CPU').click();
  await expect(board).toHaveAttribute('data-visual-mode', 'fused');
  await expect(board.getByTestId('slot-fused-area-wrap-CPU')).toHaveAttribute('data-selected', 'true');
  await expect(boardBadges).toHaveCount(0);

  // 실장도: 선택 상태(?category=)는 유지되지만 배지는 없다.
  await page.getByRole('button', { name: '실장도 보기' }).click();
  await expect(board).toHaveAttribute('data-visual-mode', 'motherboard');
  await expect(boardBadges).toHaveCount(0);

  // 3D: 마찬가지로 배지 없음.
  await page.getByRole('radio', { name: '3D' }).click();
  await expect(board).toHaveAttribute('data-visual-mode', 'isometric');
  await expect(boardBadges).toHaveCount(0);

  // 영향 지도: 선택된 노드에만 선택됨 배지가 보인다.
  // 후보 패널이 영향 지도 버튼을 가리므로 선택을 토글로 해제해 패널을 닫은 뒤 지도를 열고 다시 선택한다.
  await page.getByRole('radio', { name: '배치도' }).click();
  await page.getByTestId('checklist-CPU').click();
  await expect(page.getByTestId('slot-candidate-panel')).toHaveCount(0);
  await page.getByTestId('relation-map-open').click();
  await expect(board).toHaveAttribute('data-visual-mode', 'relation-map');
  await expect(boardBadges).toHaveCount(0);
  await page.getByTestId('checklist-CPU').click();
  await expect(page.getByTestId('relation-map-node-CPU').getByText('선택됨')).toBeVisible();
  await expect(boardBadges).toHaveCount(1);
});

test('aligns 3D slot cards into two equal rows', async ({ page }) => {
  await loginAsUser(page);
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fullDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });

  await page.goto('/self-quote');
  await page.getByRole('radio', { name: '3D' }).click();

  const readCardBox = async (category: string) => {
    const box = await page.getByTestId(`slot-${category}`).boundingBox();
    if (!box) {
      throw new Error(`${category} 3D 카드 위치를 확인할 수 없습니다.`);
    }
    return box;
  };
  const topCategories = ['CPU', 'COOLER', 'RAM', 'STORAGE'];
  const bottomCategories = ['CASE', 'GPU', 'MOTHERBOARD', 'PSU'];
  const topBoxes = await Promise.all(topCategories.map(readCardBox));
  const bottomBoxes = await Promise.all(bottomCategories.map(readCardBox));

  for (const row of [topBoxes, bottomBoxes]) {
    const [first, ...rest] = row;
    for (const box of rest) {
      expect(Math.abs(box.y - first.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.width - first.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.height - first.height)).toBeLessThanOrEqual(1);
    }
  }

  for (let index = 0; index < topBoxes.length; index += 1) {
    expect(Math.abs(topBoxes[index].x - bottomBoxes[index].x)).toBeLessThanOrEqual(1);
  }
});

test('spotlights only the focused 3D part from slot card hover without dimming the rest', async ({ page }) => {
  await loginAsUser(page);
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fullDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });

  await page.goto('/self-quote');
  await page.getByRole('radio', { name: '3D' }).click();

  const gpuSlot = page.getByTestId('slot-GPU');
  const gpuIso = page.getByTestId('iso-part-GPU');
  const psuIso = page.getByTestId('iso-part-PSU');
  const ramIso = page.getByTestId('iso-part-RAM');
  await expect(gpuIso).toHaveAttribute('data-hovered', 'false');
  await expect(ramIso).toHaveAttribute('data-dimmed', 'false');

  await gpuSlot.hover();
  await expect(gpuSlot).toHaveAttribute('data-hovered', 'true');
  await expect(gpuIso).toHaveAttribute('data-hovered', 'true');
  await expect(gpuIso).toHaveAttribute('data-spotlight', 'true');
  await expect(psuIso).toHaveAttribute('data-spotlight', 'false');
  await expect(ramIso).toHaveAttribute('data-spotlight', 'false');
  await expect(ramIso).toHaveAttribute('data-dimmed', 'false');
  await expect(psuIso).toHaveAttribute('data-dimmed', 'false');

  // 3D 씬 밖 중립 지점(플로팅 보기 전환)으로 커서를 옮겨 hover 상태를 초기화한다.
  await page.getByRole('radiogroup', { name: '보드 보기 방식' }).hover();
  await expect(gpuIso).toHaveAttribute('data-hovered', 'false');
  await expect(ramIso).toHaveAttribute('data-dimmed', 'false');
});

// 이 테스트는 tool 필드가 없는 구 계약 인사이트의 회귀 앵커도 겸한다 — 같은 부품쌍의 엣지 수치문과
// 인사이트 문구가 "둘 다" 표기되는 기존 동작을 유지해야 한다(신규 계약의 중복 억제는 insight.tool이
// 있을 때만 발동, id 패턴 추측으로 오억제하지 않는다).
test('shows 3D problem markers, problem reasons, and overlay preference', async ({ page }) => {
  await loginAsUser(page);
  await page.route('**/api/build-graphs/resolve', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(problemGraphResponse()) });
  });
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fullDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });

  await page.goto('/self-quote');
  await page.getByRole('radio', { name: '3D' }).click();

  const gpuSlot = page.getByTestId('slot-GPU');
  await expect(gpuSlot).toHaveAttribute('data-status', 'FAIL');
  await expect(gpuSlot.getByText('장착 불가')).toBeVisible();
  await expect(page.getByTestId('iso-part-GPU')).toHaveAttribute('data-status', 'FAIL');
  await expect(page.getByTestId('iso-part-marker-GPU')).toBeVisible();
  // GPU-PSU 관계선/인사이트가 FAIL이면 양쪽 슬롯 모두 빨강으로 승격된다(체크리스트와 동일 규칙).
  await expect(page.getByTestId('iso-part-PSU')).toHaveAttribute('data-status', 'FAIL');
  await expect(page.getByTestId('iso-part-marker-PSU')).toBeVisible();

  await page.getByTestId('iso-part-marker-GPU').click();
  const popover = page.getByTestId('slot-problem-popover');
  await expect(popover).toBeVisible();
  await expect(popover).toContainText('장착 불가');
  await expect(popover).toContainText('GPU 권장 정격 파워보다 PSU 용량이 부족합니다.');
  await expect(popover).toContainText('GPU 교체 전에 850W 이상 파워를 먼저 검토하세요.');
  await expect(popover.getByTestId('slot-problem-ai-explain')).toBeVisible();

  await popover.getByRole('button', { name: '교체 후보 보기' }).click();
  await expect(page).toHaveURL('/self-quote?category=GPU');
  await expect(page.getByTestId('checklist-GPU')).toBeVisible();
  await expect(page.getByTestId('slot-candidate-panel')).toBeVisible();
  await expect(page.getByTestId('slot-candidate-panel').getByRole('heading', { name: 'GPU 부품 목록' })).toBeVisible();

  const overlayToggle = page.getByRole('switch', { name: '보드 정보 표시' });
  await expect(overlayToggle).toHaveAttribute('aria-checked', 'true');
  await overlayToggle.click();
  await expect(overlayToggle).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('slot-board-edges')).toHaveCount(0);
  await expect(page.getByTestId('slot-GPU')).not.toBeVisible();
  await expect(page.getByTestId('iso-part-GPU')).toBeVisible();
  await expect(page.getByTestId('iso-part-marker-GPU')).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('buildgraph.selfQuote.slotBoardOverlaysVisible'))).toBe('false');

  await page.reload();
  await expect(page.getByTestId('slot-board')).toHaveAttribute('data-visual-mode', 'isometric');
  await expect(page.getByRole('switch', { name: '보드 정보 표시' })).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('slot-GPU')).not.toBeVisible();
  await expect(page.getByTestId('iso-part-GPU')).toBeVisible();
});

// QA: 서버 constraint 노드는 category가 고정이라(예: constraint-compatibility=MOTHERBOARD) 쿨러
// 소켓/TDP 문제처럼 메인보드와 무관한 FAIL에서도 메인보드 슬롯에 사유 0개짜리 유령 '장착 불가'
// 팝오버를 만들 수 있었다 — PART 노드만 슬롯 문제로 승격해야 한다(뱃지와 동일 규칙).
test('does not raise a ghost problem popover from a CONSTRAINT node on the motherboard slot', async ({ page }) => {
  await loginAsUser(page);
  const base = buildGraphResponse();
  await page.route('**/api/build-graphs/resolve', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...base,
        nodes: [
          ...base.nodes.map((node) => ({ ...node, status: 'PASS' })),
          {
            id: 'constraint-compatibility',
            type: 'CONSTRAINT',
            category: 'MOTHERBOARD',
            label: '호환 제약',
            status: 'FAIL',
            detail: '호환 검증 제약'
          }
        ],
        edges: base.edges.map((edge) => ({ ...edge, status: 'PASS' })),
        insights: [],
        toolResults: []
      })
    });
  });
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fullDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });

  await page.goto('/self-quote');

  // 배치도에서 메인보드 클릭 → 문제 팝오버가 아니라 정상 관계 팝오버가 열린다(초록 뱃지와 모순 금지).
  await page.getByTestId('slot-fused-area-MOTHERBOARD').click();
  await expect(page.getByTestId('slot-relation-popover')).toBeVisible();
  await expect(page.getByTestId('slot-problem-popover')).toHaveCount(0);
  await expect(page.getByTestId('slot-relation-popover')).toContainText('호환 가능');
  await page.getByTestId('slot-relation-popover').getByRole('button', { name: '관계 상태 닫기' }).click();

  // 실장도 뱃지도 초록 유지 — 유령 FAIL 승격이 없어야 한다.
  await page.getByRole('button', { name: '실장도 보기' }).click();
  await expect(page.getByTestId('slot-MOTHERBOARD')).toHaveAttribute('data-status', 'PASS');
});

// QA B4(사용자 관찰 재현): 같은 tool 출처의 엣지 수치문("쿨러 높이 168mm/케이스 허용 165mm…")과
// 인사이트 일반문("케이스 장착 한계를 초과해…")이 한 팝오버/배너에 병기되지 않는다.
// 신규 계약(insight.tool)이 있을 때만 억제하며, 대응 엣지가 없는 다른 tool 인사이트는 그대로 남는다.
test('suppresses same-tool insight wording when an edge reason already covers the same fact', async ({ page }) => {
  await loginAsUser(page);
  const edgeSummary = '쿨러 높이 168mm / 케이스 허용 165mm입니다. 쿨러 높이가 케이스 허용 높이를 초과합니다.';
  const insightDescription = '케이스 장착 한계를 초과해 해당 조합은 장착할 수 없습니다.';
  const powerInsightDescription = '쿨러 전원 커넥터 구성을 확인해 주세요.';
  const base = buildGraphResponse();
  await page.route('**/api/build-graphs/resolve', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...base,
        nodes: base.nodes.map((node) => node.category === 'COOLER' || node.category === 'CASE'
          ? { ...node, status: 'FAIL' }
          : { ...node, status: 'PASS' }),
        edges: [
          {
            id: 'edge-cooler-case-height',
            source: 'part-COOLER',
            target: 'part-CASE',
            type: 'REQUIRES',
            status: 'FAIL',
            label: '높이 장착 불가',
            summary: edgeSummary
          }
        ],
        insights: [
          {
            id: 'insight-size-cooler-height',
            status: 'FAIL',
            title: '쿨러 장착 공간 부족',
            description: insightDescription,
            relatedNodeIds: ['part-COOLER', 'part-CASE'],
            tool: 'size'
          },
          {
            // 같은 부품에 걸렸지만 대응 엣지가 없는 다른 tool 인사이트 — 과억제되면 안 된다.
            id: 'insight-power-cooler',
            status: 'WARN',
            title: '전원 구성 확인',
            description: powerInsightDescription,
            relatedNodeIds: ['part-COOLER'],
            tool: 'power'
          }
        ],
        toolResults: []
      })
    });
  });
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fullDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });

  await page.goto('/self-quote');

  // 팝오버: 수치가 있는 엣지 사유만 남고, 같은 size tool의 인사이트 일반문은 중복 표기하지 않는다.
  await page.getByTestId('slot-fused-area-COOLER').click();
  const popover = page.getByTestId('slot-problem-popover');
  await expect(popover).toBeVisible();
  await expect(popover).toContainText('장착 불가');
  await expect(popover).toContainText(edgeSummary);
  await expect(popover).not.toContainText(insightDescription);
  await expect(popover).toContainText(powerInsightDescription);
  await popover.getByRole('button', { name: '문제 사유 닫기' }).click();
  await expect(popover).toHaveCount(0);

  // 큰 문제 배너는 FAIL만 집계하되, 상세 모달에는 함께 발생한 WARN 근거도 남는다.
  const banner = page.getByTestId('slot-board-problem-banner');
  await expect(banner).toContainText('호환 불가 건수가 1건 있습니다');
  await expect(banner).not.toContainText('주의 필요');
  await banner.click();
  const problemList = page.getByTestId('slot-board-problem-list');
  await expect(problemList).toContainText(edgeSummary);
  await expect(problemList).not.toContainText(insightDescription);
  await expect(problemList).toContainText(powerInsightDescription);
  await page.keyboard.press('Escape');

  // 배치 관계도의 축약 라벨은 문구 추측이 아니라 tool 식별로 분류된다 — 쿨러 높이 문제는
  // '길이 초과'가 아닌 '높이 초과'로 표기된다.
  await page.getByTestId('relation-map-open').click();
  await expect(page.getByTestId('relation-map-node-COOLER')).toContainText('높이 초과');
});

// QA: "파워 깊이 초과"는 치수 문제인데 '파워' 단어가 전력 정규식에 먼저 걸려 '전력 부족'으로
// 오분류되던 건 — tool/edge 식별 기반 분류가 우선하며 깊이/높이/길이를 구분한다.
test('classifies the PSU depth problem as a dimension label on the relation map', async ({ page }) => {
  await loginAsUser(page);
  const depthSummary = '파워 깊이 140mm / 케이스 허용 130mm입니다. 파워 깊이가 케이스 허용 길이를 초과합니다.';
  const base = buildGraphResponse();
  await page.route('**/api/build-graphs/resolve', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...base,
        nodes: base.nodes.map((node) => node.category === 'PSU' || node.category === 'CASE'
          ? { ...node, status: 'FAIL' }
          : { ...node, status: 'PASS' }),
        edges: [
          {
            id: 'edge-psu-case-depth',
            source: 'part-PSU',
            target: 'part-CASE',
            type: 'REQUIRES',
            status: 'FAIL',
            label: '깊이 장착 불가',
            summary: depthSummary
          }
        ],
        insights: [],
        toolResults: []
      })
    });
  });
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fullDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });

  await page.goto('/self-quote');
  await page.getByTestId('relation-map-open').click();

  const psuNode = page.getByTestId('relation-map-node-PSU');
  await expect(psuNode).toContainText('깊이 초과');
  await expect(psuNode).not.toContainText('전력 부족');
});

// 배치도 클릭 분리: 장착 부품 = 관계/문제 설명 팝오버(검색 안 열림), 후보 패널은
// 체크리스트·빈 슬롯·팝오버의 교체 버튼으로만 연다.
test('placement board part click explains relations instead of opening the candidate panel', async ({ page }) => {
  await loginAsUser(page);
  await page.route('**/api/build-graphs/resolve', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(problemGraphResponse()) });
  });
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fullDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });

  await page.goto('/self-quote');

  // 문제(FAIL) 부품 클릭 → 서버 사유 그대로의 문제 팝오버. 후보 패널·카테고리 선택은 일어나지 않는다.
  await page.getByTestId('slot-fused-area-GPU').click();
  const problemPopover = page.getByTestId('slot-problem-popover');
  await expect(problemPopover).toBeVisible();
  await expect(problemPopover).toContainText('장착 불가');
  await expect(problemPopover).toContainText('GPU 권장 정격 파워보다 PSU 용량이 부족합니다.');
  await expect(problemPopover.getByTestId('slot-problem-ai-explain')).toBeVisible();
  await expect(page.getByTestId('slot-candidate-panel')).toHaveCount(0);
  await expect(page).toHaveURL('/self-quote');

  // 팝오버 밖(보드 헤더 여백)을 클릭해도 닫히지 않는다 — 옮겨 놓고 쓰는 카드라 아무 클릭에나 사라지지 않는다.
  await page.getByTestId('slot-board-widget').click({ position: { x: 8, y: 8 } });
  await expect(problemPopover).toBeVisible();
  await expect(page.getByTestId('slot-candidate-panel')).toHaveCount(0);

  // 닫기는 명시적으로 — ESC로 닫힌다.
  await page.keyboard.press('Escape');
  await expect(problemPopover).toHaveCount(0);

  // 문제에 연루된 상대 부품 바로가기 — GPU 전력 문제에서 파워 후보로 곧장 넘어갈 수 있다.
  await page.getByTestId('slot-fused-area-GPU').click();
  await expect(problemPopover).toBeVisible();
  await problemPopover.getByRole('button', { name: '파워 후보 보기' }).click();
  await expect(problemPopover).toHaveCount(0);
  await expect(page).toHaveURL('/self-quote?category=PSU');
  await expect(page.getByTestId('slot-candidate-panel').getByRole('heading', { name: '파워 부품 목록' })).toBeVisible();
  await page.getByTestId('slot-candidate-panel').getByRole('button', { name: '후보 패널 닫기' }).click();
  await expect(page.getByTestId('slot-candidate-panel')).toHaveCount(0);

  // 정상 부품 클릭 → 초록 관계 요약 팝오버(그래프에 연루 관계가 없으면 기본 안내).
  await page.getByTestId('slot-fused-area-CPU').click();
  const relationPopover = page.getByTestId('slot-relation-popover');
  await expect(relationPopover).toBeVisible();
  await expect(relationPopover).toContainText('호환 가능');
  await expect(relationPopover).toContainText('현재 구성과 문제없이 맞물립니다.');
  await expect(page.getByTestId('slot-candidate-panel')).toHaveCount(0);

  // '다른 상품 보기' = 후보 패널 진입(교체 동선 유지).
  await relationPopover.getByRole('button', { name: '다른 상품 보기' }).click();
  await expect(relationPopover).toHaveCount(0);
  await expect(page).toHaveURL('/self-quote?category=CPU');
  await expect(page.getByTestId('slot-candidate-panel')).toBeVisible();

  // 체크리스트는 기존 유지 — 클릭하면 곧바로 후보 패널 카테고리 전환.
  await page.getByTestId('checklist-GPU').click();
  await expect(page).toHaveURL('/self-quote?category=GPU');
  await expect(page.getByTestId('slot-candidate-panel')).toBeVisible();
});

// 후보 패널(데스크톱)은 헤더를 잡고 드래그해 옮길 수 있고(보드 밖 허용, 화면 이탈만 방지),
// 꼭지점 리사이즈·더블클릭 원위치를 지원한다.
test('candidate panel can be dragged by its header on desktop', async ({ page }) => {
  await loginAsUser(page);
  await page.route('**/api/build-graphs/resolve', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildGraphResponse()) });
  });
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fullDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });

  await page.goto('/self-quote');
  await page.getByTestId('checklist-GPU').click();
  const panel = page.getByTestId('slot-candidate-panel');
  await expect(panel).toBeVisible();

  // 등장 애니메이션(slot-panel-in 220ms)이 끝난 뒤 측정 — 애니메이션 중엔 transform을 애니메이션이 쥔다.
  await page.waitForTimeout(350);
  const handle = page.getByTestId('slot-candidate-panel-handle');
  const before = await panel.boundingBox();
  expect(before).not.toBeNull();

  const handleBox = await handle.boundingBox();
  expect(handleBox).not.toBeNull();
  const startX = (handleBox?.x ?? 0) + (handleBox?.width ?? 0) / 2;
  const startY = (handleBox?.y ?? 0) + 12;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // 이동량은 보드 경계 클램프 안쪽으로 작게(패널 상하 여백은 12px) — 경계에선 그만큼만 움직이는 게 설계다.
  await page.mouse.move(startX + 24, startY + 8, { steps: 4 });
  await page.mouse.up();

  await expect.poll(async () => {
    const after = await panel.boundingBox();
    return {
      x: Math.round((after?.x ?? 0) - (before?.x ?? 0)),
      y: Math.round((after?.y ?? 0) - (before?.y ?? 0))
    };
  }).toEqual({ x: 24, y: 8 });

  // 우하단 꼭지점을 잡아당기면 크기가 커진다(네이티브 리사이즈).
  const beforeResize = await panel.boundingBox();
  const cornerX = (beforeResize?.x ?? 0) + (beforeResize?.width ?? 0) - 5;
  const cornerY = (beforeResize?.y ?? 0) + (beforeResize?.height ?? 0) - 5;
  await page.mouse.move(cornerX, cornerY);
  await page.mouse.down();
  await page.mouse.move(cornerX + 60, cornerY + 40, { steps: 4 });
  await page.mouse.up();
  const afterResize = await panel.boundingBox();
  expect((afterResize?.width ?? 0) - (beforeResize?.width ?? 0)).toBeGreaterThan(40);
  expect((afterResize?.height ?? 0) - (beforeResize?.height ?? 0)).toBeGreaterThan(20);

  // 보드 밖으로 끌어도 따라간다 — 대신 화면(뷰포트) 밖으로 완전히 사라지지는 않는다.
  await page.mouse.move(startX + 24, startY + 8);
  await page.mouse.down();
  await page.mouse.move(startX + 3000, startY + 3000, { steps: 6 });
  await page.mouse.up();
  const escaped = await page.evaluate(() => {
    const b = document.querySelector('[data-testid="slot-board"]')!.getBoundingClientRect();
    const p = document.querySelector('[data-testid="slot-candidate-panel"]')!.getBoundingClientRect();
    return { boardBottom: b.bottom, top: p.top, left: p.left, bottom: p.bottom, vw: window.innerWidth, vh: window.innerHeight };
  });
  expect(escaped.bottom).toBeGreaterThan(escaped.boardBottom);
  expect(escaped.top).toBeGreaterThanOrEqual(0);
  expect(escaped.top).toBeLessThanOrEqual(escaped.vh - 48 + 1);
  expect(escaped.left).toBeLessThanOrEqual(escaped.vw - 48 + 1);

  // 핸들 더블클릭 = 원위치·원크기 복귀 (클램프 후 핸들 중앙이 화면 밖일 수 있어 좌상단 지점을 찍는다).
  await handle.dblclick({ position: { x: 10, y: 10 } });
  const resetBox = await panel.boundingBox();
  expect(Math.abs((resetBox?.x ?? 0) - (before?.x ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((resetBox?.y ?? 0) - (before?.y ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((resetBox?.width ?? 0) - (before?.width ?? 0))).toBeLessThanOrEqual(1);

  // 헤더 안의 닫기 버튼은 드래그로 삼키지 않고 그대로 동작한다.
  await panel.getByRole('button', { name: '후보 패널 닫기' }).click();
  await expect(panel).toHaveCount(0);

  // 관계/문제 설명 팝오버도 같은 방식으로 드래그된다.
  await page.getByTestId('slot-fused-area-GPU').click();
  const popover = page.getByTestId('slot-problem-popover');
  await expect(popover).toBeVisible();
  const popoverBefore = await popover.boundingBox();
  const popoverHandle = await page.getByTestId('slot-problem-popover-handle').boundingBox();
  expect(popoverHandle).not.toBeNull();
  const hx = (popoverHandle?.x ?? 0) + (popoverHandle?.width ?? 0) / 2;
  const hy = (popoverHandle?.y ?? 0) + 8;
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  await page.mouse.move(hx + 30, hy + 20, { steps: 4 });
  await page.mouse.up();
  const popoverAfter = await popover.boundingBox();
  expect(Math.round((popoverAfter?.x ?? 0) - (popoverBefore?.x ?? 0))).toBe(30);
  expect(Math.round((popoverAfter?.y ?? 0) - (popoverBefore?.y ?? 0))).toBe(20);
  await popover.getByRole('button', { name: '문제 사유 닫기' }).click();
  await expect(popover).toHaveCount(0);
});

// 떠 있는 카드는 "가져다 놓고 쓰는" 도구다 — 한 번 옮기면 부품을 바꾸거나 닫았다 열어도 그 자리를 지킨다.
// (안 옮긴 상태에서는 기존대로 클릭한 부품 옆에 뜬다.)
test('floating cards keep the spot the user dragged them to', async ({ page }) => {
  await loginAsUser(page);
  await page.route('**/api/build-graphs/resolve', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildGraphResponse()) });
  });
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fullDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });

  await page.goto('/self-quote');

  // ── 설명 카드: 옮긴 자리가 부품을 바꿔도(문제 GPU → 정상 CPU, 카드 종류까지 바뀜) 유지된다.
  await page.getByTestId('slot-fused-area-GPU').click();
  const problem = page.getByTestId('slot-problem-popover');
  await expect(problem).toBeVisible();
  const problemHandle = await page.getByTestId('slot-problem-popover-handle').boundingBox();
  const px = (problemHandle?.x ?? 0) + (problemHandle?.width ?? 0) / 2;
  const py = (problemHandle?.y ?? 0) + 8;
  await page.mouse.move(px, py);
  await page.mouse.down();
  await page.mouse.move(px + 40, py + 30, { steps: 4 });
  await page.mouse.up();
  const placed = await problem.boundingBox();

  // 다른 부품 클릭 → 닫히지 않고, 놓아둔 자리에서 내용만 바뀐다.
  await page.getByTestId('slot-fused-area-CPU').click();
  const relation = page.getByTestId('slot-relation-popover');
  await expect(relation).toBeVisible();
  await expect(relation).toContainText('호환 가능');
  const afterSwitch = await relation.boundingBox();
  expect(Math.abs((afterSwitch?.x ?? 0) - (placed?.x ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((afterSwitch?.y ?? 0) - (placed?.y ?? 0))).toBeLessThanOrEqual(1);

  // 닫았다 다시 열어도 그 자리다.
  await relation.getByRole('button', { name: '관계 상태 닫기' }).click();
  await expect(relation).toHaveCount(0);
  await page.getByTestId('slot-fused-area-CPU').click();
  const reopened = await page.getByTestId('slot-relation-popover').boundingBox();
  expect(Math.abs((reopened?.x ?? 0) - (placed?.x ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((reopened?.y ?? 0) - (placed?.y ?? 0))).toBeLessThanOrEqual(1);

  // 더블클릭하면 기억한 자리를 버리고 부품 옆 기본 자리로 돌아간다.
  await page.getByTestId('slot-relation-popover-handle').dblclick({ position: { x: 10, y: 10 } });
  const afterReset = await page.getByTestId('slot-relation-popover').boundingBox();
  expect(Math.abs((afterReset?.x ?? 0) - (placed?.x ?? 0))).toBeGreaterThan(20);
  await page.keyboard.press('Escape');

  // ── 후보 패널: 옮긴 자리가 카테고리를 바꿔도, 닫았다 열어도 유지된다.
  await page.getByTestId('checklist-GPU').click();
  const panel = page.getByTestId('slot-candidate-panel');
  await expect(panel).toBeVisible();
  await page.waitForTimeout(350); // 등장 애니메이션(slot-panel-in)이 transform을 쥐고 있는 동안은 측정하지 않는다.
  const panelHandle = await page.getByTestId('slot-candidate-panel-handle').boundingBox();
  const hx = (panelHandle?.x ?? 0) + (panelHandle?.width ?? 0) / 2;
  const hy = (panelHandle?.y ?? 0) + 12;
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  await page.mouse.move(hx + 32, hy + 16, { steps: 4 });
  await page.mouse.up();
  const panelPlaced = await panel.boundingBox();

  await page.getByTestId('checklist-CPU').click();
  await expect(panel.getByRole('heading', { name: 'CPU 부품 목록' })).toBeVisible();
  const panelAfterSwitch = await panel.boundingBox();
  expect(Math.abs((panelAfterSwitch?.x ?? 0) - (panelPlaced?.x ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((panelAfterSwitch?.y ?? 0) - (panelPlaced?.y ?? 0))).toBeLessThanOrEqual(1);

  await panel.getByRole('button', { name: '후보 패널 닫기' }).click();
  await expect(panel).toHaveCount(0);
  await page.getByTestId('checklist-CPU').click();
  await expect(panel).toBeVisible();
  await page.waitForTimeout(350);
  const panelReopened = await panel.boundingBox();
  expect(Math.abs((panelReopened?.x ?? 0) - (panelPlaced?.x ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((panelReopened?.y ?? 0) - (panelPlaced?.y ?? 0))).toBeLessThanOrEqual(1);
});

test('draws a card-to-part elbow connector only for the selected card in 3D view', async ({ page }) => {
  await loginAsUser(page);
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fullDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });

  await page.goto('/self-quote');
  await page.getByRole('radio', { name: '3D' }).click();

  const connector = page.getByTestId('iso-card-connector');
  await expect(connector).toHaveCount(0);

  // 장착 카드 클릭은 관계 설명 팝오버로 바뀌었다 — 선택(후보 패널)은 체크리스트에서 건다.
  await page.getByTestId('checklist-GPU').click();
  await expect(page).toHaveURL('/self-quote?category=GPU');
  await expect(connector).toBeVisible();
  await expect(connector).toHaveCount(1);
  await expect(connector).toHaveAttribute('data-category', 'GPU');

  // 엘보(90도 1회): M으로 시작하고 꺾임 2개(L 2개)라 각진 선임을 확인한다.
  const d = await connector.locator('path').getAttribute('d');
  expect(d?.startsWith('M')).toBe(true);
  expect(d?.match(/L/g)?.length).toBe(2);

  // 오버레이가 열린 상태에서는 체크리스트로 카테고리를 바꾸면 같은 위치에서 후보와 연결선이 함께 갱신된다.
  await page.getByTestId('checklist-CPU').click();
  await expect(connector).toHaveAttribute('data-category', 'CPU');
  await expect(connector).toHaveCount(1);

  // 3D를 끄면 연결선도 사라진다(IsometricSlotBoardBody 안에만 존재).
  await page.getByRole('radio', { name: '배치도' }).click();
  await page.getByRole('button', { name: '실장도 보기' }).click();
  await expect(page.getByTestId('slot-board')).toHaveAttribute('data-visual-mode', 'motherboard');
  await expect(connector).toHaveCount(0);
});

test('uses a border-only asset for selected 3D motherboard highlight', async ({ request }) => {
  const response = await request.get('/slot-board/iso/scene-board-blue-highlight.svg');
  const svg = await response.text();

  expect(response.ok()).toBeTruthy();
  expect(svg).toContain('viewBox="0 0 1600 840"');
  expect(svg).toMatch(/stroke="#60a5fa"|stroke="#93c5fd"/);
  expect(svg).not.toMatch(/<(linearGradient|radialGradient)\b/);
  expect(svg).not.toMatch(/\sfill="(?!none")[^"]+"/);
});

test('highlights only the blue scene board layer when motherboard is selected in 3D view', async ({ page }) => {
  await loginAsUser(page);
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fullDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });

  await page.goto('/self-quote');
  await page.getByRole('radio', { name: '3D' }).click();

  await expect(page.getByTestId('slot-board-motherboard-highlight')).toHaveAttribute('data-active', 'false');
  await page.getByTestId('checklist-MOTHERBOARD').click();

  await expect(page).toHaveURL('/self-quote?category=MOTHERBOARD');
  await expect(page.getByTestId('slot-board-motherboard-highlight')).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('slot-board-motherboard-highlight')).toHaveCSS('background-image', /scene-board-blue-highlight\.svg/);
  await expect(page.getByTestId('slot-board-motherboard-art')).not.toHaveAttribute('data-selected', 'true');
  await expect(page.getByTestId('iso-part-MOTHERBOARD')).toHaveAttribute('data-selected', 'false');
  await expect(page.getByTestId('iso-part-MOTHERBOARD')).toHaveAttribute('data-spotlight', 'false');
  await expect(page.getByTestId('iso-part-MOTHERBOARD')).toHaveAttribute('data-dimmed', 'true');
  await expect(page.getByTestId('iso-part-CPU')).toHaveAttribute('data-dimmed', 'true');
  await expect(page.getByTestId('iso-part-GPU')).toHaveAttribute('data-dimmed', 'true');
});

test('uses admin-placed anchors for the 3D connector when available', async ({ page }) => {
  await loginAsUser(page);
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fullDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });
  await page.route('**/api/build-graph-layouts/default', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        layoutKey: 'DEFAULT',
        source: 'SAVED',
        positions: {},
        anchors: {
          GPU: { card: { x: 24, y: 84 }, part: { x: 40, y: 55 } }
        }
      })
    });
  });

  await page.goto('/self-quote');
  await page.getByRole('radio', { name: '3D' }).click();

  await page.getByTestId('checklist-GPU').click();
  const connector = page.getByTestId('iso-card-connector');
  await expect(connector).toHaveAttribute('data-category', 'GPU');
  await expect(connector).toHaveAttribute('data-anchor-source', 'admin');

  // cardCenter(35,91)→partPoint(40,55): dx=5 < dy=36이라 세로축을 먼저 진행하는 엘보.
  const d = await connector.locator('path').getAttribute('d');
  expect(d).toBe('M 24 84 L 24 55 L 40 55');
});

test('falls back to auto-computed anchors when the layout fetch fails', async ({ page }) => {
  await loginAsUser(page);
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fullDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });
  await page.route('**/api/build-graph-layouts/default', async (route) => {
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'layout fetch failed' }) });
  });

  await page.goto('/self-quote');
  await page.getByRole('radio', { name: '3D' }).click();

  await page.getByTestId('checklist-GPU').click();
  const connector = page.getByTestId('iso-card-connector');
  await expect(connector).toBeVisible();
  await expect(connector).toHaveAttribute('data-anchor-source', 'auto');
});

test('keeps card order badges but hides 3D glyph order badges', async ({ page }) => {
  await loginAsUser(page);
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fullDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });

  await page.goto('/self-quote');
  await page.getByRole('radio', { name: '3D' }).click();

  // 카드 번호 = 체크리스트 RECOMMENDED_SLOT_ORDER index+1 (SLOT_CONFIGS 순서가 아님).
  await expect(page.getByTestId('slot-order-CPU')).toHaveText('1');
  await expect(page.getByTestId('slot-order-MOTHERBOARD')).toHaveText('2');
  await expect(page.getByTestId('slot-order-GPU')).toHaveText('4');
  await expect(page.getByTestId('slot-order-COOLER')).toHaveText('8');

  // 3D 그림 위 번호는 제거하고, 부품 이미지만 유지한다.
  await expect(page.getByTestId('iso-part-CPU')).toBeVisible();
  await expect(page.getByTestId('iso-part-GPU')).toBeVisible();
  await expect(page.getByTestId('iso-part-PSU')).toBeVisible();
  await expect(page.getByTestId('iso-order-CPU')).toHaveCount(0);
  await expect(page.getByTestId('iso-order-GPU')).toHaveCount(0);
  await expect(page.getByTestId('iso-order-PSU')).toHaveCount(0);
});

test('shows the AI start banner on an empty quote with manual and AI entry points', async ({ page }) => {
  await loginAsUser(page);
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(emptyDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });

  await page.goto('/self-quote');

  const banner = page.getByTestId('quote-start-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('AI에게 예산과 용도만 알려주세요');

  // 견적이 다 비어 있으면 체크리스트 1번(CPU)과 보드의 CPU 실장 지점만 안내한다.
  // 후보 오버레이는 관계도를 가리지 않도록 명시적인 클릭 전에는 열지 않는다.
  await expect(page.getByTestId('checklist-CPU')).toHaveAttribute('data-next', 'true');
  await expect(page.getByTestId('checklist-CPU')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('slot-candidate-panel')).toHaveCount(0);
  await expect(page.getByTestId('slot-CPU')).toHaveClass(/slot-hint-shimmer/);

  // 직접 고르기 → CPU 후보 패널이 열린다.
  await page.getByTestId('quote-manual-start').click();
  await expect(page).toHaveURL('/self-quote?category=CPU');
  await expect(page.getByTestId('slot-candidate-panel')).toBeVisible();
  await expect(page.getByTestId('slot-candidate-panel').getByRole('heading', { name: 'CPU 부품 목록' })).toBeVisible();

  // AI로 시작하기 → 챗봇 패널이 열린다.
  await page.getByTestId('quote-ai-start').click();
  await expect(page.getByTestId('ai-chatbot-panel')).toBeVisible();
});

test('renders the quote checklist with progress, next-slot guide, and total', async ({ page }) => {
  await loginAsUser(page);
  const checklistItems = [
    draftItem('part-check-cpu', 'CPU', '체크 CPU', 300000),
    draftItem('part-check-board', 'MOTHERBOARD', '체크 보드', 200000)
  ];

  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...emptyDraft, items: checklistItems, totalPrice: 500000, itemCount: 2 })
    });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });

  await page.goto('/self-quote');

  const checklist = page.getByTestId('quote-checklist');
  await expect(checklist.getByTestId('quote-checklist-progress')).toHaveText('2/8 완료');
  // 합계는 하단 상태바(견적 합계)만 담당한다 — 체크리스트 안의 중복 총액 행은 제거됨.
  await expect(checklist.getByTestId('quote-checklist-total')).toHaveCount(0);

  await expect(checklist.getByTestId('checklist-CPU')).toHaveAttribute('data-filled', 'true');
  await expect(checklist.getByTestId('checklist-CPU')).toContainText('체크 CPU');
  await expect(checklist.getByTestId('checklist-CPU')).toContainText('300,000원');

  // 권장 순서상 다음 슬롯(RAM)이 체크리스트·보드 양쪽에서 강조된다.
  await expect(checklist.getByTestId('checklist-RAM')).toHaveAttribute('data-next', 'true');
  await expect(checklist.getByTestId('checklist-RAM')).toContainText('다음 선택');
  await expect(page.getByTestId('slot-RAM')).toHaveAttribute('data-next', 'true');
  await expect(page.getByTestId('quote-next-guide')).toContainText('다음: 3. RAM을 선택해 주세요');

  // 승인된 단일 화면 계약: 중복 품목 표는 숨기고 체크리스트와 요약 지표가 같은 정보를 담당한다.
  await expect(page.getByTestId('quote-items-table')).toHaveCount(0);
  await expect(page.getByTestId('quote-summary-bar')).toContainText('500,000원');

  // 체크리스트 클릭 = 구성 관계도 본문 위에 해당 카테고리 후보 오버레이 열기.
  await checklist.getByTestId('checklist-PSU').click();
  await expect(page).toHaveURL('/self-quote?category=PSU');
  await expect(page.getByTestId('slot-candidate-panel')).toBeVisible();
  await expect(page.getByTestId('slot-candidate-panel').getByRole('heading', { name: '파워 부품 목록' })).toBeVisible();
});

test('toggles the candidate overlay and closes it after replacing a single-slot part', async ({ page }) => {
  await loginAsUser(page);
  const putRequests: string[] = [];
  const cpuCandidates = [
    candidatePart('cpu-9600x', 'CPU', 'AMD Ryzen 5 9600X', { price: 320000 }),
    candidatePart('cpu-285k', 'CPU', 'Intel Core Ultra 9 285K', { price: 780000 })
  ];
  let selectedCpuId: string | null = null;

  await page.route('**/api/quote-drafts/current**', async (route) => {
    const method = route.request().method();
    if (method === 'PUT') {
      selectedCpuId = new URL(route.request().url()).pathname.split('/').pop() ?? null;
      if (selectedCpuId) putRequests.push(selectedCpuId);
    }
    const selected = cpuCandidates.find((part) => part.id === selectedCpuId);
    const items = selected ? [draftItem(selected.id, 'CPU', selected.name, selected.price)] : [];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...emptyDraft,
        items,
        totalPrice: items.reduce((sum, item) => sum + item.lineTotal, 0),
        itemCount: items.reduce((sum, item) => sum + item.quantity, 0)
      })
    });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: cpuCandidates, page: 0, size: 100, total: cpuCandidates.length })
    });
  });

  await page.goto('/self-quote?category=CPU');
  const candidates = page.getByTestId('slot-candidate-panel');
  await expect(candidates).toBeVisible();
  await expect(candidates).not.toContainText('PASS');

  // 이미 열린 카테고리를 다시 누르면 닫히고, 한 번 더 누르면 같은 오버레이가 다시 열린다.
  await page.getByTestId('checklist-CPU').click();
  await expect(page).toHaveURL('/self-quote');
  await expect(candidates).toHaveCount(0);
  await expect(page.getByTestId('checklist-CPU')).toHaveAttribute('aria-expanded', 'false');

  await page.getByTestId('checklist-CPU').click();
  await expect(page).toHaveURL('/self-quote?category=CPU');
  await expect(candidates).toBeVisible();
  await expect(page.getByTestId('checklist-CPU')).toHaveAttribute('aria-expanded', 'true');

  // 다른 체크리스트 슬롯은 패널을 닫지 않고 같은 위치에서 카테고리만 전환한다.
  await page.getByTestId('checklist-GPU').click();
  await expect(page).toHaveURL('/self-quote?category=GPU');
  await expect(candidates.getByRole('heading', { name: 'GPU 부품 목록' })).toBeVisible();
  await page.getByTestId('checklist-CPU').click();
  await expect(page).toHaveURL('/self-quote?category=CPU');
  await expect(candidates.getByRole('heading', { name: 'CPU 부품 목록' })).toBeVisible();

  await candidates.getByRole('button', { name: /AMD Ryzen 5 9600X 담기/ }).click();
  await expect.poll(() => putRequests).toEqual(['cpu-9600x']);
  await expect(page).toHaveURL('/self-quote');
  await expect(candidates).toHaveCount(0);
  await expect(page.getByTestId('checklist-CPU')).toContainText('AMD Ryzen 5 9600X');
  await expect(page.getByTestId('checklist-part-image-CPU')).toBeVisible();

  await page.getByTestId('checklist-CPU').click();
  await expect(candidates).toBeVisible();
  await candidates.getByRole('button', { name: /Intel Core Ultra 9 285K 교체/ }).click();
  await expect.poll(() => putRequests).toEqual(['cpu-9600x', 'cpu-285k']);
  await expect(page).toHaveURL('/self-quote');
  await expect(candidates).toHaveCount(0);
  await expect(page.getByTestId('checklist-CPU')).toContainText('Intel Core Ultra 9 285K');
});

test('overlays photo candidates on the board body without resizing the compatibility map', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await loginAsUser(page);
  const cpuCandidates = [candidatePart('cpu-overlay', 'CPU', '사진형 CPU 후보', { price: 390000 })];

  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(emptyDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: cpuCandidates, page: 0, size: 20, total: cpuCandidates.length })
    });
  });

  await page.goto('/self-quote');
  const board = page.getByTestId('slot-board-widget');
  const before = await board.boundingBox();
  expect(before).not.toBeNull();

  await page.getByTestId('checklist-CPU').click();
  const panel = page.getByTestId('slot-candidate-panel');
  await expect(panel).toBeVisible();
  // 헤더 제거 리디자인: 후보 패널이 떠도 판 위 플로팅 보기 전환은 그대로 보인다.
  await expect(page.getByRole('radio', { name: '배치도' })).toBeVisible();
  await expect(page.getByRole('radio', { name: '3D' })).toBeVisible();
  await expect(panel.getByTestId('candidate-part-image').first()).toBeVisible();

  const [after, panelBox] = await Promise.all([board.boundingBox(), panel.boundingBox()]);
  expect(after).not.toBeNull();
  expect(panelBox).not.toBeNull();
  expect(Math.abs((after?.width ?? 0) - (before?.width ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((after?.height ?? 0) - (before?.height ?? 0))).toBeLessThanOrEqual(1);
  expect(panelBox?.y ?? 0).toBeGreaterThan(before?.y ?? 0);
  expect(panelBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(522);

  const dismissLayer = page.getByTestId('slot-candidate-overlay-dismiss');
  const dismissBox = await dismissLayer.boundingBox();
  expect(dismissBox).not.toBeNull();
  await dismissLayer.click({ position: { x: Math.max(1, (dismissBox?.width ?? 2) - 8), y: Math.max(1, (dismissBox?.height ?? 2) / 2) } });
  await expect(panel).toHaveCount(0);
  await expect(page).toHaveURL('/self-quote');
});

test('keeps desktop candidate results scrollable and compact at a 150 percent zoom-sized viewport', async ({ page }) => {
  // 2048x1152 화면을 Chrome 150%로 보는 상황과 비슷한 CSS viewport다.
  // 너비는 데스크톱 breakpoint를 유지하지만 세로 작업 공간이 줄어드는 회귀를 재현한다.
  await page.setViewportSize({ width: 1366, height: 768 });
  await loginAsUser(page);

  const currentCpu = draftItem('cpu-zoom-current', 'CPU', '현재 장착된 CPU', 499000);
  const zoomDraft = {
    ...emptyDraft,
    id: 'draft-zoom-candidate-panel',
    items: [currentCpu],
    totalPrice: currentCpu.lineTotal,
    itemCount: 1
  };
  const cpuCandidates = Array.from({ length: 8 }, (_, index) =>
    candidatePart(`cpu-zoom-${index + 1}`, 'CPU', `확대 환경 CPU 후보 ${index + 1}`, {
      price: 250000 + index * 30000
    })
  );

  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(zoomDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: cpuCandidates, page: 0, size: 20, total: cpuCandidates.length })
    });
  });

  await page.goto('/self-quote?category=CPU');

  const panel = page.getByTestId('slot-candidate-panel');
  const candidateList = panel.getByTestId('slot-candidate-list');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveCSS('position', 'fixed');
  // 제목 아래 설명문은 없앴다 — 검색이 제목 바로 밑에 붙어야 후보가 위로 올라온다.
  await expect(panel.getByTestId('candidate-panel-description')).toHaveCount(0);
  // 필터는 기본 접힘 — 펼치기 전에는 컨트롤이 화면에 없다.
  await expect(panel.getByTestId('candidate-manufacturer')).toBeHidden();
  await expect(panel.getByTestId('slot-candidate-panel-handle')).toHaveCSS('padding-top', '8px');
  await expect(panel.getByTestId('candidate-panel-search')).toHaveCSS('padding-top', '6px');
  // 필터 행은 접혀 있으면 아예 없다(토글은 헤더의 정렬 옆) — 펼쳤을 때의 여백을 본다.
  await expect(panel.getByTestId('candidate-panel-filters')).toHaveCount(0);
  await panel.getByTestId('candidate-filters-toggle').click();
  await expect(panel.getByTestId('candidate-panel-filters')).toHaveCSS('padding-top', '6px');
  await panel.getByTestId('candidate-filters-toggle').click();
  await expect(panel.getByTestId('candidate-panel-selected')).toHaveCSS('padding-top', '6px');

  const metrics = await candidateList.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollbarGutter: style.scrollbarGutter,
      scrollbarWidth: style.scrollbarWidth
    };
  });
  expect(metrics.clientHeight).toBeGreaterThanOrEqual(120);
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
  expect(metrics.scrollbarGutter).toContain('stable');
  expect(metrics.scrollbarWidth).not.toBe('none');

  await candidateList.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
  await expect(panel.getByText('확대 환경 CPU 후보 8')).toBeVisible();
});

test('blocks purchase when a tool check fails without a matching edge', async ({ page }) => {
  await loginAsUser(page);
  // 감사 P1-3①: GPU가 없어 GPU-PSU 엣지가 안 생기는 견적에서 파워 용량 부족(power 툴 FAIL)이
  // 화면 어디에도 안 뜨고 구매가 열려 있던 사각 — 툴 FAIL도 차단·표기에 반영돼야 한다.
  const powerFailItems = [
    draftItem('part-cpu-hot', 'CPU', '고전력 CPU', 500000),
    draftItem('part-psu-small', 'PSU', '300W 파워', 40000)
  ];
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...emptyDraft, items: powerFailItems, totalPrice: 540000, itemCount: 2 })
    });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });
  await page.route('**/api/build-graphs/resolve', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        mode: 'BUILD_OVERVIEW',
        summary: '파워 용량을 확인했습니다.',
        nodes: [
          { id: 'part-CPU', type: 'PART', category: 'CPU', label: '고전력 CPU', status: 'PASS', detail: '' },
          { id: 'part-PSU', type: 'PART', category: 'PSU', label: '300W 파워', status: 'PASS', detail: '' }
        ],
        edges: [],
        focusNodeIds: [],
        insights: [],
        toolResults: [
          { tool: 'power', status: 'FAIL', confidence: 'HIGH', summary: 'PSU 정격 출력이 예상 부하와 GPU 권장 파워에 못 미쳐 상위 용량이 필요합니다.' }
        ]
      })
    });
  });

  await page.goto('/self-quote');

  await expect(page.getByTestId('quote-summary-bar').getByText('조건 미충족')).toBeVisible();
  const checkoutActions = page.getByTestId('quote-checkout-actions');
  const saveButton = checkoutActions.getByTestId('quote-save-button');
  const purchaseButton = checkoutActions.getByTestId('quote-purchase-button');
  await expect(saveButton).toBeEnabled();
  await expect(purchaseButton).toBeDisabled();
  await expect.poll(async () => {
    const [saveBox, purchaseBox] = await Promise.all([saveButton.boundingBox(), purchaseButton.boundingBox()]);
    return Boolean(saveBox && purchaseBox && Math.abs(saveBox.width - purchaseBox.width) <= 1);
  }).toBe(true);
  await expect(checkoutActions.getByRole('button', { name: '구매하기' })).toBeDisabled();
  await expect(checkoutActions.getByRole('button', { name: '구매하기' })).toHaveAttribute(
    'title',
    '안 맞는 부품이 있어 구매할 수 없습니다. 문제 슬롯을 교체해 주세요.'
  );
  await expect(checkoutActions.getByRole('button', { name: '내 견적함에 추가' })).toBeEnabled();
});

test('does not block purchase for a tool fail about a category that is not mounted', async ({ page }) => {
  await loginAsUser(page);
  // PSU를 아직 안 담았는데 power 툴이 FAIL(파워 없음)인 경우는 '비호환'이 아니라 '미장착'이다 — 차단하지 않는다.
  const cpuOnlyItems = [draftItem('part-cpu-only', 'CPU', '조립 시작 CPU', 300000)];
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...emptyDraft, items: cpuOnlyItems, totalPrice: 300000, itemCount: 1 })
    });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });
  await page.route('**/api/build-graphs/resolve', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        mode: 'BUILD_OVERVIEW',
        summary: '파워 미장착 상태입니다.',
        nodes: [{ id: 'part-CPU', type: 'PART', category: 'CPU', label: '조립 시작 CPU', status: 'PASS', detail: '' }],
        edges: [],
        focusNodeIds: [],
        insights: [],
        toolResults: [
          { tool: 'power', status: 'FAIL', confidence: 'MEDIUM', summary: 'PSU가 없어 부하를 감당할 수 없습니다.' }
        ]
      })
    });
  });

  await page.goto('/self-quote');

  await expect(page.getByTestId('quote-summary-bar')).toBeVisible();
  await expect(page.getByTestId('quote-summary-bar').getByText('조건 미충족')).toHaveCount(0);
  await expect(page.getByText('안 맞는 부품이 있어 구매할 수 없습니다', { exact: false })).toHaveCount(0);
});

test('does not show the removed completion guide when all eight slots are filled', async ({ page }) => {
  await loginAsUser(page);
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fullDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });

  await page.goto('/self-quote');

  await expect(page.getByTestId('quote-complete-guide')).toHaveCount(0);
  await expect(page.getByTestId('quote-next-guide')).toHaveCount(0);
  await expect(page.getByTestId('quote-start-banner')).toHaveCount(0);
  await expect(page.getByTestId('quote-checklist-progress')).toHaveText('8/8 완료');
});

test('keeps fixed placement coordinates even when the graph response carries saved positions', async ({ page }) => {
  await loginAsUser(page);

  await page.route('**/api/build-graphs/resolve', async (route) => {
    const base = buildGraphResponse();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...base,
        nodes: base.nodes.map((node) => {
          if (node.category === 'GPU') {
            return { ...node, position: { x: 54, y: 8 } };
          }
          if (node.category === 'PSU') {
            return { ...node, position: { x: 8, y: 64 } };
          }
          return node;
        })
      })
    });
  });
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fullDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });

  await page.goto('/self-quote');

  // 실장도는 평면도 아트(소켓/DIMM/PCIe)와 실장 지점이 픽셀 정합해야 하므로 배치가 고정이다 —
  // 그래프 응답에 저장 좌표가 있어도 무시한다(구 관리자 드래그 배치는 실장도에서 미사용).
  await expect(page.getByTestId('slot-GPU')).toHaveAttribute('style', /--sx:\s*37\.5%;\s*--sy:\s*62%/);
  await expect(page.getByTestId('slot-PSU')).toHaveAttribute('style', /--sx:\s*1\.25%;\s*--sy:\s*66%/);
  await expect(page.getByTestId('slot-CPU')).toHaveAttribute('style', /--sx:\s*48\.75%;\s*--sy:\s*30%/);
});

test('shows graph edge labels on the fallback topology relationships', async ({ page }) => {
  await loginAsUser(page);

  await page.route('**/api/build-graphs/resolve', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...buildGraphResponse(),
        edges: [
          {
            id: 'edge-cpu-board-socket',
            source: 'part-CPU',
            target: 'part-MOTHERBOARD',
            type: 'REQUIRES',
            status: 'PASS',
            label: '소켓 AM5 일치',
            summary: 'CPU와 메인보드 소켓이 일치합니다.'
          },
          {
            id: 'edge-gpu-psu-power',
            source: 'part-GPU',
            target: 'part-PSU',
            type: 'AFFECTS',
            status: 'WARN',
            label: '전력 여유 확인 필요',
            summary: 'GPU 권장 정격 파워 기준으로 여유가 빠듯합니다.'
          }
        ]
      })
    });
  });
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fullDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });

  await page.goto('/self-quote');
  // 관계선(엣지)은 실장도 보기 전용이다.
  await page.getByRole('button', { name: '실장도 보기' }).click();

  const edges = page.getByTestId('slot-board-edges');
  await expect(edges).toBeVisible();
  // 정상 관계선은 텍스트 라벨 대신 상태 점만 — 전문용어(소켓/PCIe)는 평상시에 노출하지 않는다.
  const passEdge = page.getByTestId('slot-edge-CPU-MOTHERBOARD');
  await expect(passEdge).toHaveAttribute('data-status', 'PASS');
  await expect(passEdge).toHaveText('');
  await expect(passEdge).toHaveAttribute('title', 'CPU와 메인보드 소켓이 일치합니다.');
  // 문제가 있는 관계선만 서버가 내려준 사유 라벨을 그대로 보여준다.
  const warnEdge = page.getByTestId('slot-edge-GPU-PSU');
  await expect(warnEdge).toHaveAttribute('data-status', 'WARN');
  await expect(warnEdge).toHaveText('전력 여유 확인 필요');
  // graph 응답에 없는 정상 관계선도 점으로만 표시된다.
  await expect(page.getByTestId('slot-edge-MOTHERBOARD-RAM')).toHaveText('');
  await expect(page.getByTestId('slot-edge-GPU-CASE')).toHaveText('');

  // 최신 main의 영향 지도는 위치만 유지하는 것이 아니라 진입·종료와 노드/관계 렌더링까지 보존한다.
  await page.getByTestId('relation-map-open').click();
  await expect(page.getByTestId('slot-board')).toHaveAttribute('data-visual-mode', 'relation-map');
  await expect(page.getByTestId('relation-map-node-CPU')).toBeVisible();
  await expect(page.locator('[data-testid^="relation-map-node-"]')).toHaveCount(8);
  await expect(page.getByTestId('relation-map-edges')).toBeVisible();
  // WARN 관계는 관계선과 노드에 남지만, 사용 가능한 견적에 큰 호환 불가 창을 띄우지 않는다.
  await expect(page.getByTestId('slot-board-problem-banner')).toHaveCount(0);
  await expect(page.getByTestId('slot-board-status-region')).toHaveCount(0);
  await expect(page.locator('[data-testid^="relation-map-node-"][data-status="WARN"]').first()).toBeVisible();
  await expect(page.getByTestId('relation-map-bottom-banner')).toHaveCount(0);
  const relationMapLegend = page.getByTestId('slot-board-legend');
  await expect(relationMapLegend).toBeVisible();
  await expect(relationMapLegend).toContainText('정상');
  await expect(relationMapLegend).toContainText('주의');
  await expect(relationMapLegend).toContainText('불가');
  await expect(relationMapLegend).toContainText('대기');
  const relationMapFitsBoard = await page.getByTestId('relation-map-stage').evaluate((stage) => {
    const board = stage.closest('[data-testid="slot-board"]');
    if (!(board instanceof HTMLElement)) return false;
    const stageRect = stage.getBoundingClientRect();
    const nodes = [...stage.querySelectorAll<HTMLElement>('[data-testid^="relation-map-node-"]')];
    const nodesFitStage = nodes.length === 8 && nodes.every((node) => {
      const nodeRect = node.getBoundingClientRect();
      const selectButton = node.querySelector<HTMLElement>('button[aria-label$=" 선택"]');
      return nodeRect.left >= stageRect.left - 1
        && nodeRect.top >= stageRect.top - 1
        && nodeRect.right <= stageRect.right + 1
        && nodeRect.bottom <= stageRect.bottom + 1
        && (!selectButton || selectButton.scrollHeight <= selectButton.clientHeight + 2);
    });
    return nodesFitStage
      && stage.scrollWidth <= stage.clientWidth + 2
      && stage.scrollHeight <= stage.clientHeight + 2
      && stage.getBoundingClientRect().width <= board.getBoundingClientRect().width + 1
      && stage.getBoundingClientRect().height <= board.getBoundingClientRect().height + 1;
  });
  expect(relationMapFitsBoard).toBe(true);
  await page.getByTestId('relation-map-open').click();
  await expect(page.getByTestId('slot-board')).toHaveAttribute('data-visual-mode', 'fused');
  await expect(page.getByTestId('slot-board-legend')).toHaveCount(0);
  const fusedPlate = page.getByTestId('slot-board-fused-plate');
  await expect(fusedPlate).toBeVisible();
  const fusedBoardRatio = FUSED_BOARD_SIZE.width / FUSED_BOARD_SIZE.height;
  await expect.poll(() => fusedPlate.evaluate((plate, expectedRatio) => {
    const art = plate.firstElementChild;
    if (!(art instanceof HTMLElement)) return false;
    const plateRect = plate.getBoundingClientRect();
    const artRect = art.getBoundingClientRect();
    const actualRatio = artRect.width / artRect.height;
    return artRect.width > 0
      && artRect.height > 0
      && artRect.left >= plateRect.left - 1
      && artRect.top >= plateRect.top - 1
      && artRect.right <= plateRect.right + 1
      && artRect.bottom <= plateRect.bottom + 1
      && Math.abs(actualRatio - expectedRatio) < 0.01;
  }, fusedBoardRatio)).toBe(true);
});

test('keeps fallback topology edges when the graph api fails', async ({ page }) => {
  await loginAsUser(page);

  await page.route('**/api/build-graphs/resolve', async (route) => {
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'graph resolve failed' }) });
  });
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fullDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });

  await page.goto('/self-quote');

  // graph API가 실패해도 슬롯 보드와 기본 topology 관계선(상태 점)은 항상 렌더링된다.
  await expect(page.getByTestId('slot-board')).toBeVisible();
  await page.getByRole('button', { name: '실장도 보기' }).click();
  await expect(page.getByTestId('slot-edge-CPU-MOTHERBOARD')).toHaveAttribute('data-status', 'BASE');
  await expect(page.getByTestId('slot-edge-MOTHERBOARD-RAM')).toHaveAttribute('data-status', 'BASE');
  // P1-1: 보드 규격 vs 케이스 지원 — 실장 관계(implied)라 선 없이 상태 점으로 표시된다.
  await expect(page.getByTestId('slot-edge-MOTHERBOARD-CASE')).toHaveAttribute('data-status', 'BASE');
  // P1-2: 보드 M.2 슬롯 vs SSD 수 — 실장 관계(implied)라 SSD 실장 지점의 상태 점으로 표시된다.
  await expect(page.getByTestId('slot-edge-MOTHERBOARD-STORAGE')).toHaveAttribute('data-status', 'BASE');
  await expect(page.getByTestId('slot-edge-GPU-PSU')).toHaveAttribute('data-status', 'BASE');
  await expect(page.getByTestId('slot-edge-GPU-CASE')).toHaveAttribute('data-status', 'BASE');
  await expect(page.getByTestId('slot-edge-COOLER-CASE')).toHaveAttribute('data-status', 'BASE');
  await expect(page.getByTestId('quote-summary-bar')).toContainText('8 / 8');

  await page.getByRole('radio', { name: '3D' }).click();
  await expect(page.getByTestId('slot-board')).toHaveAttribute('data-visual-mode', 'isometric');
  await expect(page.getByTestId('iso-part-GPU')).toBeVisible();
  await expect(page.getByTestId('slot-board-edges')).toHaveCount(0);
  await expect(page.getByTestId('quote-summary-bar')).toContainText('검증 확인 불가');
});

test('shows the current build performance panel from the resolve performance tool result', async ({ page }) => {
  await loginAsUser(page);
  const draft = {
    ...emptyDraft,
    items: [
      draftItem('part-perf-cpu', 'CPU', '라이젠 9600X', 300000),
      draftItem('part-perf-gpu', 'GPU', 'RTX 5060', 500000)
    ],
    totalPrice: 800000,
    itemCount: 2
  };
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(draft) });
  });
  await page.route('**/api/build-graphs/resolve', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...buildGraphResponse(),
        compositeScore: compositeScoreFixture(),
        toolResults: [
          {
            tool: 'performance',
            status: 'WARN',
            confidence: 'HIGH',
            summary: '성능 여유가 낮아 상위 부품을 검토해야 합니다. 점수는 참고용입니다.',
            details: {
              cpu: '라이젠 9600X',
              gpu: 'RTX 5060',
              cpuBenchmarkScore: 68,
              gpuBenchmarkScore: 63,
              vramGb: 8,
              benchmarkSource: 'benchmark_summaries',
              guaranteePolicy: 'NO_EXACT_FPS_OR_RENDER_TIME_GUARANTEE'
            }
          }
        ]
      })
    });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });
  // GPU가 있어 FPS 섹션이 조회를 시도한다 — 자료 없음 응답으로 격리(이 테스트는 FPS를 단언하지 않음).
  await page.route('**/api/tools/performance/check', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tool: 'performance', status: 'WARN', confidence: 'MEDIUM', summary: '', details: { gameFpsEvidence: [] } }) });
  });

  await page.goto('/self-quote');

  const panel = page.getByTestId('quote-performance-panel');
  await expect(panel).toBeVisible();
  // 탭 없는 상시 2열: 종합 점수·게임 FPS(왼쪽)와 비교 작업창(오른쪽)이 한 화면에 함께 보인다.
  await expect(panel.getByTestId('perf-tab-composite')).toHaveCount(0);
  await expect(panel.getByTestId('perf-tab-game')).toHaveCount(0);
  // CPU/GPU 개별 점수 대신 완성 견적 1000점 종합 점수만 대표로 노출한다.
  await expect(panel.getByTestId('quote-performance-grid')).toBeVisible();
  // 승인된 압축형에서는 별도 "담긴 견적 성능/기본형" 외곽 헤더를 두지 않는다.
  await expect(panel.getByTestId('quote-performance-fit')).toHaveCount(0);
  await expect(panel.getByTestId('quote-composite-score-gauge')).toBeVisible();
  await expect(panel.getByTestId('quote-composite-score')).toContainText('734');
  const gaugeContainsScore = await panel.getByTestId('quote-composite-score-gauge').evaluate((gauge) => {
    const svg = gauge.querySelector('svg');
    const arc = svg?.querySelector('path');
    const score = gauge.querySelector('[data-testid="quote-composite-score"]');
    if (!(svg instanceof SVGElement) || !(arc instanceof SVGElement) || !(score instanceof HTMLElement)) return false;
    const svgRect = svg.getBoundingClientRect();
    const scoreRect = score.getBoundingClientRect();
    return svgRect.width >= 160
      && svgRect.height <= 80
      && svg.getAttribute('preserveAspectRatio') === 'none'
      && (arc.getAttribute('d') ?? '').includes('A 102 86')
      && scoreRect.left >= svgRect.left
      && scoreRect.right <= svgRect.right
      && scoreRect.top >= svgRect.top
      && scoreRect.bottom <= svgRect.bottom;
  });
  expect(gaugeContainsScore).toBe(true);
  await expect(panel.getByTestId('quote-composite-score-title')).toHaveCSS('white-space', 'nowrap');
  await expect(panel.getByTestId('quote-composite-score-delta')).toHaveCount(0);
  await expect(panel).toContainText('호환·성능·여유 종합 1000점');
  await expect(panel.getByTestId('quote-composite-score-bar')).toHaveCount(0);
  await expect(panel.getByTestId('quote-performance-cpu-score')).toHaveCount(0);
  await expect(panel.getByTestId('quote-performance-gpu-score')).toHaveCount(0);
  // 후보 선택 콤보와 게임 예상 성능은 압축 핵심 지표 안에서 함께 동작한다.
  await expect(panel.getByTestId('perf-candidate-select')).toContainText('교체 후보 선택');
  await expect(panel.getByTestId('quote-fps-section')).toBeVisible();
  await expect(panel.getByTestId('quote-fps-section')).toContainText('참고 자료 없음');
  // 미선택 상태에서는 중복 설명·빈 비교 그래프를 노출하지 않는다.
  await expect(panel.getByTestId('cost-effect-empty')).toHaveCount(0);
  await expect(page.getByTestId('quote-checkout-actions')).toBeVisible();
  const summarySizing = await page.getByTestId('quote-summary-bar').locator(':scope > .panel').evaluateAll((cards) => {
    const heights = cards.map((card) => card.getBoundingClientRect().height);
    const action = cards.find((card) => card.getAttribute('data-testid') === 'quote-checkout-actions');
    const buttons = action ? [...action.querySelectorAll('button, a')] : [];
    return {
      cardCount: cards.length,
      heightGap: Math.max(...heights) - Math.min(...heights),
      actionMinHeight: Math.min(...buttons.map((button) => button.getBoundingClientRect().height))
    };
  });
  expect(summarySizing).toMatchObject({ cardCount: 4, heightGap: 0, actionMinHeight: 36 });
});

test('submits the server-authoritative score explanation and renders the assessment card', async ({ page }) => {
  await loginAsUser(page);
  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.authUser', JSON.stringify({
      id: 'user-score-explanation',
      email: 'user@example.com',
      name: 'Score Explanation User',
      role: 'USER'
    }));
  });
  const draft = {
    ...emptyDraft,
    items: [
      draftItem('part-score-cpu', 'CPU', 'Core Ultra 9 285K', 780000),
      draftItem('part-score-gpu', 'GPU', 'RTX 5060', 500000)
    ],
    totalPrice: 1280000,
    itemCount: 2
  };
  let chatRequest: Record<string, unknown> = {};
  await page.route('**/api/quote-drafts/current**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(draft) }));
  await page.route('**/api/build-graphs/resolve', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ...buildGraphResponse(), compositeScore: compositeScoreFixture() })
  }));
  await page.route('**/api/parts**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) }));
  await page.route('**/api/tools/performance/check', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ tool: 'performance', status: 'WARN', confidence: 'HIGH', summary: '', details: { gameFpsEvidence: [] } })
  }));
  await page.route('**/api/ai/build-chat', async (route) => {
    chatRequest = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        answerType: 'GENERAL',
        message: 'CPU 성능 여유는 크지만 GPU가 게임 성능 균형을 제한해 GPU 상향을 먼저 검토하는 편이 좋습니다.',
        builds: [],
        simulation: null,
        warnings: [],
        quickReplies: ['현재 견적에 맞는 상위 GPU 추천해줘'],
        buildAssessment: {
          type: 'COMPOSITE_SCORE_EXPLANATION',
          score: 742,
          maxScore: 1000,
          grade: 'C',
          label: '기본형',
          summary: 'CPU 체급에 비해 GPU 성능 균형이 낮습니다.',
          strengths: [{ code: 'HIGH_CPU_TIER', severity: 'PASS', title: 'CPU 성능 여유', description: '현재 CPU는 상위권 구성입니다.', relatedCategories: ['CPU'] }],
          cautions: [{ code: 'CPU_GPU_IMBALANCE', severity: 'WARN', title: 'CPU와 GPU 성능 균형', description: 'GPU가 상대적으로 낮습니다.', relatedCategories: ['CPU', 'GPU'] }],
          recommendations: [{ priority: 1, category: 'GPU', title: 'GPU 상향 우선', reason: '현재 구성의 가장 큰 성능 제한 요소입니다.', prompt: '현재 견적에 맞는 상위 GPU 추천해줘' }],
          evaluatedAt: '2026-07-13T00:00:00Z'
        }
      })
    });
  });

  await page.goto('/self-quote');
  await page.getByTestId('quote-score-ai-explain').click();

  await expect(page.getByTestId('ai-build-assessment')).toBeVisible();
  await expect(page.getByTestId('ai-build-assessment')).toHaveAttribute('data-response-surface', 'plain');
  await expect(page.getByTestId('ai-build-assessment')).not.toHaveClass(/border-blue-100|bg-blue-50/);
  await expect(page.getByTestId('ai-build-assessment')).toContainText('742');
  await expect(page.getByTestId('ai-build-assessment')).toContainText('GPU 상향 우선');
  expect(chatRequest['assessmentContext']).toEqual({ source: 'QUOTE_DRAFT_CURRENT', focusType: 'SCORE' });
  await expect(page.getByTestId('ai-build-assessment')).not.toContainText('성능 430');
});

test('keeps the measured WARN fit reason in slot details and sends the same Tool focus to AI', async ({ page }) => {
  await loginAsUser(page);
  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.authUser', JSON.stringify({
      id: 'user-fit-explanation',
      email: 'user@example.com',
      name: 'Fit Explanation User',
      role: 'USER'
    }));
  });
  let chatRequest: Record<string, unknown> = {};
  const base = buildGraphResponse();
  const fitSummary = '쿨러 높이 157mm / 케이스 허용 160mm입니다. 여유 3mm로 장착은 가능하지만 간섭을 주의해야 합니다.';

  await page.route('**/api/quote-drafts/current**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(fullDraft)
  }));
  await page.route('**/api/build-graphs/resolve', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ...base,
      nodes: base.nodes.map((node) => node.category === 'COOLER' || node.category === 'CASE'
        ? { ...node, status: 'WARN', detail: node.category === 'COOLER' ? '높이 157mm' : 'CPU 쿨러 최대 160mm' }
        : node),
      edges: [{
        id: 'edge-cooler-case-height',
        source: 'part-COOLER',
        target: 'part-CASE',
        type: 'REQUIRES',
        status: 'WARN',
        label: '높이 간섭 주의',
        summary: fitSummary
      }],
      toolResults: [{
        tool: 'size',
        status: 'WARN',
        confidence: 'MEDIUM',
        summary: '케이스 장착 여유가 낮아 추가 확인이 필요합니다.',
        details: { coolerHeightMm: 157, maxCpuCoolerHeightMm: 160, coolerHeadroomMm: 3 }
      }]
    })
  }));
  await page.route('**/api/parts**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 })
  }));
  await page.route('**/api/ai/build-chat', async (route) => {
    chatRequest = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        answerType: 'GENERAL',
        message: 'CPU 쿨러와 케이스 사이의 높이 여유가 3mm라 조립 시 간섭을 주의해야 합니다.',
        builds: [],
        simulation: null,
        warnings: [],
        quickReplies: []
      })
    });
  });

  await page.goto('/self-quote');

  // WARN-only는 큰 경고창을 만들지 않지만, 슬롯의 경고와 상세 사유·AI 설명은 그대로 제공한다.
  await expect(page.getByTestId('slot-board-problem-banner')).toHaveCount(0);
  const coolerArea = page.getByTestId('slot-fused-area-COOLER');
  await expect(page.getByTestId('slot-fused-area-wrap-COOLER')).toHaveAttribute('data-status', 'WARN');
  await coolerArea.click();
  const problemPopover = page.getByTestId('slot-problem-popover');
  await expect(problemPopover).toContainText(fitSummary);
  await problemPopover.getByTestId('slot-problem-ai-explain').click();


  await expect.poll(() => chatRequest['assessmentContext']).toEqual({
    source: 'QUOTE_DRAFT_CURRENT',
    focusType: 'ISSUE',
    category: 'COOLER',
    tool: 'size'
  });

  chatRequest = {};
  await page.getByRole('radio', { name: '3D' }).click();
  await page.getByTestId('iso-part-marker-COOLER').click();
  await page.getByTestId('slot-problem-popover').getByTestId('slot-problem-ai-explain').click();

  await expect.poll(() => chatRequest['assessmentContext']).toEqual({
    source: 'QUOTE_DRAFT_CURRENT',
    focusType: 'ISSUE',
    category: 'COOLER',
    tool: 'size'
  });
});

test('keeps the ATX case mismatch warning in context without overlapping board controls', async ({ page }) => {
  await loginAsUser(page);
  const message = '메인보드 규격 ATX / 케이스 지원 최대 M-ATX입니다. 케이스가 이 보드 규격의 장착을 지원하지 않습니다.';
  const base = buildGraphResponse();

  await page.route('**/api/quote-drafts/current**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(fullDraft)
  }));
  await page.route('**/api/build-graphs/resolve', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ...base,
      nodes: base.nodes.map((node) => node.category === 'MOTHERBOARD' || node.category === 'CASE'
        ? { ...node, status: 'FAIL' }
        : { ...node, status: 'PASS' }),
      edges: [{
        id: 'edge-board-case-form',
        source: 'part-MOTHERBOARD',
        target: 'part-CASE',
        type: 'REQUIRES',
        status: 'FAIL',
        label: '보드 규격 장착 불가',
        summary: message
      }],
      insights: [],
      toolResults: [{
        tool: 'size',
        status: 'FAIL',
        confidence: 'HIGH',
        summary: message,
        details: { motherboardFormFactor: 'ATX', caseMaxFormFactor: 'M-ATX' }
      }]
    })
  }));
  await page.route('**/api/parts**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 })
  }));

  await page.goto('/self-quote');

  const expectStatusOverlayInBoard = async () => {
    const statusRegion = page.getByTestId('slot-board-status-region');
    const board = page.getByTestId('slot-board');
    await expect(statusRegion).toHaveAttribute('data-placement', 'overlay');
    await expect(statusRegion).toBeVisible();
    await expect(board).toBeVisible();
    await expect.poll(async () => {
      const [statusBox, boardBox] = await Promise.all([statusRegion.boundingBox(), board.boundingBox()]);
      return Boolean(
        statusBox
        && boardBox
        && statusBox.y >= boardBox.y - 1
        && statusBox.y + statusBox.height <= boardBox.y + boardBox.height
        && statusBox.x >= boardBox.x - 1
        && statusBox.x + statusBox.width <= boardBox.x + boardBox.width + 1
        && statusBox.y <= boardBox.y + boardBox.height * 0.22
      );
    }).toBe(true);
  };

  // 헤더 제거 리디자인: 문제 칩은 모든 보기에서 보드 스테이지 좌상단 공용 스트립에 뜬다 — 배치 계약이 하나로 통일됨.
  const expectStatusAboveBoard = expectStatusOverlayInBoard;

  const expectStatusOverlayInRelationMapFrame = async () => {
    const statusRegion = page.getByTestId('slot-board-status-region');
    const frame = page.getByTestId('relation-map-frame');
    await expect(statusRegion).toHaveAttribute('data-placement', 'overlay');
    await expect(statusRegion).toBeVisible();
    await expect(frame).toBeVisible();
    await expect.poll(async () => statusRegion.evaluate((node) => (
      Boolean(node.parentElement?.closest('[data-testid="slot-board-widget"]'))
    ))).toBe(true);
    await expect.poll(async () => {
      const [statusBox, frameBox] = await Promise.all([statusRegion.boundingBox(), frame.boundingBox()]);
      return Boolean(
        statusBox
        && frameBox
        && statusBox.y >= frameBox.y - 24
        && statusBox.y + statusBox.height <= frameBox.y + frameBox.height
        && statusBox.x >= frameBox.x - 1
        && statusBox.x + statusBox.width <= frameBox.x + frameBox.width + 1
        && statusBox.y <= frameBox.y + frameBox.height * 0.22
      );
    }).toBe(true);
  };

  const banner = page.getByTestId('slot-board-problem-banner');
  // 리디자인: 칩은 건수만 표기 — 상세 메시지와 AI 설명 버튼은 클릭 시 열리는 모달이 담당한다.
  await expect(banner).toContainText('1건');
  await banner.click();
  const singleProblemList = page.getByTestId('slot-board-problem-list');
  await expect(singleProblemList).toContainText(message);
  await expect(singleProblemList.getByTestId('slot-problem-ai-explain')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(singleProblemList).toHaveCount(0);
  await expectStatusOverlayInBoard();
  const defaultProblemBannerBox = await banner.boundingBox();
  if (!defaultProblemBannerBox) {
    throw new Error('default relation diagram problem banner bounding box is missing');
  }

  for (const control of [
    page.getByTestId('relation-map-open'),
    page.getByRole('button', { name: '실장도 보기' })
  ]) {
    await expect(control).toBeVisible();
    await expect.poll(async () => {
      const [statusBox, controlBox] = await Promise.all([
        page.getByTestId('slot-board-status-region').boundingBox(),
        control.boundingBox()
      ]);
      return Boolean(statusBox && controlBox && statusBox.y + statusBox.height <= controlBox.y);
    }).toBe(true);
  }

  await page.getByRole('button', { name: '실장도 보기' }).click();
  await expect(page.getByTestId('slot-board')).toHaveAttribute('data-visual-mode', 'motherboard');
  await expectStatusAboveBoard();

  await page.getByRole('button', { name: '실장도 접기' }).click();
  await expect(page.getByTestId('slot-board')).toHaveAttribute('data-visual-mode', 'fused');
  await expectStatusOverlayInBoard();
  await page.getByRole('radio', { name: '3D' }).click();
  await expect(page.getByTestId('slot-board')).toHaveAttribute('data-visual-mode', 'isometric');
  await expectStatusAboveBoard();

  await page.getByRole('radio', { name: '배치도' }).click();
  await page.getByTestId('relation-map-open').click();
  const relationMapProblemBanner = page.getByTestId('slot-board-problem-banner');
  await expect(relationMapProblemBanner).toBeVisible();
  await expect(relationMapProblemBanner).not.toContainText(message);
  await expect(page.getByTestId('relation-map-bottom-banner')).toHaveCount(0);
  await expectStatusOverlayInRelationMapFrame();
  await expect.poll(async () => {
    const relationMapProblemBannerBox = await relationMapProblemBanner.boundingBox();
    return relationMapProblemBannerBox
      ? Math.abs(relationMapProblemBannerBox.y - defaultProblemBannerBox.y)
      : Number.POSITIVE_INFINITY;
  }).toBeLessThanOrEqual(1);
  await page.getByTestId('relation-map-open').click();
  await expect(page.getByTestId('slot-board')).toHaveAttribute('data-visual-mode', 'fused');
  await expectStatusOverlayInBoard();

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileStatusRegion = page.getByTestId('slot-board-status-region');
  await expect(mobileStatusRegion).toBeVisible();
  await expect.poll(async () => {
    const mobileStatusBox = await mobileStatusRegion.boundingBox();
    return Boolean(
      mobileStatusBox
      && mobileStatusBox.x >= 0
      && mobileStatusBox.x + mobileStatusBox.width <= 390
    );
  }).toBe(true);
});

test('does not reserve a board status row when the graph has no warning or failure', async ({ page }) => {
  await loginAsUser(page);
  const base = buildGraphResponse();

  await page.route('**/api/quote-drafts/current**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(fullDraft)
  }));
  await page.route('**/api/build-graphs/resolve', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ...base,
      nodes: base.nodes.map((node) => ({ ...node, status: 'PASS' })),
      edges: base.edges.map((edge) => ({ ...edge, status: 'PASS' })),
      insights: [],
      toolResults: []
    })
  }));
  await page.route('**/api/parts**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 })
  }));

  await page.goto('/self-quote');

  await expect(page.getByTestId('slot-board-status-region')).toHaveCount(0);
  await expect(page.getByTestId('slot-board')).toBeVisible();
});

test('closes the open FAIL problem modal when the refreshed graph becomes WARN-only', async ({ page }) => {
  await loginAsUser(page);
  let hasFail = true;
  let draft = fullDraft;

  await page.route('**/api/quote-drafts/current**', async (route) => {
    if (route.request().method() === 'DELETE') {
      hasFail = false;
      const items = fullDraftItems.filter((item) => item.category !== 'GPU');
      draft = {
        ...fullDraft,
        items,
        totalPrice: items.reduce((sum, item) => sum + item.lineTotal, 0),
        itemCount: items.reduce((sum, item) => sum + item.quantity, 0)
      };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(draft) });
  });
  await page.route('**/api/build-graphs/resolve', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(hasFail ? problemGraphResponse() : buildGraphResponse())
    });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });

  await page.goto('/self-quote');
  await page.getByRole('button', { name: '실장도 보기' }).click();
  await page.getByTestId('slot-board-problem-banner').click();
  await expect(page.getByTestId('slot-board-problem-list')).toBeVisible();

  // 열린 모달이 포인터 입력을 막고 있어도 실제 mutation 완료에 따른 graph 갱신을 재현한다.
  const removeGpuButton = page.getByRole('button', { name: '풀보드 RTX GPU 견적에서 제거' });
  await expect(removeGpuButton).toBeAttached();
  await removeGpuButton.evaluate((button: HTMLButtonElement) => button.click());

  await expect.poll(() => hasFail).toBe(false);
  await expect(page.getByTestId('slot-board-problem-list')).toHaveCount(0);
  await expect(page.getByTestId('slot-board-problem-banner')).toHaveCount(0);
  await expect(page.getByTestId('slot-PSU')).toHaveAttribute('data-status', 'WARN');
});

test('shows game FPS reference in the performance panel with game and resolution selectors', async ({ page }) => {
  await loginAsUser(page);
  const draft = {
    ...emptyDraft,
    items: [
      draftItem('part-perf-cpu', 'CPU', '라이젠 9600X', 300000),
      draftItem('part-perf-gpu', 'GPU', 'RTX 5060', 500000)
    ],
    totalPrice: 800000,
    itemCount: 2
  };
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(draft) });
  });
  await page.route('**/api/build-graphs/resolve', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...buildGraphResponse(),
        compositeScore: compositeScoreFixture(812, '균형형'),
        toolResults: [{
          tool: 'performance',
          status: 'PASS',
          confidence: 'HIGH',
          summary: '적합도 점수상 무리가 적습니다.',
          details: { cpu: '라이젠 9600X', gpu: 'RTX 5060', cpuBenchmarkScore: 68, gpuBenchmarkScore: 63, benchmarkSource: 'benchmark_summaries' }
        }]
      })
    });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });
  // FPS 조회 — 요청 body의 game/resolution에 따라 다른 값을 돌려줘 선택기 동작을 검증한다.
  await page.route('**/api/tools/performance/check', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    const game = String(body?.context?.game ?? '');
    const resolution = String(body?.context?.resolution ?? '');
    const avgFps = game.includes('valorant') ? 240 : resolution === '4k' ? 55 : 130;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tool: 'performance', status: 'PASS', confidence: 'HIGH', summary: '',
        details: {
          gameFpsEvidence: [{
            gameTitle: game.includes('valorant') ? '발로란트' : '배틀그라운드',
            gameKey: game.includes('valorant') ? 'valorant' : 'pubg',
            resolution: resolution === '4k' ? '4K' : resolution === 'fhd' ? 'FHD' : 'QHD',
            graphicsPreset: 'PC_BUILDS_MEDIUM',
            avgFps,
            onePercentLowFps: Math.round(avgFps * 0.7),
            sourceName: 'PC-Builds FPS calculator',
            confidence: 'MEDIUM',
            match: { evidenceExactness: 'GPU_CLASS_REFERENCE', gameMatched: true, resolutionMatched: true }
          }]
        }
      })
    });
  });

  await page.goto('/self-quote');

  // 게임 FPS 섹션은 탭 없이 오른쪽 작업창 안에 항상 함께 보인다.
  const fps = page.getByTestId('quote-fps-section');
  await expect(fps).toBeVisible();
  await expect(page.getByTestId('quote-performance-grid')).toBeVisible();
  await expect(page.getByTestId('quote-performance-score-column')).toBeVisible();
  await expect.poll(async () => {
    const [scoreBox, checklistBox] = await Promise.all([
      page.getByTestId('quote-performance-score-column').boundingBox(),
      page.getByTestId('quote-checklist').boundingBox()
    ]);
    if (!scoreBox || !checklistBox) return Number.POSITIVE_INFINITY;
    return Math.abs((scoreBox.x + scoreBox.width) - (checklistBox.x + checklistBox.width));
  }).toBeLessThanOrEqual(1);
  // 발표 기본: 배그 · 4K → 55fps. 첫 진입부터 4K 선택이 활성화돼야 한다.
  await expect(fps.getByTestId('fps-res-4K')).toHaveAttribute('aria-pressed', 'true');
  await expect(fps.getByTestId('fps-avg')).toHaveText('55 FPS');

  // 사용자가 QHD로 전환하면 해당 근거로 다시 조회한다.
  await fps.getByTestId('fps-res-QHD').click();
  await expect(fps.getByTestId('fps-res-QHD')).toHaveAttribute('aria-pressed', 'true');
  await expect(fps.getByTestId('fps-avg')).toHaveText('130 FPS');

  // 게임 발로란트 전환(컴팩트 칩 버튼) → 240fps.
  await fps.getByTestId('fps-game-valorant').click();
  await expect(fps.getByTestId('fps-avg')).toHaveText('240 FPS');
});

test('switches the game with compact chips next to the composite gauge', async ({ page }) => {
  await loginAsUser(page);
  const draft = {
    ...emptyDraft,
    items: [
      draftItem('part-perf-cpu', 'CPU', '라이젠 9600X', 300000),
      draftItem('part-perf-gpu', 'GPU', 'RTX 5060', 500000)
    ],
    totalPrice: 800000,
    itemCount: 2
  };
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(draft) });
  });
  await page.route('**/api/build-graphs/resolve', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...buildGraphResponse(), compositeScore: compositeScoreFixture() })
    });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });
  // 게임별로 다른 FPS를 돌려준다 — 로스트아크만 자료 없음(선택 시 fps-empty 검증용).
  await page.route('**/api/tools/performance/check', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    const game = String(body?.context?.game ?? '');
    const resolution = String(body?.context?.resolution ?? '');
    const gameFpsEvidence = game.includes('lost')
      ? []
      : [{
          gameTitle: game,
          gameKey: game,
          resolution: resolution === '4k' ? '4K' : resolution === 'fhd' ? 'FHD' : 'QHD',
          graphicsPreset: 'PC_BUILDS_MEDIUM',
          avgFps: game.includes('valorant') ? 240 : game.includes('cyberpunk') ? 48 : 130,
          onePercentLowFps: 90,
          sourceName: 'PC-Builds FPS calculator',
          confidence: 'MEDIUM',
          match: { evidenceExactness: 'GPU_CLASS_REFERENCE', gameMatched: true, resolutionMatched: true }
        }];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tool: 'performance', status: 'PASS', confidence: 'HIGH', summary: '', details: { gameFpsEvidence } })
    });
  });

  await page.goto('/self-quote');
  const fps = page.getByTestId('quote-fps-section');

  // 종합점수 게이지 + 게임 선택 컴팩트 칩 5개가 같은 핵심 지표에 남는다.
  await expect(page.getByTestId('quote-composite-score-gauge')).toBeVisible();
  await expect(fps.locator('[data-testid^="fps-game-"]')).toHaveCount(5);
  await expect(fps.getByTestId('fps-game-pubg')).toHaveAttribute('aria-pressed', 'true');
  // '다른 게임 한눈에' 리스트는 제거됐다.
  await expect(fps.getByTestId('fps-game-overview')).toHaveCount(0);
  await expect(fps.getByTestId('fps-game-row-valorant')).toHaveCount(0);

  // 칩 클릭 = 그 게임 선택 → 게이지가 그 게임 기준으로 갱신된다.
  await fps.getByTestId('fps-game-valorant').click();
  await expect(fps.getByTestId('fps-avg')).toHaveText('240 FPS');
  await expect(fps.getByTestId('fps-game-valorant')).toHaveAttribute('aria-pressed', 'true');
  await expect(fps.getByTestId('fps-game-pubg')).toHaveAttribute('aria-pressed', 'false');

  // 자료 없는 게임(로스트아크)을 고르면 숨기지 않고 '자료 없음' 안내를 보여준다.
  await fps.getByTestId('fps-game-lost-ark').click();
  await expect(fps).toContainText('참고 자료 없음');

  // 게임을 바꿔도 발표 기본 해상도 4K 선택은 유지된다.
  await expect(fps.getByTestId('fps-res-4K')).toHaveAttribute('aria-pressed', 'true');
});

test('picks a replacement candidate in the performance panel, compares, and applies the replacement', async ({ page }) => {
  await loginAsUser(page);
  const baseDraft = {
    ...emptyDraft,
    items: [
      draftItem('part-perf-cpu', 'CPU', '라이젠 9600X', 300000),
      draftItem('part-perf-gpu', 'GPU', 'RTX 5060', 500000)
    ],
    totalPrice: 800000,
    itemCount: 2
  };
  const replacedDraft = {
    ...emptyDraft,
    id: 'draft-slot-replaced',
    items: [
      draftItem('cand-cpu-1', 'CPU', '인텔 245K', 350000),
      draftItem('part-perf-gpu', 'GPU', 'RTX 5060', 500000)
    ],
    totalPrice: 850000,
    itemCount: 2
  };
  let currentDraft = baseDraft;
  const replaceRequests: Array<{ url: string; body: Record<string, unknown> }> = [];
  // 같은 prefix가 PUT에도 매칭되므로 메서드·경로로 분기한다 — 교체는 apply-ai-build 원자 적용이다.
  await page.route('**/api/quote-drafts/current**', async (route) => {
    const request = route.request();
    if (request.method() === 'PUT' && request.url().includes('/apply-ai-build')) {
      replaceRequests.push({ url: request.url(), body: JSON.parse(request.postData() ?? '{}') });
      currentDraft = replacedDraft;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(replacedDraft) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(currentDraft) });
  });
  await page.route('**/api/build-graphs/resolve', async (route) => {
    const requestBody = JSON.parse(route.request().postData() ?? '{}');
    const requestedItems = Array.isArray(requestBody?.items) ? requestBody.items : [];
    const hasReplacement = currentDraft === replacedDraft
      || requestedItems.some((item: { partId?: string }) => item.partId === 'cand-cpu-1');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...buildGraphResponse(), compositeScore: compositeScoreFixture(hasReplacement ? 782 : 734) })
    });
  });
  // 선택기·아코디언이 공유하는 GET /api/parts — 카테고리별 후보를 돌려준다(FAIL 후보는 사유 포함).
  await page.route('**/api/parts**', async (route) => {
    const url = new URL(route.request().url());
    const category = url.searchParams.get('category');
    const items = category === 'CPU'
      ? [
          candidatePart('cand-cpu-1', 'CPU', '인텔 245K', { price: 350000 }),
          candidatePart('cand-cpu-fail', 'CPU', '구형 소켓 CPU', {
            price: 200000,
            compatibility: { status: 'FAIL', statusLabel: '장착 불가', summary: '메인보드 소켓과 맞지 않습니다.' }
          })
        ]
      : category === 'GPU'
        ? [candidatePart('cand-gpu-1', 'GPU', 'RTX 5070', { price: 900000 })]
        : [];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items, page: 0, size: 20, total: items.length })
    });
  });
  // 같은 FPS 엔드포인트를 2회 호출한다 — 기존 조합과 후보 치환 조합을 partIds로 구분해 응답한다.
  await page.route('**/api/tools/performance/check', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    const partIds: string[] = Array.isArray(body?.partIds) ? body.partIds : [];
    const isChangedBuild = partIds.includes('cand-cpu-1');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tool: 'performance', status: 'PASS', confidence: 'HIGH', summary: '',
        details: {
          gameFpsEvidence: [{
            gameTitle: '배틀그라운드',
            gameKey: 'pubg',
            resolution: 'QHD',
            graphicsPreset: 'PC_BUILDS_MEDIUM',
            avgFps: isChangedBuild ? 281 : 243,
            onePercentLowFps: isChangedBuild ? 220 : 200,
            sourceName: 'PC-Builds FPS calculator',
            confidence: 'MEDIUM',
            match: { evidenceExactness: 'GPU_CLASS_REFERENCE', gameMatched: true, resolutionMatched: true }
          }]
        }
      })
    });
  });

  await page.goto('/self-quote?category=CPU');

  // 체크리스트 후보는 관계도 본문 오버레이로 이동했고, 상단 성능 비교는 카드 헤더 선택기에서 독립적으로 동작한다.
  await expect(page.getByTestId('slot-candidate-panel')).toContainText('인텔 245K');

  // 카드 헤더 줄의 한 줄 콤보: [CPU|GPU 토글] + [교체 후보 선택 ▾] — 클릭하면 팝오버로 호환 후보 리스트.
  const panel = page.getByTestId('quote-performance-panel');
  const workspace = panel.getByTestId('quote-fps-section');
  await expect(workspace).toBeVisible();
  await expect(workspace).toContainText('게임 예상 성능');
  await expect(panel.getByTestId('perf-candidate-category-GPU')).toHaveAttribute('aria-pressed', 'true');
  await panel.getByTestId('perf-candidate-select').click();
  const popover = panel.getByTestId('perf-candidate-popover');
  await expect(popover).toBeVisible();
  await expect(popover.getByTestId('perf-candidate-option-0')).toContainText('RTX 5070');
  // 팝오버가 열린 채 카테고리를 토글하면 닫히지 않고 그 카테고리 후보로 바뀐다 + 지금 담긴 부품 표시.
  await panel.getByTestId('perf-candidate-category-CPU').click();
  await expect(popover.getByTestId('perf-candidate-current')).toContainText('라이젠 9600X');

  // PASS 후보는 이름+가격만 표시하고, FAIL 후보는 숨기지 않고 회색 비활성 + 선택 불가 사유.
  const firstOption = popover.getByTestId('perf-candidate-option-0');
  await expect(firstOption).toContainText('인텔 245K');
  await expect(firstOption).toContainText('350,000원');
  await expect(firstOption).not.toContainText('호환 가능');
  const failOption = popover.getByTestId('perf-candidate-option-1');
  await expect(failOption).toBeDisabled();
  await expect(failOption).toContainText('장착 불가');
  await expect(failOption).toContainText('메인보드 소켓과 맞지 않습니다.');

  // 후보 선택 → 팝오버가 닫히고 즉시 비교 모드(기존 조합 vs 변경 조합).
  await firstOption.click();
  await expect(panel.getByTestId('perf-candidate-popover')).toHaveCount(0);
  await expect(panel.getByTestId('perf-candidate-select')).toContainText('인텔 245K');
  // "교체 비교 · A → B" 텍스트 배너는 제거됐다 — 후보명은 헤더 콤보가 보여줘 비교 중에도 배너가 없다.
  await expect(workspace.getByTestId('fps-compare-banner')).toHaveCount(0);
  // 게임 예상 성능이 비교 표시로 전환: 기존→변경 숫자 + 델타와 두 상태 막대를 유지한다.
  await expect(workspace.getByTestId('fps-avg')).toHaveText('243');
  await expect(workspace.getByTestId('fps-compare-avg')).toHaveText('281');
  await expect(workspace.getByTestId('fps-compare-delta')).toHaveText('+16%');
  await expect(workspace).toContainText('기존');
  await expect(workspace).toContainText('변경');
  // 압축 비교 영역의 0 기준 분기형 막대 + 추가 비용 강조 + 예상 FPS 화살표.
  await expect(panel.getByTestId('cost-effect-block')).toBeVisible();
  await expect(panel.getByTestId('effect-bar-price')).toHaveAttribute('data-effect-direction', 'up');
  await expect(panel.getByTestId('effect-bar-price')).toContainText('+17%');
  await expect(panel.getByTestId('effect-bar-perf')).toHaveAttribute('data-effect-direction', 'up');
  await expect(panel.getByTestId('effect-bar-perf')).toContainText('+16%');
  await expect(panel.getByTestId('cost-effect-extra')).toContainText('추가 비용 +50,000원');
  await expect(panel.getByTestId('cost-effect-fps')).toContainText('예상 FPS 200~243 → 220~281');

  // 보면서 담기: 압축 성능 영역의 '교체해 담기' → 원자 적용(apply-ai-build) 1회 + 비교 해제 + 점수 갱신.
  await expect(panel.getByTestId('perf-apply-replace')).toBeVisible();
  await panel.getByTestId('perf-apply-replace').click();
  await expect(workspace.getByTestId('fps-compare-delta')).toHaveCount(0);
  await expect(panel.getByTestId('compare-clear')).toHaveCount(0);
  expect(replaceRequests).toHaveLength(1);
  expect(replaceRequests[0].url).toContain('/api/quote-drafts/current/apply-ai-build');
  const replacedItems = (replaceRequests[0].body.items ?? []) as Array<{ partId: string; quantity: number }>;
  expect(replacedItems.map((item) => item.partId)).toEqual(expect.arrayContaining(['cand-cpu-1', 'part-perf-gpu']));
  expect(replacedItems.map((item) => item.partId)).not.toContain('part-perf-cpu');
  expect(replacedItems.find((item) => item.partId === 'cand-cpu-1')).toMatchObject({ quantity: 1 });
  await expect(page.getByTestId('checklist-CPU')).toContainText('인텔 245K');
  await expect(panel.getByTestId('fps-avg')).toHaveText('281 FPS');
  await expect(panel.getByTestId('quote-composite-score')).toContainText('782');
  await expect(panel.getByTestId('quote-composite-score-delta')).toContainText('+48');

  // AI 변경 미리보기 연동(창 이벤트)은 그대로 유지된다 — 같은 비교 모드가 켜지고 카테고리도 따라간다.
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('buildgraph.perfCompare.request', {
      detail: { category: 'CPU', partId: 'part-perf-cpu', name: '라이젠 9600X', price: 300000 }
    }));
  });
  // 배너 없이도 비교가 켜졌는지는 헤더 콤보의 후보명과 비교 델타로 확인한다.
  await expect(panel.getByTestId('perf-candidate-select')).toContainText('라이젠 9600X');
  await expect(workspace.getByTestId('fps-compare-avg')).toHaveText('243');
  await expect(panel.getByTestId('perf-candidate-category-CPU')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('performance-comparison-spotlight')).toHaveCount(0);
});

test('overlays a composite ghost arc from the swapped-combo resolve with diverging effect bars', async ({ page }) => {
  await loginAsUser(page);
  const draft = {
    ...emptyDraft,
    items: [
      draftItem('part-perf-cpu', 'CPU', '라이젠 9600X', 300000),
      draftItem('part-perf-gpu', 'GPU', 'RTX 5060', 500000)
    ],
    totalPrice: 800000,
    itemCount: 2
  };
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(draft) });
  });
  // 화면 그래프(QUOTE_DRAFT_CURRENT)는 734, 저사양 후보 고스트(AI_BUILD + 치환 items)는 722로 응답을 가른다.
  const ghostResolveRequests: Array<Record<string, unknown>> = [];
  await page.route('**/api/build-graphs/resolve', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    const isGhost = body?.source === 'AI_BUILD';
    if (isGhost) ghostResolveRequests.push(body);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...buildGraphResponse(),
        compositeScore: compositeScoreFixture(isGhost ? 722 : 734, isGhost ? '절약형' : '기본형')
      })
    });
  });
  await page.route('**/api/parts**', async (route) => {
    const url = new URL(route.request().url());
    const items = url.searchParams.get('category') === 'GPU'
      ? [candidatePart('cand-gpu-cheap', 'GPU', 'RTX 5050', { price: 420000 })]
      : [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items, page: 0, size: 20, total: items.length }) });
  });
  // 저렴한 후보로 바꾸면 FPS는 내려간다 — 가격·성능 모두 음수(왼쪽 분기) 확인용.
  await page.route('**/api/tools/performance/check', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    const partIds: string[] = Array.isArray(body?.partIds) ? body.partIds : [];
    const isChangedBuild = partIds.includes('cand-gpu-cheap');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tool: 'performance', status: 'PASS', confidence: 'HIGH', summary: '',
        details: {
          gameFpsEvidence: [{
            gameTitle: '배틀그라운드',
            gameKey: 'pubg',
            resolution: 'QHD',
            graphicsPreset: 'PC_BUILDS_MEDIUM',
            avgFps: isChangedBuild ? 117 : 130,
            onePercentLowFps: isChangedBuild ? 88 : 96,
            sourceName: 'PC-Builds FPS calculator',
            confidence: 'MEDIUM',
            match: { evidenceExactness: 'GPU_CLASS_REFERENCE', gameMatched: true, resolutionMatched: true }
          }]
        }
      })
    });
  });

  await page.goto('/self-quote');

  // 비교 전: 공용 단일 게이지만 보이고 고스트 아크는 없다.
  const panel = page.getByTestId('quote-performance-panel');
  await expect(panel.getByTestId('quote-composite-score-gauge')).toBeVisible();
  await expect(panel.getByTestId('quote-composite-score')).toContainText('734');
  await expect(panel.getByTestId('quote-composite-ghost-gauge')).toHaveCount(0);

  // 후보 선택 → 종합점수 자리가 고스트 아크로 전환: 기존 회색/변경 파랑 + 중앙 "734 → 722" + 델타 배지.
  await panel.getByTestId('perf-candidate-select').click();
  await panel.getByTestId('perf-candidate-popover').getByTestId('perf-candidate-option-0').click();
  await expect(panel.getByTestId('quote-composite-ghost-gauge')).toBeVisible();
  await expect(panel.getByTestId('quote-composite-ghost-base')).toHaveText('734');
  await expect(panel.getByTestId('quote-composite-compare-score')).toHaveText('722');
  await expect(panel.getByTestId('quote-composite-compare-delta')).toHaveText('-12점');
  // 델타 배지는 반원 꼭대기 선 아래의 빈 공간에 있어야 하며, 두 아크의 중앙선을 가리지 않는다.
  await expect.poll(async () => {
    const gauge = panel.getByTestId('quote-composite-ghost-gauge');
    const deltaBox = await panel.getByTestId('quote-composite-compare-delta').boundingBox();
    const peakYs = await Promise.all([0, 2].map((pathIndex) => (
      gauge.locator('svg path').nth(pathIndex).evaluate((element) => {
        const path = element as SVGPathElement;
        const point = path.getPointAtLength(path.getTotalLength() / 2);
        const matrix = path.getScreenCTM();
        return matrix ? new DOMPoint(point.x, point.y).matrixTransform(matrix).y : Number.POSITIVE_INFINITY;
      })
    )));
    if (!deltaBox) return Number.NEGATIVE_INFINITY;
    return Math.round(deltaBox.y - Math.max(...peakYs));
  }).toBeGreaterThanOrEqual(8);
  await expect.poll(async () => {
    const gauge = panel.getByTestId('quote-composite-ghost-gauge');
    const [arcBox, scoreRowBox] = await Promise.all([
      gauge.locator('svg').boundingBox(),
      panel.getByTestId('quote-composite-ghost-base').locator('..').boundingBox()
    ]);
    if (!arcBox || !scoreRowBox) return Number.NEGATIVE_INFINITY;
    return Math.round(scoreRowBox.y - (arcBox.y + arcBox.height));
  }).toBeGreaterThanOrEqual(0);

  // 고스트 resolve는 기존 계약 그대로: source=AI_BUILD + 현재 드래프트에서 GPU만 후보로 치환한 items.
  expect(ghostResolveRequests.length).toBeGreaterThanOrEqual(1);
  expect(ghostResolveRequests[0].items).toEqual(expect.arrayContaining([
    expect.objectContaining({ partId: 'part-perf-cpu', category: 'CPU' }),
    expect.objectContaining({ partId: 'cand-gpu-cheap', category: 'GPU' })
  ]));

  // 분기형 막대: 가격 절감(-16%)과 성능 하락(-10%)이 중앙 0 기준선 왼쪽으로 자라고, 라벨은 정확값을 유지한다.
  await expect(panel.getByTestId('cost-effect-block')).toBeVisible();
  await expect(panel.getByTestId('effect-bar-price')).toHaveAttribute('data-effect-direction', 'down');
  await expect(panel.getByTestId('effect-bar-price')).toContainText('-16%');
  await expect(panel.getByTestId('effect-bar-perf')).toHaveAttribute('data-effect-direction', 'down');
  await expect(panel.getByTestId('effect-bar-perf')).toContainText('-10%');
  // 추가 비용 강조 줄: 절감이면 에메랄드 큰 숫자 + (절감) 라벨.
  await expect(panel.getByTestId('cost-effect-extra')).toContainText('추가 비용 -80,000원 (절감)');

  // 비교 해제 → 고스트 아크가 내려가고 공용 단일 게이지로 복귀한다(비교 강제 금지).
  await panel.getByTestId('compare-clear').click();
  await expect(panel.getByTestId('quote-composite-ghost-gauge')).toHaveCount(0);
  await expect(panel.getByTestId('quote-composite-score')).toContainText('734');
});

// AI 연계 변경안(GPU+파워)의 고스트 비교는 제안된 조합 그대로 계산해야 한다 —
// 파워를 빼고 "기존 파워+새 GPU"로 계산하면 전력 FAIL로 0점 고스트가 그려지는 버그가 있었다.
test('composite ghost for an AI linked GPU+PSU preview swaps both parts instead of scoring a zero mismatch combo', async ({ page }) => {
  await loginAsUser(page);
  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.authUser', JSON.stringify({ id: 'user-linked-ghost', email: 'user@example.com', name: 'Demo User', role: 'USER' }));
  });
  const draft = {
    ...emptyDraft,
    items: [
      draftItem('part-perf-cpu', 'CPU', '라이젠 9600X', 300000),
      draftItem('part-perf-gpu', 'GPU', 'RTX 5060', 500000),
      draftItem('part-psu-600', 'PSU', '600W 파워', 70000)
    ],
    totalPrice: 870000,
    itemCount: 3
  };
  const putRequests: string[] = [];
  const applyRequests: Array<{ items?: Array<{ partId: string; category: string; quantity: number }> }> = [];
  await page.route('**/api/quote-drafts/current**', async (route) => {
    const request = route.request();
    if (request.method() === 'PUT') {
      const pathname = new URL(request.url()).pathname;
      if (pathname.endsWith('/apply-ai-build')) {
        applyRequests.push(JSON.parse(request.postData() ?? '{}'));
      }
      const match = pathname.match(/\/items\/([^/]+)$/);
      if (match) putRequests.push(match[1]);
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(draft) });
  });
  const ghostResolveRequests: Array<Record<string, unknown>> = [];
  await page.route('**/api/build-graphs/resolve', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    const isGhost = body?.source === 'AI_BUILD';
    if (isGhost) ghostResolveRequests.push(body);
    const items = (body?.items ?? []) as Array<{ partId?: string }>;
    const hasNewGpu = items.some((item) => item.partId === 'cand-gpu-5080');
    const hasNewPsu = items.some((item) => item.partId === 'cand-psu-850');
    // 버그 시그니처: 새 GPU + 기존 파워 조합이 오면 전력 FAIL 0점을 돌려준다.
    const score = !isGhost ? 734 : hasNewGpu && hasNewPsu ? 745 : 0;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...buildGraphResponse(),
        compositeScore: compositeScoreFixture(score, isGhost ? '연계형' : '기본형')
      })
    });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });
  await page.route('**/api/tools/performance/check', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    const partIds: string[] = Array.isArray(body?.partIds) ? body.partIds : [];
    const isChangedBuild = partIds.includes('cand-gpu-5080');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tool: 'performance', status: 'PASS', confidence: 'HIGH', summary: '',
        details: {
          gameFpsEvidence: [{
            gameTitle: '배틀그라운드', gameKey: 'pubg', resolution: '4K', graphicsPreset: 'PC_BUILDS_MEDIUM',
            avgFps: isChangedBuild ? 127 : 74, onePercentLowFps: isChangedBuild ? 98 : 55,
            sourceName: 'PC-Builds FPS calculator', confidence: 'MEDIUM',
            match: { evidenceExactness: 'GPU_CLASS_REFERENCE', gameMatched: true, resolutionMatched: true }
          }]
        }
      })
    });
  });
  await page.route('**/api/ai/build-chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        answerType: 'PART',
        message: '현재 파워만으로는 전력 검증을 통과하지 못해, 필요한 파워까지 함께 바꾸는 변경안을 준비했습니다.',
        warnings: [],
        quickReplies: [],
        builds: [{
          id: 'ai-linked-gpu-psu',
          tier: 'draft-edit',
          label: '변경 미리보기',
          title: '변경 적용 미리보기',
          summary: '목표 FPS 근거와 전력 검증을 통과한 GPU+파워 연계 변경안입니다.',
          totalPrice: 2500000,
          badges: ['DRAFT_EDIT_PREVIEW'],
          budgetWon: 2500000,
          budgetLabel: '250만원',
          tierLabel: '변경 미리보기',
          appliedPartCategories: ['GPU', 'PSU'],
          items: [
            { partId: 'part-perf-cpu', category: 'CPU', name: '라이젠 9600X', manufacturer: '테스트제조사', quantity: 1, price: 300000, note: '' },
            { partId: 'cand-gpu-5080', category: 'GPU', name: 'RTX 5080', manufacturer: '테스트제조사', quantity: 1, price: 2078000, note: '' },
            { partId: 'cand-psu-850', category: 'PSU', name: '850W 파워', manufacturer: '테스트제조사', quantity: 1, price: 122000, note: '' }
          ],
          evidenceIds: []
        }],
        evidenceIds: []
      })
    });
  });

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto('/self-quote');
  const panel = page.getByTestId('quote-performance-panel');
  await expect(panel.getByTestId('quote-composite-score')).toContainText('734');

  await page.getByRole('textbox', { name: 'AI 챗봇에게 PC 사양 질문' }).fill('배그에서 4K 120FPS 이상 나오는 GPU로 변경해줘');
  await page.getByRole('button', { name: '질문 보내기' }).click();
  await expect(page.getByTestId('ai-chat-messages')).toContainText('파워까지 함께 바꾸는', { timeout: 10000 });
  expect(pageErrors, pageErrors.join('\n')).toHaveLength(0);

  // 미리보기 카드가 그려지면 성능 패널 비교가 켜지고, 고스트는 연계 파워까지 치환한 조합으로 계산돼 0점이 아니다.
  await expect(panel.getByTestId('quote-composite-ghost-gauge')).toBeVisible();
  await expect(panel.getByTestId('quote-composite-ghost-base')).toHaveText('734');
  await expect(panel.getByTestId('quote-composite-compare-score')).toHaveText('745');
  const spotlight = page.getByTestId('performance-comparison-spotlight');
  await expect(spotlight).toBeVisible();
  await expect(spotlight).toContainText('성능 개선 예상');
  await expect(spotlight.getByTestId('spotlight-composite-ghost-base')).toHaveText('734');
  await expect(spotlight.getByTestId('spotlight-composite-compare-score')).toHaveText('745');
  await expect(spotlight.getByTestId('spotlight-price-comparison')).toContainText('870,000원');
  await expect(spotlight.getByTestId('spotlight-price-comparison')).toContainText('2,500,000원');
  await expect(spotlight.getByTestId('spotlight-fps-comparison')).toContainText('74 FPS');
  await expect(spotlight.getByTestId('spotlight-fps-comparison')).toContainText('127 FPS');
  // 중앙 카드는 X 버튼으로만 닫힌다(시연 중 오클릭 방지) — 카드·배경 클릭은 무시된다.
  await spotlight.click({ position: { x: 24, y: 24 } });
  await expect(spotlight).toBeVisible();
  await spotlight.getByRole('button', { name: '성능 비교 닫기' }).click();
  await expect(spotlight).toHaveCount(0);
  await expect(panel.getByTestId('perf-apply-replace')).toBeVisible();
  expect(ghostResolveRequests.length).toBeGreaterThanOrEqual(1);
  const lastGhost = ghostResolveRequests[ghostResolveRequests.length - 1];
  expect(lastGhost.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ partId: 'cand-gpu-5080', category: 'GPU' }),
    expect.objectContaining({ partId: 'cand-psu-850', category: 'PSU' })
  ]));
  // 버그 시그니처 조합(새 GPU+기존 파워)으로 나간 고스트 요청이 없어야 한다.
  const mismatchGhost = ghostResolveRequests.find((request) => {
    const items = (request.items ?? []) as Array<{ partId?: string }>;
    return items.some((item) => item.partId === 'cand-gpu-5080') && items.some((item) => item.partId === 'part-psu-600');
  });
  expect(mismatchGhost).toBeUndefined();

  // 회귀: 같은 시연을 반복해도 비교가 다시 켜져야 한다 — 서버가 같은 build.id를 돌려줘도
  // 새 응답 메시지면 재발행한다(build.id 단독 중복 억제가 두 번째 시연부터 비교를 영구 차단하던 버그).
  await panel.getByTestId('compare-clear').click();
  await expect(panel.getByTestId('quote-composite-ghost-gauge')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'AI 챗봇에게 PC 사양 질문' }).fill('배그에서 4K 120FPS 이상 나오는 GPU로 변경해줘');
  await page.getByRole('button', { name: '질문 보내기' }).click();
  await expect(page.getByTestId('ai-chat-messages').getByText('파워까지 함께 바꾸는')).toHaveCount(2, { timeout: 10000 });
  await expect(panel.getByTestId('quote-composite-ghost-gauge')).toBeVisible();
  await expect(panel.getByTestId('quote-composite-compare-score')).toHaveText('745');
  // 같은 build.id여도 새 AI 응답은 새 requestKey라 중앙 비교를 다시 보여준다.
  await expect(spotlight).toBeVisible();
  // Esc로도 닫히지 않는다 — 발표 중 키 실수 방지. X 버튼만 닫는다.
  await page.keyboard.press('Escape');
  await expect(spotlight).toBeVisible();
  await spotlight.getByRole('button', { name: '성능 비교 닫기' }).click();
  await expect(spotlight).toHaveCount(0);

  // 회귀: '이 제품으로 교체해 담기'는 고스트 점수를 만든 조합 그대로, 한 번의 원자 적용으로 담는다 —
  // 순차 PUT이면 뒤 요청이 실패할 때 "새 파워+옛 GPU" 반쪽 상태가 남는다(서버 트랜잭션 1회로 통일).
  putRequests.length = 0;
  applyRequests.length = 0;
  await panel.getByTestId('perf-apply-replace').click();
  await expect.poll(() => applyRequests.length, { timeout: 10000 }).toBe(1);
  const appliedPartIds = (applyRequests[0].items ?? []).map((item) => item.partId);
  expect(appliedPartIds).toEqual(expect.arrayContaining(['cand-gpu-5080', 'cand-psu-850', 'part-perf-cpu']));
  // 교체 대상이던 기존 GPU·파워는 새 조합에 실리지 않는다.
  expect(appliedPartIds).not.toContain('part-perf-gpu');
  expect(appliedPartIds).not.toContain('part-psu-600');
  // 반쪽 상태를 만들 수 있는 개별 PUT은 더 이상 나가지 않는다.
  expect(putRequests).toHaveLength(0);
  await expect(panel.getByTestId('perf-apply-error')).toHaveCount(0);
});

test('shows an AI performance spotlight once per request and preserves the top comparison after every dismiss path', async ({ page }) => {
  await loginAsUser(page);
  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.authUser', JSON.stringify({ id: 'user-spotlight', email: 'spotlight@example.com', name: 'Spotlight User', role: 'USER' }));
  });
  const draft = {
    ...emptyDraft,
    items: [
      draftItem('part-perf-cpu', 'CPU', '라이젠 9600X', 300000),
      draftItem('part-perf-gpu', 'GPU', 'RTX 5060', 500000)
    ],
    totalPrice: 800000,
    itemCount: 2
  };
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(draft) });
  });
  await page.route('**/api/build-graphs/resolve', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    const isGhost = body?.source === 'AI_BUILD';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...buildGraphResponse(), compositeScore: compositeScoreFixture(isGhost ? 782 : 734) })
    });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });
  await page.route('**/api/tools/performance/check', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    const partIds: string[] = Array.isArray(body?.partIds) ? body.partIds : [];
    const changed = partIds.includes('cand-cpu-1');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tool: 'performance', status: 'PASS', confidence: 'HIGH', summary: '',
        details: {
          gameFpsEvidence: [{
            gameTitle: '배틀그라운드', gameKey: 'pubg', resolution: '4K', graphicsPreset: 'PC_BUILDS_MEDIUM',
            avgFps: changed ? 102 : 80, onePercentLowFps: changed ? 78 : 60,
            sourceName: 'PC-Builds FPS calculator', confidence: 'MEDIUM',
            match: { evidenceExactness: 'GPU_CLASS_REFERENCE', gameMatched: true, resolutionMatched: true }
          }]
        }
      })
    });
  });

  await page.goto('/self-quote');
  const panel = page.getByTestId('quote-performance-panel');
  const spotlight = page.getByTestId('performance-comparison-spotlight');
  const dispatchComparison = (requestKey: string, origin: 'AI' | 'MANUAL' = 'AI') => page.evaluate(({ requestKey, origin }) => {
    window.dispatchEvent(new CustomEvent('buildgraph.perfCompare.request', {
      detail: {
        category: 'CPU', partId: 'cand-cpu-1', name: '인텔 245K', price: 350000,
        origin, requestKey, totalPriceComparison: { before: 800000, after: 850000 }
      }
    }));
  }, { requestKey, origin });

  await dispatchComparison('spotlight-close-button');
  await expect(spotlight).toBeVisible();
  await expect(spotlight.getByTestId('spotlight-composite-ghost-base')).toHaveText('734');
  await expect(spotlight.getByTestId('spotlight-composite-compare-score')).toHaveText('782');
  await expect(spotlight.getByTestId('spotlight-price-comparison')).toContainText('+50,000원');
  await expect(spotlight.getByTestId('spotlight-fps-comparison')).toContainText('+28%');
  await spotlight.getByRole('button', { name: '성능 비교 닫기' }).click();
  await expect(spotlight).toHaveCount(0);
  await expect(panel.getByTestId('perf-apply-replace')).toBeVisible();

  // 닫힘은 X 버튼 하나뿐이다(시연 중 오클릭·키 실수 방지) — 배경 클릭·Esc·카드 클릭은 전부 무시된다.
  await dispatchComparison('spotlight-backdrop');
  await expect(spotlight).toBeVisible();
  await page.getByTestId('performance-comparison-spotlight-backdrop').click({ position: { x: 4, y: 4 } });
  await expect(spotlight).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(spotlight).toBeVisible();
  await spotlight.click({ position: { x: 20, y: 20 } });
  await expect(spotlight).toBeVisible();
  await spotlight.getByRole('button', { name: '성능 비교 닫기' }).click();
  await expect(spotlight).toHaveCount(0);

  await page.setViewportSize({ width: 320, height: 720 });
  await dispatchComparison('spotlight-card');
  await expect(spotlight).toBeVisible();
  await expect.poll(async () => {
    const box = await spotlight.boundingBox();
    return box ? Math.ceil(box.x + box.width) : Number.POSITIVE_INFINITY;
  }).toBeLessThanOrEqual(320);
  await spotlight.getByRole('button', { name: '성능 비교 닫기' }).click();
  await expect(spotlight).toHaveCount(0);

  // 이미 소비한 requestKey는 다른 요청을 거친 뒤 다시 와도 열리지 않는다.
  await dispatchComparison('spotlight-close-button');
  await expect(spotlight).toHaveCount(0);
  // 수동 후보 비교는 requestKey가 있어도 중앙 강조 대상이 아니다.
  await dispatchComparison('manual-comparison', 'MANUAL');
  await expect(spotlight).toHaveCount(0);
  await expect(panel.getByTestId('quote-composite-ghost-gauge')).toBeVisible();
});

test('opens on score readiness, updates delayed FPS in place, and never labels lower or zero scores as improvements', async ({ page }) => {
  await loginAsUser(page);
  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.authUser', JSON.stringify({ id: 'user-spotlight-edge', email: 'spotlight-edge@example.com', role: 'USER' }));
  });
  const draft = {
    ...emptyDraft,
    items: [
      draftItem('part-perf-cpu', 'CPU', '라이젠 9600X', 300000),
      draftItem('part-perf-gpu', 'GPU', 'RTX 5060', 500000)
    ],
    totalPrice: 800000,
    itemCount: 2
  };
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(draft) });
  });
  await page.route('**/api/build-graphs/resolve', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    const items = (body?.items ?? []) as Array<{ partId?: string }>;
    const score = body?.source !== 'AI_BUILD'
      ? 734
      : items.some((item) => item.partId === 'cand-gpu-fail')
        ? 0
        : 710;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...buildGraphResponse(), compositeScore: compositeScoreFixture(score) })
    });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });
  await page.route('**/api/tools/performance/check', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    const partIds: string[] = Array.isArray(body?.partIds) ? body.partIds : [];
    const isChanged = partIds.some((partId) => partId.startsWith('cand-gpu-'));
    if (isChanged) await new Promise((resolve) => setTimeout(resolve, 550));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tool: 'performance', status: 'PASS', confidence: 'HIGH', summary: '',
        details: {
          gameFpsEvidence: [{
            gameTitle: '배틀그라운드', gameKey: 'pubg', resolution: '4K', graphicsPreset: 'PC_BUILDS_MEDIUM',
            avgFps: isChanged ? 92 : 100, onePercentLowFps: isChanged ? 70 : 76,
            sourceName: isChanged ? '다른 측정 출처' : 'PC-Builds FPS calculator', confidence: 'MEDIUM',
            match: { evidenceExactness: 'GPU_CLASS_REFERENCE', gameMatched: true, resolutionMatched: true }
          }]
        }
      })
    });
  });

  await page.goto('/self-quote');
  const spotlight = page.getByTestId('performance-comparison-spotlight');
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('buildgraph.perfCompare.request', {
      detail: {
        category: 'GPU', partId: 'cand-gpu-down', name: '낮은 성능 GPU', price: 420000,
        origin: 'AI', requestKey: 'spotlight-delayed-down', totalPriceComparison: { before: 800000, after: 720000 }
      }
    }));
  });
  await expect(spotlight).toBeVisible();
  await expect(spotlight).toContainText('변경안 성능 비교');
  await expect(spotlight).not.toContainText('성능 개선 예상');
  await expect(spotlight.getByTestId('spotlight-fps-loading')).toBeVisible();
  await expect(spotlight.getByTestId('spotlight-fps-comparison')).toContainText('100 FPS');
  await expect(spotlight.getByTestId('spotlight-fps-comparison')).toContainText('92 FPS');
  await expect(spotlight.getByTestId('spotlight-fps-comparison')).not.toContainText('%');
  await expect(spotlight.getByTestId('spotlight-fps-mismatch')).toBeVisible();
  await spotlight.getByRole('button', { name: '성능 비교 닫기' }).click();

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('buildgraph.perfCompare.request', {
      detail: {
        category: 'GPU', partId: 'cand-gpu-fail', name: '호환 불가 GPU', price: 600000,
        origin: 'AI', requestKey: 'spotlight-zero-score', totalPriceComparison: { before: 800000, after: 900000 }
      }
    }));
  });
  await expect(spotlight).toBeVisible();
  await expect(spotlight).toContainText('변경안 확인 필요');
  await expect(spotlight.getByTestId('spotlight-composite-compare-score')).toHaveText('0');
  await expect(spotlight.getByTestId('spotlight-score-warning')).toContainText('호환성 또는 장착 문제');
  await expect(spotlight).not.toContainText('성능 개선 예상');
});

test('drives the candidate popover: open, dismiss without picking, pick WARN, and clear', async ({ page }) => {
  await loginAsUser(page);
  const draft = {
    ...emptyDraft,
    items: [
      draftItem('part-perf-cpu', 'CPU', '라이젠 9600X', 300000),
      draftItem('part-perf-gpu', 'GPU', 'RTX 5060', 500000)
    ],
    totalPrice: 800000,
    itemCount: 2
  };
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(draft) });
  });
  await page.route('**/api/build-graphs/resolve', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...buildGraphResponse(), compositeScore: compositeScoreFixture() })
    });
  });
  await page.route('**/api/parts**', async (route) => {
    const url = new URL(route.request().url());
    const items = url.searchParams.get('category') === 'GPU'
      ? [
          candidatePart('cand-gpu-1', 'GPU', 'RTX 5070', { price: 900000 }),
          candidatePart('cand-gpu-warn', 'GPU', '대형 3팬 GPU', {
            price: 850000,
            compatibility: { status: 'WARN', statusLabel: '간섭 주의', summary: '케이스 공간이 빠듯할 수 있습니다.' }
          })
        ]
      : [];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items, page: 0, size: 20, total: items.length })
    });
  });
  await page.route('**/api/tools/performance/check', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    const partIds: string[] = Array.isArray(body?.partIds) ? body.partIds : [];
    const isChangedBuild = partIds.includes('cand-gpu-warn');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tool: 'performance', status: 'PASS', confidence: 'HIGH', summary: '',
        details: {
          gameFpsEvidence: [{
            gameTitle: '배틀그라운드',
            gameKey: 'pubg',
            resolution: 'QHD',
            graphicsPreset: 'PC_BUILDS_MEDIUM',
            avgFps: isChangedBuild ? 152 : 130,
            onePercentLowFps: isChangedBuild ? 118 : 96,
            sourceName: 'PC-Builds FPS calculator',
            confidence: 'MEDIUM',
            match: { evidenceExactness: 'GPU_CLASS_REFERENCE', gameMatched: true, resolutionMatched: true }
          }]
        }
      })
    });
  });

  await page.goto('/self-quote');

  // 미선택 빈 상태: 향상 그래프 자리는 빈 막대 구조가 고정으로 보이고, 액션 줄은 없다.
  const panel = page.getByTestId('quote-performance-panel');
  const workspace = page.getByTestId('quote-fps-section');
  await expect(workspace).toBeVisible();
  await expect(page.getByTestId('cost-effect-empty')).toHaveCount(0);
  await expect(panel.getByTestId('compare-clear')).toHaveCount(0);

  // 헤더 콤보 열기 → Escape로 닫기: 선택 없이 닫혀도 빈 상태가 유지된다.
  await panel.getByTestId('perf-candidate-select').click();
  const popover = panel.getByTestId('perf-candidate-popover');
  await expect(popover).toBeVisible();
  await expect(popover.getByTestId('perf-candidate-current')).toContainText('RTX 5060');
  await page.keyboard.press('Escape');
  await expect(panel.getByTestId('perf-candidate-popover')).toHaveCount(0);
  await expect(panel.getByTestId('compare-clear')).toHaveCount(0);

  // 다시 열고 팝오버 바깥 클릭으로 닫기.
  await panel.getByTestId('perf-candidate-select').click();
  await expect(popover).toBeVisible();
  await page.getByTestId('quote-composite-score-gauge').click();
  await expect(panel.getByTestId('perf-candidate-popover')).toHaveCount(0);

  // WARN 후보는 '간섭 주의'를 단 채 선택 가능 — 고르면 팝오버가 닫히고 비교가 켜진다.
  await panel.getByTestId('perf-candidate-select').click();
  const warnOption = popover.getByTestId('perf-candidate-option-1');
  await expect(warnOption).toContainText('간섭 주의');
  await expect(warnOption).toBeEnabled();
  await warnOption.click();
  await expect(panel.getByTestId('perf-candidate-popover')).toHaveCount(0);
  // 배너 없이 헤더 콤보가 비교 중인 후보명을 보여준다.
  await expect(panel.getByTestId('perf-candidate-select')).toContainText('대형 3팬 GPU');
  await expect(page.getByTestId('fps-compare-avg')).toHaveText('152');

  // 비교 해제 → 다시 단일 성능 상태로 복귀하고 기존 값만 남는다.
  await panel.getByTestId('compare-clear').click();
  await expect(panel.getByTestId('compare-clear')).toHaveCount(0);
  await expect(page.getByTestId('fps-avg')).toHaveText('130 FPS');
});

test('suppresses the confirmed FPS delta when the two evidence rows come from different measurement conditions', async ({ page }) => {
  await loginAsUser(page);
  const draft = {
    ...emptyDraft,
    items: [
      draftItem('part-perf-cpu', 'CPU', '라이젠 9600X', 300000),
      draftItem('part-perf-gpu', 'GPU', 'RTX 5060', 500000)
    ],
    totalPrice: 800000,
    itemCount: 2
  };
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(draft) });
  });
  await page.route('**/api/build-graphs/resolve', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...buildGraphResponse(), compositeScore: compositeScoreFixture() })
    });
  });
  await page.route('**/api/parts**', async (route) => {
    const url = new URL(route.request().url());
    const items = url.searchParams.get('category') === 'GPU'
      ? [candidatePart('cand-gpu-ti', 'GPU', 'RTX 5060 Ti', { price: 600000 })]
      : [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items, page: 0, size: 20, total: items.length }) });
  });
  // 데이터 어긋남 재현: 기존 조합은 중간 옵션·PC-Builds 근거, 상위 후보(5060 Ti) 조합은 최고 옵션·다른 출처 근거라
  // 숫자만 보면 하락처럼 보인다 — 프론트는 이때 ±% 확정 델타를 내리면 안 된다.
  await page.route('**/api/tools/performance/check', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    const partIds: string[] = Array.isArray(body?.partIds) ? body.partIds : [];
    const isChangedBuild = partIds.includes('cand-gpu-ti');
    const evidence = isChangedBuild
      ? {
          gameTitle: '배틀그라운드',
          gameKey: 'pubg',
          resolution: 'QHD',
          graphicsPreset: 'TECHBENCH_ULTRA',
          avgFps: 118,
          onePercentLowFps: 90,
          sourceName: 'TechBench Lab',
          confidence: 'MEDIUM',
          match: { evidenceExactness: 'GPU_CLASS_REFERENCE', gameMatched: true, resolutionMatched: true }
        }
      : {
          gameTitle: '배틀그라운드',
          gameKey: 'pubg',
          resolution: 'QHD',
          graphicsPreset: 'PC_BUILDS_MEDIUM',
          avgFps: 130,
          onePercentLowFps: 96,
          sourceName: 'PC-Builds FPS calculator',
          confidence: 'MEDIUM',
          match: { evidenceExactness: 'GPU_CLASS_REFERENCE', gameMatched: true, resolutionMatched: true }
        };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tool: 'performance', status: 'PASS', confidence: 'HIGH', summary: '', details: { gameFpsEvidence: [evidence] } })
    });
  });

  await page.goto('/self-quote');

  const panel = page.getByTestId('quote-performance-panel');
  await expect(panel.getByTestId('fps-avg')).toHaveText('130 FPS');

  // 상위 후보를 골라 비교를 켠다 — 근거 조건(프리셋·출처)이 달라 확정 비교가 불가한 조합.
  await panel.getByTestId('perf-candidate-select').click();
  await panel.getByTestId('perf-candidate-popover').getByTestId('perf-candidate-option-0').click();

  // 두 값은 숨기지 않고 그대로 보여준다.
  await expect(panel.getByTestId('fps-avg')).toHaveText('130');
  await expect(panel.getByTestId('fps-compare-avg')).toHaveText('118');
  // 확정 하락(-9%) 배지는 내리지 않는다 — 조건이 다른 두 참고치라서.
  await expect(panel.getByTestId('fps-compare-delta')).toHaveCount(0);
  // 대신 중립 고지 + 양쪽 측정 조건(해상도·그래픽 옵션·출처)을 함께 보여준다.
  const mismatch = panel.getByTestId('fps-compare-mismatch');
  await expect(mismatch).toBeVisible();
  await expect(mismatch).toContainText('측정 조건이 달라 직접 비교가 어려워요');
  await expect(mismatch.getByTestId('fps-compare-mismatch-base')).toContainText('QHD · 중간 옵션 · PC-Builds FPS calculator');
  await expect(mismatch.getByTestId('fps-compare-mismatch-changed')).toContainText('QHD · 최고 옵션 · TechBench Lab');
  // 가격·성능 향상 블록도 성능 ±%를 확정하지 않는다(빈 값) — 가격 변화는 실측이라 그대로 표시.
  await expect(panel.getByTestId('effect-bar-perf')).toHaveAttribute('data-effect-direction', 'empty');
  await expect(panel.getByTestId('effect-bar-perf')).toContainText('—');
  await expect(panel.getByTestId('effect-bar-price')).toHaveAttribute('data-effect-direction', 'up');
  await expect(panel.getByTestId('effect-bar-price')).toContainText('+20%');
});

test('prefers the evidence row matching the requested resolution over an unmatched fallback first row', async ({ page }) => {
  await loginAsUser(page);
  const draft = {
    ...emptyDraft,
    items: [
      draftItem('part-perf-cpu', 'CPU', '라이젠 9600X', 300000),
      draftItem('part-perf-gpu', 'GPU', 'RTX 5060', 500000)
    ],
    totalPrice: 800000,
    itemCount: 2
  };
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(draft) });
  });
  await page.route('**/api/build-graphs/resolve', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...buildGraphResponse(), compositeScore: compositeScoreFixture() })
    });
  });
  await page.route('**/api/parts**', async (route) => {
    const url = new URL(route.request().url());
    const items = url.searchParams.get('category') === 'GPU'
      ? [candidatePart('cand-gpu-strong', 'GPU', 'RTX 5070', { price: 700000 })]
      : [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items, page: 0, size: 20, total: items.length }) });
  });
  // 기존 조합의 [0]은 요청 해상도(QHD)와 다른 4K 폴백 행 — [0] 고정이면 88이 나오지만,
  // 요청 조건과 일치하는 2번째 행(QHD 130)을 우선 선택해야 한다. 변경 조합은 일치 행 하나만 내려준다.
  await page.route('**/api/tools/performance/check', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    const partIds: string[] = Array.isArray(body?.partIds) ? body.partIds : [];
    const isChangedBuild = partIds.includes('cand-gpu-strong');
    const matchedRow = (avgFps: number, onePercentLowFps: number) => ({
      gameTitle: '배틀그라운드',
      gameKey: 'pubg',
      resolution: 'QHD',
      graphicsPreset: 'PC_BUILDS_MEDIUM',
      avgFps,
      onePercentLowFps,
      sourceName: 'PC-Builds FPS calculator',
      confidence: 'MEDIUM',
      match: { evidenceExactness: 'GPU_CLASS_REFERENCE', gameMatched: true, resolutionMatched: true }
    });
    const gameFpsEvidence = isChangedBuild
      ? [matchedRow(152, 118)]
      : [
          {
            gameTitle: '배틀그라운드',
            gameKey: 'pubg',
            resolution: '4K',
            graphicsPreset: 'PC_BUILDS_MEDIUM',
            avgFps: 88,
            onePercentLowFps: 64,
            sourceName: 'PC-Builds FPS calculator',
            confidence: 'LOW',
            match: { evidenceExactness: 'GPU_CLASS_RESOLUTION_FALLBACK', gameMatched: true, resolutionMatched: false }
          },
          matchedRow(130, 96)
        ];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tool: 'performance', status: 'PASS', confidence: 'HIGH', summary: '', details: { gameFpsEvidence } })
    });
  });

  await page.goto('/self-quote');

  // 단일 표시부터 폴백 행(88)이 아니라 요청 조건 일치 행(130)을 쓴다.
  const panel = page.getByTestId('quote-performance-panel');
  await expect(panel.getByTestId('fps-avg')).toHaveText('130 FPS');

  // 상위 후보 비교 — 양쪽 모두 일치 행(QHD·같은 프리셋·같은 출처)이라 확정 델타가 그대로 나온다.
  await panel.getByTestId('perf-candidate-select').click();
  await panel.getByTestId('perf-candidate-popover').getByTestId('perf-candidate-option-0').click();
  await expect(panel.getByTestId('fps-avg')).toHaveText('130');
  await expect(panel.getByTestId('fps-compare-avg')).toHaveText('152');
  await expect(panel.getByTestId('fps-compare-delta')).toHaveText('+17%');
  await expect(panel.getByTestId('fps-compare-mismatch')).toHaveCount(0);
});

test('highlights WARN and FAIL slots with edges and blocks purchase on FAIL', async ({ page }) => {
  await loginAsUser(page);
  const saveRequests: unknown[] = [];

  await page.route('**/api/build-graphs/resolve', async (route) => {
    const base = buildGraphResponse();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...base,
        nodes: base.nodes.map((node) => {
          if (node.category === 'GPU') {
            return { ...node, status: 'FAIL', detail: '파워 용량이 부족합니다.' };
          }
          if (node.category === 'PSU') {
            return { ...node, status: 'WARN', detail: '전력 여유가 빠듯합니다.' };
          }
          return node;
        }),
        edges: [
          {
            id: 'edge-gpu-psu-power',
            source: 'part-GPU',
            target: 'part-PSU',
            type: 'AFFECTS',
            status: 'FAIL',
            label: '전력 150W 부족',
            summary: 'GPU 권장 정격 파워보다 PSU 용량이 부족합니다.'
          }
        ]
      })
    });
  });
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fullDraft) });
  });
  await page.route('**/api/builds/from-chat', async (route) => {
    saveRequests.push(JSON.parse(route.request().postData() ?? '{}'));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'saved-fail-build' }) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });

  await page.goto('/self-quote');
  await page.getByRole('button', { name: '실장도 보기' }).click();

  // 문제 슬롯 강조: FAIL은 숨기지 않고 표시한다. 장착된 박스는 상태색으로 칠해진다(빨강/주황).
  const gpuSlot = page.getByTestId('slot-GPU');
  await expect(gpuSlot).toHaveAttribute('data-status', 'FAIL');
  await expect(gpuSlot).toHaveClass(/bg-red-100/);
  await expect(gpuSlot.getByText('장착 불가')).toBeVisible();
  // PSU는 노드 자체가 WARN이지만 GPU-PSU 관계선 FAIL이 양쪽 슬롯에 승격된다(체크리스트와 동일 규칙).
  const psuSlot = page.getByTestId('slot-PSU');
  await expect(psuSlot).toHaveAttribute('data-status', 'FAIL');
  await expect(psuSlot).toHaveClass(/bg-red-100/);
  await expect(psuSlot.getByText('장착 불가')).toBeVisible();

  // 문제 관계선 강조
  const failEdge = page.getByTestId('slot-edge-GPU-PSU');
  await expect(failEdge).toHaveAttribute('data-status', 'FAIL');
  await expect(failEdge).toHaveText('전력 150W 부족');

  // FAIL이 있으면 구매하기는 비활성화되고 사유를 보여준다.
  const checkoutActions = page.getByTestId('quote-checkout-actions');
  const blockedPurchase = checkoutActions.getByRole('button', { name: '구매하기' });
  await expect(blockedPurchase).toBeDisabled();
  await expect(blockedPurchase).toHaveAttribute('title', '안 맞는 부품이 있어 구매할 수 없습니다. 문제 슬롯을 교체해 주세요.');
  await expect(checkoutActions.getByRole('link', { name: '구매하기' })).toHaveCount(0);
  await expect(page.getByTestId('quote-summary-bar')).toContainText('장착 불가');

  // 내 견적함 저장은 FAIL이 있어도 허용한다.
  const saveButton = checkoutActions.getByRole('button', { name: '내 견적함에 추가' });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect.poll(() => saveRequests.length).toBe(1);
  const statusBar = page.getByTestId('slot-status-bar');
  await expect(statusBar.getByText('내 견적함에 추가했습니다.')).toBeVisible();
});

test('keeps purchase enabled when the current quote has only WARN issues', async ({ page }) => {
  await loginAsUser(page);

  // beforeEach 기본 graph 응답은 PSU WARN만 포함한다.
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fullDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });

  await page.goto('/self-quote');
  await page.getByRole('button', { name: '실장도 보기' }).click();

  const psuSlot = page.getByTestId('slot-PSU');
  await expect(psuSlot).toHaveAttribute('data-status', 'WARN');
  await expect(psuSlot.getByText('간섭 주의')).toBeVisible();
  await expect(page.getByTestId('slot-board-problem-banner')).toHaveCount(0);
  await psuSlot.click();
  await expect(page.getByTestId('slot-problem-popover')).toBeVisible();
  await expect(page.getByTestId('quote-checkout-actions').getByRole('link', { name: '구매하기' })).toHaveAttribute('href', '/checkout');
});

test('marks fallback topology edges as pending while a related slot is empty', async ({ page }) => {
  await loginAsUser(page);

  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(emptyDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });

  await page.goto('/self-quote');
  await page.getByRole('button', { name: '실장도 보기' }).click();

  await expect(page.getByTestId('slot-edge-CPU-MOTHERBOARD')).toHaveAttribute('data-status', 'PENDING');
  await expect(page.getByTestId('slot-edge-GPU-PSU')).toHaveAttribute('data-status', 'PENDING');
});

test('removes a single-part slot item from the slot board', async ({ page }) => {
  await loginAsUser(page);
  let draft: unknown = fullDraft;
  const deletedPartIds: string[] = [];

  await page.route('**/api/quote-drafts/current**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'DELETE') {
      const partId = url.pathname.split('/').pop() ?? '';
      deletedPartIds.push(partId);
      draft = {
        ...fullDraft,
        items: fullDraftItems.filter((item) => item.partId !== partId)
      };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(draft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });

  await page.goto('/self-quote');
  // 슬롯 카드의 빼기 버튼은 실장도 보기에서 노출된다(배치도는 hover X 버튼이 담당).
  await page.getByRole('button', { name: '실장도 보기' }).click();

  await page.getByTestId('slot-GPU').hover();
  await page.getByRole('button', { name: '풀보드 RTX GPU 견적에서 제거' }).click();

  await expect.poll(() => deletedPartIds).toEqual(['part-gpu-full']);
  await expect(page.getByTestId('slot-GPU')).toContainText('+ 부품 선택');
  await expect(page.getByTestId('quote-summary-bar')).toContainText('7 / 8');
  await expect(page.getByTestId('quote-checklist-progress')).toHaveText('7/8 완료');
});

test('decreases an overfilled RAM kit to zero and removes it from the quote', async ({ page }) => {
  await loginAsUser(page);
  const partId = 'part-ram-overfilled';
  let quantity = 3;
  const patchedQuantities: number[] = [];
  const deletedPartIds: string[] = [];
  const currentDraft = () => {
    const items = quantity > 0
      ? [draftItem(partId, 'RAM', 'DDR5 32GB 듀얼 키트', 120_000, quantity, { moduleCount: 2 })]
      : [];
    return {
      ...emptyDraft,
      items,
      totalPrice: items.reduce((sum, item) => sum + item.lineTotal, 0),
      itemCount: quantity
    };
  };

  await page.route('**/api/quote-drafts/current**', async (route) => {
    const method = route.request().method();
    if (method === 'PATCH') {
      const body = route.request().postDataJSON() as { quantity: number };
      quantity = body.quantity;
      patchedQuantities.push(quantity);
    } else if (method === 'DELETE') {
      deletedPartIds.push(new URL(route.request().url()).pathname.split('/').pop() ?? '');
      quantity = 0;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(currentDraft()) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });

  await page.goto('/self-quote');
  const ramArea = page.getByTestId('slot-fused-area-wrap-RAM');

  for (const expectedCount of [4, 2]) {
    await ramArea.hover();
    await page.getByTestId('slot-fused-ram-decrease').click();
    await expect(page.getByTestId('slot-fused-ram-count')).toHaveText(String(expectedCount));
  }
  await ramArea.hover();
  await page.getByTestId('slot-fused-ram-decrease').click();

  await expect.poll(() => patchedQuantities).toEqual([2, 1]);
  await expect.poll(() => deletedPartIds).toEqual([partId]);
  await expect(page.getByTestId('quote-summary-bar')).toContainText('0 / 8');
});

test('opens the candidate panel from a slot and requests QUOTE_DRAFT_CURRENT compatibility in 20 item pages', async ({ page }) => {
  await loginAsUser(page);
  const partRequests: Array<Record<string, string | null>> = [];

  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(emptyDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    const url = new URL(route.request().url());
    partRequests.push({
      category: url.searchParams.get('category'),
      size: url.searchParams.get('size'),
      sort: url.searchParams.get('sort'),
      compatibilitySource: url.searchParams.get('compatibilitySource')
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          candidatePart('part-gpu-pass', 'GPU', '패스 GPU 후보'),
          candidatePart('part-gpu-warn', 'GPU', '간섭 GPU 후보', {
            compatibility: { status: 'WARN', statusLabel: '간섭 주의', summary: '케이스 장착 길이가 빠듯합니다.' }
          }),
          candidatePart('part-gpu-fail', 'GPU', '실패 GPU 후보', {
            compatibility: { status: 'FAIL', statusLabel: '장착 불가', summary: '파워 용량이 부족합니다.' }
          })
        ],
        page: 0,
        size: 20,
        total: 3
      })
    });
  });

  await page.goto('/self-quote');
  await page.getByTestId('slot-fused-area-GPU').click();

  const panel = page.getByTestId('slot-candidate-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'GPU 부품 목록' })).toBeVisible();
  await expect(page.getByTestId('slot-GPU')).toHaveAttribute('data-selected', 'true');
  await expect(page).toHaveURL('/self-quote?category=GPU');

  await expect.poll(() => partRequests.length).toBeGreaterThan(0);
  expect(partRequests[0]).toEqual({
    category: 'GPU',
    size: '20',
    sort: 'price_asc',
    compatibilitySource: 'QUOTE_DRAFT_CURRENT'
  });

  await expect(panel.getByText('패스 GPU 후보')).toBeVisible();
  const candidateImage = panel.getByTestId('candidate-part-image').first();
  await expect(candidateImage).toBeVisible();
  await expect.poll(() => candidateImage.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
  // 제품명은 상세 페이지(/parts/:id)로 가는 링크다(담기와 구분되는 진입점).
  await expect(panel.getByRole('link', { name: '패스 GPU 후보', exact: true })).toHaveAttribute('href', '/parts/part-gpu-pass');
  await expect(panel.getByText('간섭 GPU 후보')).toBeVisible();
  await expect(panel.getByText('간섭 주의')).toBeVisible();
  await expect(panel.getByRole('button', { name: '간섭 GPU 후보 담기' })).toBeEnabled();
  // FAIL 후보는 숨기지 않고 '장착 불가' 뱃지 + 사유를 보여주되, 담기 자체는 허용한다(담으면 보드에서 빨강).
  await expect(panel.getByText('실패 GPU 후보')).toBeVisible();
  const failCard = panel.locator('[data-compat="FAIL"]');
  await expect(failCard).toHaveCount(1);
  await expect(failCard.getByText('장착 불가', { exact: true })).toBeVisible();
  await expect(failCard.getByText('파워 용량이 부족합니다.')).toBeVisible();
  // 담기 버튼은 활성 — 비호환도 담아서 왜 안 되는지 보드에서 확인하는 UX.
  // "장착 불가여도 담을 수 있다"는 안내문을 헤더에서 뺐다(제목 아래를 검색에 내줬다) —
  // 그 사실은 이제 문장이 아니라 동작이 말한다: FAIL 카드에 사유가 붙고 담기 버튼이 살아 있다(윗줄).
  await expect(panel.getByText('장착 불가 후보도 담아서 사유를 확인할 수 있어요')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('slot-candidate-panel')).toHaveCount(0);
  await expect(page).toHaveURL('/self-quote');
  await expect(page.getByTestId('slot-GPU')).toHaveAttribute('data-selected', 'false');
});

test('filters candidates by search keyword and offers compatibility-first sort', async ({ page }) => {
  await loginAsUser(page);
  const partRequests: Array<{ q: string | null; sort: string | null }> = [];

  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(emptyDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    const url = new URL(route.request().url());
    const q = url.searchParams.get('q');
    partRequests.push({ q, sort: url.searchParams.get('sort') });
    // 서버 검색 시뮬레이션: q가 있으면 이름에 포함된 후보만 돌려준다.
    const all = [
      candidatePart('part-gpu-5070', 'GPU', 'RTX 5070 게이밍'),
      candidatePart('part-gpu-5080', 'GPU', 'RTX 5080 울트라', {
        compatibility: { status: 'FAIL', statusLabel: '장착 불가', summary: '파워 용량이 부족합니다.' }
      })
    ];
    const items = q ? all.filter((part) => part.name.includes(q)) : all;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items, page: 0, size: 20, total: items.length }) });
  });

  await page.goto('/self-quote');
  await page.getByTestId('checklist-GPU').click();
  const panel = page.getByTestId('slot-candidate-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('RTX 5070 게이밍')).toBeVisible();
  await expect(panel.getByText('RTX 5080 울트라')).toBeVisible();

  // 검색: '5080' 입력 → 디바운스 후 q=5080 요청이 나가고 결과가 좁혀진다.
  await panel.getByTestId('candidate-search').fill('5080');
  await expect.poll(() => partRequests.some((request) => request.q === '5080')).toBe(true);
  await expect(panel.getByText('RTX 5080 울트라')).toBeVisible();
  await expect(panel.getByText('RTX 5070 게이밍')).toHaveCount(0);

  // 검색어 지우기 → 다시 전체 후보.
  await panel.getByRole('button', { name: '검색어 지우기' }).click();
  await expect(panel.getByTestId('candidate-search')).toHaveValue('');
  await expect(panel.getByText('RTX 5070 게이밍')).toBeVisible();

  // 호환 가능 우선 정렬 → sort=compatibility 요청이 나간다(백엔드가 PASS→WARN→FAIL 순 정렬).
  await panel.getByLabel('후보 정렬 기준').selectOption('compatibility');
  await expect.poll(() => partRequests.some((request) => request.sort === 'compatibility')).toBe(true);
});

test('filters candidates by manufacturer, price range, and hides incompatible', async ({ page }) => {
  await loginAsUser(page);
  const partRequests: Array<Record<string, string | null>> = [];

  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(emptyDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    const url = new URL(route.request().url());
    partRequests.push({
      manufacturer: url.searchParams.get('manufacturer'),
      minPrice: url.searchParams.get('minPrice'),
      maxPrice: url.searchParams.get('maxPrice')
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          { ...candidatePart('gpu-asus', 'GPU', 'ASUS RTX 5070'), manufacturer: 'ASUS' },
          {
            ...candidatePart('gpu-msi', 'GPU', 'MSI RTX 5080', {
              compatibility: { status: 'FAIL', statusLabel: '장착 불가', summary: '파워 용량이 부족합니다.' }
            }),
            manufacturer: 'MSI'
          }
        ],
        page: 0,
        size: 20,
        total: 2
      })
    });
  });

  await page.goto('/self-quote');
  await page.getByTestId('checklist-GPU').click();
  const panel = page.getByTestId('slot-candidate-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-compat="FAIL"]')).toHaveCount(1);

  // 필터는 기본 접힘 — 조작하려면 먼저 펼친다.
  await panel.getByTestId('candidate-filters-toggle').click();

  // 장착 불가 숨기기(client-side): FAIL 후보만 사라지고, 다시 끄면 돌아온다.
  await panel.getByTestId('candidate-hide-fail').check();
  await expect(panel.locator('[data-compat="FAIL"]')).toHaveCount(0);
  await expect(panel.getByText('ASUS RTX 5070')).toBeVisible();
  await panel.getByTestId('candidate-hide-fail').uncheck();
  await expect(panel.locator('[data-compat="FAIL"]')).toHaveCount(1);

  // 제조사 필터: 로드된 후보에서 누적된 옵션을 골라 manufacturer 파라미터를 보낸다.
  await expect(panel.locator('[data-testid="candidate-manufacturer"] option', { hasText: 'ASUS' })).toHaveCount(1);
  await panel.getByTestId('candidate-manufacturer').selectOption('ASUS');
  await expect.poll(() => partRequests.some((request) => request.manufacturer === 'ASUS')).toBe(true);

  // 가격대 필터: 최소/최대 입력 → 디바운스 후 minPrice/maxPrice 파라미터.
  await panel.getByTestId('candidate-min-price').fill('500000');
  await panel.getByTestId('candidate-max-price').fill('900000');
  await expect.poll(() => partRequests.some((request) => request.minPrice === '500000' && request.maxPrice === '900000')).toBe(true);

  // 최소가 > 최대가 입력 실수 → 두 값을 서로 바꿔 요청한다(서버 오류 없이 의도한 범위로 조회).
  await panel.getByTestId('candidate-min-price').fill('900000');
  await panel.getByTestId('candidate-max-price').fill('300000');
  await expect.poll(() => partRequests.some((request) => request.minPrice === '300000' && request.maxPrice === '900000')).toBe(true);
});

test('opens candidate quick view and wishlists a candidate', async ({ page }) => {
  await loginAsUser(page);
  await page.addInitScript(() => localStorage.removeItem('buildgraph.wishlist'));

  await page.route('**/api/quote-drafts/current**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(emptyDraft) }));
  await page.route('**/api/parts**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      items: [
        candidatePart('gpu-a', 'GPU', '지포스 RTX 5070', { price: 900000 }),
        candidatePart('gpu-b', 'GPU', '라데온 RX 9070', { price: 800000 })
      ],
      page: 0,
      size: 20,
      total: 2
    })
  }));

  await page.goto('/self-quote');
  await page.getByTestId('checklist-GPU').click();
  const panel = page.getByTestId('slot-candidate-panel');
  await expect(panel).toBeVisible();
  const firstCard = panel.locator('article', { hasText: '지포스 RTX 5070' });

  // 빠른보기: 상세 모달이 뜬다.
  await firstCard.getByTestId('candidate-quick-view').click();
  const modal = page.getByTestId('part-quick-view');
  await expect(modal).toBeVisible();
  await expect(modal.getByRole('heading', { name: '지포스 RTX 5070' })).toBeVisible();

  // 모달에서 찜 → 닫으면 카드 하트가 찜 상태로 남는다(로컬 저장).
  await modal.getByTestId('quick-view-wishlist').click();
  await modal.getByRole('button', { name: '빠른보기 닫기' }).click();
  await expect(page.getByTestId('part-quick-view')).toHaveCount(0);
  await expect(firstCard.getByTestId('candidate-wishlist')).toHaveAttribute('aria-pressed', 'true');

  // '찜만' 필터: 찜한 후보만 남는다. 필터는 기본 접힘이라 먼저 펼친다.
  await panel.getByTestId('candidate-filters-toggle').click();
  await panel.getByTestId('candidate-only-wishlist').check();
  await expect(panel.getByText('지포스 RTX 5070')).toBeVisible();
  await expect(panel.getByText('라데온 RX 9070')).toHaveCount(0);
});

test('adds a candidate part into an empty slot from the panel', async ({ page }) => {
  await loginAsUser(page);
  const putRequests: Array<{ partId: string; quantity: number }> = [];
  let draft: unknown = emptyDraft;

  await page.route('**/api/quote-drafts/current**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'PUT') {
      const partId = url.pathname.split('/').pop() ?? '';
      const body = JSON.parse(route.request().postData() ?? '{}') as { quantity: number };
      putRequests.push({ partId, quantity: body.quantity });
      draft = {
        ...emptyDraft,
        items: [draftItem(partId, 'GPU', '패스 GPU 후보', 100000)],
        totalPrice: 100000,
        itemCount: 1
      };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(draft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [candidatePart('part-gpu-pass', 'GPU', '패스 GPU 후보')], page: 0, size: 20, total: 1 })
    });
  });

  await page.goto('/self-quote?category=GPU');
  await page.getByRole('button', { name: '패스 GPU 후보 담기' }).click();

  await expect.poll(() => putRequests).toEqual([{ partId: 'part-gpu-pass', quantity: 1 }]);
  await expect(page).toHaveURL('/self-quote');
  await expect(page.getByTestId('slot-candidate-panel')).toHaveCount(0);
  await expect(page.getByTestId('checklist-GPU')).toContainText('패스 GPU 후보');
  await expect(page.getByTestId('slot-GPU')).toHaveAttribute('title', '패스 GPU 후보');
  await expect(page.getByTestId('quote-summary-bar')).toContainText('1 / 8');
  await expect(page.getByTestId('quote-checklist-progress')).toHaveText('1/8 완료');
});

test('keeps the candidate overlay open and reports an inline error when applying fails', async ({ page }) => {
  await loginAsUser(page);
  await page.route('**/api/quote-drafts/current**', async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'apply failed' }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(emptyDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [candidatePart('part-gpu-error', 'GPU', '실패 확인 GPU')], page: 0, size: 20, total: 1 })
    });
  });

  await page.goto('/self-quote?category=GPU');
  const panel = page.getByTestId('slot-candidate-panel');
  await panel.getByRole('button', { name: '실패 확인 GPU 담기' }).click();

  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('candidate-commit-error')).toContainText('부품을 견적에 반영하지 못했습니다');
  await expect(page).toHaveURL('/self-quote?category=GPU');
});

test('adds RAM and SSD candidates with ADD compatibility evaluation', async ({ page }) => {
  await loginAsUser(page);
  const candidateByCategory = {
    RAM: candidatePart('part-ram-add', 'RAM', '추가 RAM 후보'),
    STORAGE: candidatePart('part-ssd-add', 'STORAGE', '추가 SSD 후보')
  } as const;
  const partRequests: Array<{ category: string | null; mode: string | null; target: string | null }> = [];
  const putRequests: string[] = [];
  let items: ReturnType<typeof draftItem>[] = [];

  await page.route('**/api/quote-drafts/current**', async (route) => {
    if (route.request().method() === 'PUT') {
      const partId = new URL(route.request().url()).pathname.split('/').pop() ?? '';
      putRequests.push(partId);
      if (partId === 'part-ram-add') items = [...items, draftItem(partId, 'RAM', '추가 RAM 후보', 100000)];
      if (partId === 'part-ssd-add') items = [...items, draftItem(partId, 'STORAGE', '추가 SSD 후보', 100000)];
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...emptyDraft, items, totalPrice: items.reduce((sum, item) => sum + item.lineTotal, 0), itemCount: items.length })
    });
  });
  await page.route('**/api/parts**', async (route) => {
    const url = new URL(route.request().url());
    const category = url.searchParams.get('category') as keyof typeof candidateByCategory;
    partRequests.push({
      category,
      mode: url.searchParams.get('compatibilityMode'),
      target: url.searchParams.get('replaceTargetPartId')
    });
    const part = candidateByCategory[category];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: part ? [part] : [], page: 0, size: 20, total: part ? 1 : 0 })
    });
  });

  await page.goto('/self-quote?category=RAM');
  await page.getByRole('button', { name: '추가 RAM 후보 담기' }).click();
  await expect(page).toHaveURL('/self-quote');
  await expect(page.getByTestId('checklist-RAM')).toContainText('추가 RAM 후보');

  await page.getByTestId('checklist-STORAGE').click();
  await page.getByRole('button', { name: '추가 SSD 후보 담기' }).click();
  await expect(page).toHaveURL('/self-quote');
  await expect(page.getByTestId('checklist-STORAGE')).toContainText('추가 SSD 후보');

  await expect.poll(() => putRequests).toEqual(['part-ram-add', 'part-ssd-add']);
  expect(partRequests).toEqual(expect.arrayContaining([
    { category: 'RAM', mode: 'ADD', target: null },
    { category: 'STORAGE', mode: 'ADD', target: null }
  ]));
});

test('shows a whole FAIL page greyed out with reasons instead of auto-fetching the next page', async ({ page }) => {
  await loginAsUser(page);
  const requestedPages: string[] = [];

  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(emptyDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    const url = new URL(route.request().url());
    const pageParam = url.searchParams.get('page') ?? '0';
    requestedPages.push(pageParam);
    const items = pageParam === '0'
      ? Array.from({ length: 20 }, (_, index) => candidatePart(`part-psu-fail-${index}`, 'PSU', `실패 파워 ${index + 1}`, {
          compatibility: { status: 'FAIL', statusLabel: '장착 불가', summary: '용량 부족' }
        }))
      : [candidatePart('part-psu-pass', 'PSU', '통과 파워 후보')];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items, page: Number.parseInt(pageParam, 10), size: 20, total: 21 })
    });
  });

  await page.goto('/self-quote?category=PSU');

  // 전부 FAIL이어도 자동으로 다음 페이지를 당기지 않고, 회색 카드 20개 + 사유를 그대로 보여준다.
  const panel = page.getByTestId('slot-candidate-panel');
  await expect(panel.getByText('실패 파워 1', { exact: true })).toBeVisible();
  await expect(panel.locator('[data-compat="FAIL"]')).toHaveCount(20);
  await expect(panel.getByText('용량 부족').first()).toBeVisible();
  expect(requestedPages).toEqual(['0']);

  // 다음 페이지는 사용자가 직접 '후보 더 보기'로 불러온다.
  await panel.getByRole('button', { name: '후보 더 보기' }).dispatchEvent('click');
  await expect(panel.getByText('통과 파워 후보')).toBeVisible();
  expect(requestedPages).toContain('1');
});

test('loads more candidates in 20 item pages from the panel', async ({ page }) => {
  await loginAsUser(page);
  const requestedPages: string[] = [];

  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(emptyDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    const url = new URL(route.request().url());
    const pageParam = url.searchParams.get('page') ?? '0';
    requestedPages.push(pageParam);
    const currentPage = Number.parseInt(pageParam, 10);
    const start = currentPage * 20;
    const items = Array.from({ length: Math.min(20, 45 - start) }, (_, index) => {
      const itemNumber = start + index + 1;
      return candidatePart(`part-psu-page-${itemNumber}`, 'PSU', `페이징 파워 ${itemNumber}`, { price: 50000 + itemNumber });
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items, page: currentPage, size: 20, total: 45 })
    });
  });

  await page.goto('/self-quote?category=PSU');

  const panel = page.getByTestId('slot-candidate-panel');
  await expect(panel.getByText('페이징 파워 1', { exact: true })).toBeVisible();
  expect(requestedPages).toContain('0');

  await panel.getByRole('button', { name: '후보 더 보기' }).click();
  await expect(panel.getByText('페이징 파워 21', { exact: true })).toBeVisible();
  expect(requestedPages).toContain('1');
});

test.skip('manages RAM items with remove and replace target selection in the panel', async ({ page }) => {
  await loginAsUser(page);
  const putRequests: string[] = [];
  const deleteRequests: string[] = [];
  let items = [
    draftItem('part-ram-a', 'RAM', '기존 램 A', 90000, 2),
    draftItem('part-ram-b', 'RAM', '기존 램 B', 80000, 1)
  ];

  await page.route('**/api/quote-drafts/current**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (method === 'PUT') {
      const partId = url.pathname.split('/').pop() ?? '';
      putRequests.push(partId);
      items = [...items, draftItem(partId, 'RAM', '교체 램 후보', 95000, 1)];
    }
    if (method === 'DELETE') {
      const partId = url.pathname.split('/').pop() ?? '';
      deleteRequests.push(partId);
      items = items.filter((item) => item.partId !== partId);
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...emptyDraft,
        items,
        totalPrice: items.reduce((sum, item) => sum + item.lineTotal, 0),
        itemCount: items.reduce((sum, item) => sum + item.quantity, 0)
      })
    });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [candidatePart('part-ram-new', 'RAM', '교체 램 후보', { price: 95000 })], page: 0, size: 20, total: 1 })
    });
  });

  await page.goto('/self-quote?category=RAM');

  const panel = page.getByTestId('slot-candidate-panel');
  await expect(panel.getByText('기존 램 A')).toBeVisible();
  await expect(panel.getByText('기존 램 B')).toBeVisible();

  // 개별 제거
  await panel.getByRole('button', { name: '기존 램 A 견적에서 제거' }).click();
  await expect.poll(() => deleteRequests).toEqual(['part-ram-a']);
  await expect(panel.getByText('기존 램 A')).toHaveCount(0);

  // 교체 대상 선택 후 후보로 교체
  await panel.getByRole('button', { name: '기존 램 B 교체 대상 선택' }).click();
  await panel.getByRole('button', { name: '교체 램 후보(으)로 교체' }).click();

  await expect.poll(() => putRequests).toEqual(['part-ram-new']);
  await expect.poll(() => deleteRequests).toEqual(['part-ram-a', 'part-ram-b']);
  await expect(page.getByTestId('checklist-RAM')).toContainText('교체 램 후보');
});

test.skip('sends ADD evaluation mode for multi-item categories and replace target for targeted replace', async ({ page }) => {
  await loginAsUser(page);
  const partRequests: Array<{ mode: string | null; target: string | null }> = [];
  const ramItems = [draftItem('part-ram-a', 'RAM', '기존 램 A', 90000, 1)];

  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...emptyDraft, items: ramItems, totalPrice: 90000, itemCount: 1 })
    });
  });
  await page.route('**/api/parts**', async (route) => {
    const url = new URL(route.request().url());
    partRequests.push({
      mode: url.searchParams.get('compatibilityMode'),
      target: url.searchParams.get('replaceTargetPartId')
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [candidatePart('part-ram-new', 'RAM', '후보 램 킷')], page: 0, size: 20, total: 1 })
    });
  });

  await page.goto('/self-quote?category=RAM');

  // 복수 장착 카테고리(RAM)는 담기 기준(ADD)으로 평가를 요청한다.
  await expect.poll(() => partRequests.length).toBeGreaterThan(0);
  expect(partRequests[0]).toEqual({ mode: 'ADD', target: null });

  // 교체 대상을 지정하면 그 행만 제외하는 REPLACE 평가로 다시 요청한다.
  const panel = page.getByTestId('slot-candidate-panel');
  await panel.getByRole('button', { name: '기존 램 A 교체 대상 선택' }).click();
  await expect.poll(() => partRequests.some((request) => request.target === 'part-ram-a')).toBe(true);
  const targeted = partRequests.find((request) => request.target === 'part-ram-a');
  expect(targeted?.mode).toBeNull();
});

test('flashes the slot after attaching a part without breaking the flow', async ({ page }) => {
  await loginAsUser(page);
  let draft: unknown = emptyDraft;

  await page.route('**/api/quote-drafts/current**', async (route) => {
    if (route.request().method() === 'PUT') {
      draft = {
        ...emptyDraft,
        items: [draftItem('part-gpu-flash', 'GPU', '플래시 GPU 후보', 100000)],
        totalPrice: 100000,
        itemCount: 1
      };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(draft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [candidatePart('part-gpu-flash', 'GPU', '플래시 GPU 후보')], page: 0, size: 20, total: 1 })
    });
  });

  await page.goto('/self-quote?category=GPU');

  const gpuSlot = page.getByTestId('slot-GPU');
  const gpuChecklistRow = page.getByTestId('checklist-GPU');
  await expect(gpuSlot).toHaveAttribute('data-flash', 'false');
  await expect(gpuChecklistRow).toHaveAttribute('data-flash', 'false');
  await page.getByTestId('slot-candidate-panel').getByRole('button', { name: /플래시 GPU 후보 담기/ }).click();

  // 장착 직후 flash 상태가 켜졌다가 자동으로 꺼지고, 조작 흐름은 그대로 동작한다.
  await expect(gpuSlot).toHaveAttribute('data-flash', 'true');
  // 체크리스트 행도 같은 변경 신호로 카드 채워짐 플래시가 켜진다(단일 변경이라 지연 0).
  await expect(gpuChecklistRow).toHaveAttribute('data-flash', 'true');
  await expect(gpuChecklistRow).toHaveCSS('animation-delay', '0s');
  await expect(gpuSlot).toHaveAttribute('title', '플래시 GPU 후보');
  await expect(gpuSlot).toHaveAttribute('data-flash', 'false', { timeout: 3000 });
  await expect(gpuChecklistRow).toHaveAttribute('data-flash', 'false', { timeout: 3000 });
});

test.skip('keeps attach and remove flows working with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginAsUser(page);
  let draft: unknown = emptyDraft;

  await page.route('**/api/quote-drafts/current**', async (route) => {
    const method = route.request().method();
    if (method === 'PUT') {
      draft = {
        ...emptyDraft,
        items: [draftItem('part-gpu-motion', 'GPU', '모션 감소 GPU', 100000)],
        totalPrice: 100000,
        itemCount: 1
      };
    }
    if (method === 'DELETE') {
      draft = emptyDraft;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(draft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [candidatePart('part-gpu-motion', 'GPU', '모션 감소 GPU')], page: 0, size: 20, total: 1 })
    });
  });

  await page.goto('/self-quote?category=GPU');
  await page.getByRole('button', { name: '모션 감소 GPU 담기' }).click();
  const gpuSlot = page.getByTestId('slot-GPU');
  await expect(gpuSlot).toHaveAttribute('title', '모션 감소 GPU');

  const panel = page.getByTestId('slot-candidate-panel');
  await panel.getByRole('button', { name: '모션 감소 GPU 견적에서 제거' }).click();
  await expect(gpuSlot).toContainText('+ 부품 선택');
});

test.skip('keeps the installed item as a manageable row without the info panel', async ({ page }) => {
  await loginAsUser(page);
  const deleteRequests: string[] = [];
  const gpuItem = {
    ...draftItem('part-gpu-detail', 'GPU', '상세 스펙 RTX GPU', 890000),
    attributes: { shortSpec: 'QHD 게임용 GPU 스펙', vramGb: 16, wattage: 220 }
  };
  let draft: unknown = { ...emptyDraft, items: [gpuItem], totalPrice: 890000, itemCount: 1 };

  await page.route('**/api/quote-drafts/current**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'DELETE') {
      deleteRequests.push(url.pathname.split('/').pop() ?? '');
      draft = emptyDraft;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(draft) });
  });
  await page.route('**/api/parts**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/price-history')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          partId: 'part-gpu-detail',
          partName: '상세 스펙 RTX GPU',
          currentPrice: 890000,
          days: 3650,
          source: 'NAVER_SHOPPING_SEARCH',
          items: [
            { price: 900000, source: 'NAVER_SHOPPING_SEARCH', collectedAt: '2026-06-20T00:00:00Z' },
            { price: 890000, source: 'NAVER_SHOPPING_SEARCH', collectedAt: '2026-07-01T00:00:00Z' }
          ],
          summary: {
            sampleCount: 2,
            currentPrice: 890000,
            minPrice: 890000,
            maxPrice: 900000,
            firstPrice: 900000,
            lastPrice: 890000,
            changeAmount: -10000,
            changeRatePercent: -1.11
          }
        })
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });

  await page.goto('/self-quote?category=GPU');

  const panel = page.getByTestId('slot-candidate-panel');
  // 장착 부품은 관리 행(이름·수량·제거)으로 후보 리스트에 남는다.
  await expect(panel.getByText('상세 스펙 RTX GPU')).toBeVisible();
  // 리디자인 지시(칸 전체 삭제, 부품 리스트만): 정보 박스의 가격추이·스펙 뱃지·짧은 스펙은 제거됐다.
  await expect(panel.getByText('현재 장착')).toHaveCount(0);
  await expect(panel.getByText('직전 기록 대비')).toHaveCount(0);
  await expect(panel.getByText('VRAM 16GB')).toHaveCount(0);
  await expect(panel.getByText('사용전력 220W')).toHaveCount(0);
  await expect(panel.getByText('QHD 게임용 GPU 스펙')).toHaveCount(0);

  await panel.getByRole('button', { name: '상세 스펙 RTX GPU 견적에서 제거' }).click();
  await expect.poll(() => deleteRequests).toEqual(['part-gpu-detail']);
  await expect(page.getByTestId('slot-GPU')).toContainText('+ 부품 선택');
});

test.skip('updates RAM quantity with the panel stepper', async ({ page }) => {
  await loginAsUser(page);
  const patchRequests: Array<{ partId: string; quantity: number }> = [];
  let quantity = 2;

  await page.route('**/api/quote-drafts/current**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'PATCH') {
      const body = JSON.parse(route.request().postData() ?? '{}') as { quantity: number };
      patchRequests.push({ partId: url.pathname.split('/').pop() ?? '', quantity: body.quantity });
      quantity = body.quantity;
    }
    const item = draftItem('part-ram-qty', 'RAM', '수량 조절 램', 90000, quantity);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...emptyDraft, items: [item], totalPrice: item.lineTotal, itemCount: quantity })
    });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });

  await page.goto('/self-quote?category=RAM');

  const panel = page.getByTestId('slot-candidate-panel');
  await expect(panel.getByText('수량 조절 램')).toBeVisible();
  await panel.getByRole('button', { name: '수량 조절 램 수량 증가' }).click();

  await expect.poll(() => patchRequests).toEqual([{ partId: 'part-ram-qty', quantity: 3 }]);
  await expect(page.getByTestId('slot-RAM').locator('[data-mini-slot-filled="true"]')).toHaveCount(3);
});

test('counts a dual-stick RAM kit as two mini slots', async ({ page }) => {
  await loginAsUser(page);

  // "32GB(16Gx2)" 킷: 상품 1개(quantity 1)지만 moduleCount=2라 스틱 2개를 차지한다.
  const kit = draftItem('part-ram-kit', 'RAM', '32GB 2개들이 킷', 180000, 1, { moduleCount: 2 });
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...emptyDraft, items: [kit], totalPrice: kit.lineTotal, itemCount: 1 })
    });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });

  await page.goto('/self-quote');

  await expect(page.getByTestId('slot-RAM').locator('[data-mini-slot-filled="true"]')).toHaveCount(2);
});

test('opens the candidate panel from the category deep link', async ({ page }) => {
  await loginAsUser(page);

  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(emptyDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [candidatePart('part-gpu-deeplink', 'GPU', '딥링크 GPU 후보')], page: 0, size: 20, total: 1 })
    });
  });

  await page.goto('/self-quote?category=GPU');

  const panel = page.getByTestId('slot-candidate-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'GPU 부품 목록' })).toBeVisible();
  await expect(page.getByTestId('slot-GPU')).toHaveAttribute('data-selected', 'true');
  await expect(panel.getByText('딥링크 GPU 후보')).toBeVisible();

  await panel.getByRole('button', { name: '후보 패널 닫기' }).click();
  await expect(page.getByTestId('slot-candidate-panel')).toHaveCount(0);
  await expect(page).toHaveURL('/self-quote');
});

// 챗봇에 "케이스 추천해줘" → 서버가 partRecommendation을 내려주면 일반 카탈로그와 분리된
// AI 추천 화면이 열린다. 전체 목록으로 넘어간 뒤에는 추천 고정 없이 일반 목록으로 동작한다.
test('챗봇 부품 추천은 간결한 AI 추천 화면을 열고 전체 목록으로 단방향 전환한다', async ({ page }) => {
  await loginAsUser(page);
  // 챗봇은 authUser로 대화 저장소 주인을 정한다 — 없으면 보내기 자체가 막힌다.
  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.authUser', JSON.stringify({
      id: 'user-part-recommend', email: 'user@example.com', name: 'Part Recommend User', role: 'USER'
    }));
  });

  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fullDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    // 서버 정렬은 가격순이라 추천 2순위가 목록 3번째로 온다 — 프론트가 다시 올려야 한다.
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          candidatePart('case-other', 'CASE', '무관한 케이스'),
          candidatePart('case-pick-1', 'CASE', '추천 케이스 1'),
          candidatePart('case-pick-2', 'CASE', '추천 케이스 2')
        ],
        page: 0,
        size: 20,
        total: 3
      })
    });
  });
  await page.route('**/api/ai/build-chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        answerType: 'PART',
        message: '내부 자산 기준으로 고른 케이스 추천 2개를 부품 목록에 띄웠어요.',
        builds: [],
        warnings: [],
        partRecommendation: {
          category: 'CASE',
          options: [
            { partId: 'case-pick-1', name: '추천 케이스 1', price: 90000 },
            { partId: 'case-pick-2', name: '추천 케이스 2', price: 120000 }
          ]
        }
      })
    });
  });

  await page.goto('/self-quote');
  await page.getByRole('textbox', { name: 'AI 챗봇에게 PC 사양 질문' }).fill('케이스 추천해줘');
  await page.getByRole('button', { name: '질문 보내기' }).click();

  // 패널이 그 카테고리로 열린다 — 사용자가 슬롯을 누르지 않았는데도.
  const panel = page.getByTestId('slot-candidate-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-view', 'AI_RECOMMENDATION');
  await expect(panel).toHaveAttribute('aria-label', 'AI 추천 케이스');
  await expect(panel.getByRole('heading', { name: 'AI 추천 케이스' })).toBeVisible();
  await expect(panel.getByText('현재 견적 기준 추천 2개')).toBeVisible();
  await expect(panel.getByTestId('candidate-ai-current-part')).toContainText('현재 케이스:');
  await expect(panel.getByTestId('candidate-ai-current-part')).toContainText('풀보드 케이스');
  await expect(page).toHaveURL('/self-quote?category=CASE');

  // 추천 화면에는 카탈로그 도구를 섞지 않고 추천 카드만 보여준다.
  const names = panel.getByTestId('slot-candidate-list').locator('[data-testid="slot-candidate-card"]');
  await expect(panel.getByTestId('candidate-panel-search')).toHaveCount(0);
  await expect(panel.getByRole('combobox', { name: '후보 정렬 기준' })).toHaveCount(0);
  await expect(panel.getByTestId('candidate-filters-toggle')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: '후보 더 보기' })).toHaveCount(0);
  await expect(panel.getByTestId('candidate-ai-picks-banner')).toHaveCount(0);
  await expect(names).toHaveCount(2);
  await expect(names.nth(0)).toContainText('추천 케이스 1');
  await expect(names.nth(1)).toContainText('추천 케이스 2');

  // 전체 목록 전환은 추천 상태를 소비한다. 일반 서버 순서를 그대로 따르고 도구를 복원한다.
  await panel.getByRole('button', { name: '전체 케이스 보기' }).click();
  await expect(panel).toHaveAttribute('data-view', 'CATALOG');
  await expect(panel).toHaveAttribute('aria-label', '케이스 부품 목록');
  await expect(panel.getByRole('heading', { name: '케이스 부품 목록' })).toBeVisible();
  await expect(panel.getByTestId('candidate-panel-search')).toBeVisible();
  await expect(panel.getByRole('combobox', { name: '후보 정렬 기준' })).toBeVisible();
  await expect(panel.getByTestId('candidate-filters-toggle')).toBeVisible();
  await expect(panel.getByTestId('candidate-ai-current-part')).toHaveCount(0);
  await expect(panel.getByTestId('candidate-panel-selected')).toBeVisible();
  await expect(names).toHaveCount(3);
  await expect(names.first()).toContainText('무관한 케이스');

  // 카탈로그 검색을 지워도 소비한 추천 화면은 다시 살아나지 않는다.
  await panel.getByTestId('candidate-search').fill('무관한');
  await expect(panel.getByText('무관한 케이스')).toBeVisible();
  await panel.getByRole('button', { name: '검색어 지우기' }).click();
  await expect(panel).toHaveAttribute('data-view', 'CATALOG');

  // 닫았다가 같은 슬롯을 수동으로 다시 열어도 오래된 추천은 복원되지 않는다.
  await panel.getByRole('button', { name: '후보 패널 닫기' }).click();
  await page.getByTestId('checklist-CASE').click();
  await expect(page.getByTestId('slot-candidate-panel')).toHaveAttribute('data-view', 'CATALOG');
});

// 목록은 가격순 20건씩 실린다 — 비싼 추천은 첫 장에 없다. 그대로 두면 챗봇이
// "부품 목록에 띄웠어요"라고 말해 놓고 화면엔 없다. 실릴 때까지 다음 장을 당겨 와야 한다.
test('첫 장에 없는 비싼 추천도 목록에 실어 맨 위로 올린다', async ({ page }) => {
  await loginAsUser(page);
  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.authUser', JSON.stringify({
      id: 'user-deep-pick', email: 'user@example.com', name: 'Deep Pick User', role: 'USER'
    }));
  });
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fullDraft) });
  });

  // 3장짜리 목록. 추천 부품은 마지막 장에만 있다(현실의 최고가 GPU 위치).
  const requestedPages: number[] = [];
  await page.route('**/api/parts**', async (route) => {
    const url = new URL(route.request().url());
    const pageParam = Number(url.searchParams.get('page') ?? '0');
    requestedPages.push(pageParam);
    const items = pageParam === 2
      ? [candidatePart('gpu-top-pick', 'GPU', '최고가 추천 GPU'), candidatePart('gpu-c', 'GPU', '평범한 GPU C')]
      : [candidatePart(`gpu-${pageParam}-a`, 'GPU', `저가 GPU ${pageParam}A`), candidatePart(`gpu-${pageParam}-b`, 'GPU', `저가 GPU ${pageParam}B`)];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items, page: pageParam, size: 2, total: 6 })
    });
  });
  await page.route('**/api/ai/build-chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        answerType: 'PART',
        message: '내부 자산 기준으로 고른 그래픽카드 추천 1개를 부품 목록에 띄웠어요.',
        builds: [],
        warnings: [],
        partRecommendation: { category: 'GPU', options: [{ partId: 'gpu-top-pick', name: '최고가 추천 GPU', price: 7168120 }] }
      })
    });
  });

  await page.goto('/self-quote');
  await page.getByRole('textbox', { name: 'AI 챗봇에게 PC 사양 질문' }).fill('GPU 추천해줘');
  await page.getByRole('button', { name: '질문 보내기' }).click();

  const panel = page.getByTestId('slot-candidate-panel');
  await expect(panel).toBeVisible();
  // 추천이 실린 장까지 스스로 당겨 오고, 추천만 보여준다.
  const names = panel.getByTestId('slot-candidate-list').locator('[data-testid="slot-candidate-card"]');
  await expect(names).toHaveCount(1);
  await expect(names.first()).toContainText('최고가 추천 GPU');
  expect(requestedPages).toContain(2);
});

test('새 AI 추천은 기존 카탈로그 검색과 찜 필터를 무시하고 고유 후보 3개만 보여준다', async ({ page }) => {
  await loginAsUser(page);
  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.authUser', JSON.stringify({
      id: 'user-filtered-pick', email: 'user@example.com', name: 'Filtered Pick User', role: 'USER'
    }));
  });
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fullDraft) });
  });
  const partRequests: URL[] = [];
  await page.route('**/api/parts**', async (route) => {
    partRequests.push(new URL(route.request().url()));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          candidatePart('gpu-other', 'GPU', '기존 검색 GPU'),
          candidatePart('gpu-pick-a', 'GPU', 'AI 추천 GPU A'),
          candidatePart('gpu-pick-b', 'GPU', 'AI 추천 GPU B'),
          candidatePart('gpu-pick-c', 'GPU', 'AI 추천 GPU C')
        ],
        page: 0,
        size: 20,
        total: 4
      })
    });
  });
  await page.route('**/api/ai/build-chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        answerType: 'PART',
        message: '내부 자산 기준으로 고른 GPU 추천을 부품 목록에 띄웠어요.',
        builds: [],
        warnings: [],
        partRecommendation: {
          category: 'GPU',
          options: [
            { partId: 'gpu-pick-c', name: 'AI 추천 GPU C', price: 300000 },
            { partId: 'gpu-pick-a', name: 'AI 추천 GPU A', price: 100000 },
            { partId: 'gpu-pick-b', name: 'AI 추천 GPU B', price: 200000 },
            { partId: 'gpu-pick-c', name: 'AI 추천 GPU C', price: 300000 }
          ]
        }
      })
    });
  });

  await page.goto('/self-quote?category=GPU');
  const panel = page.getByTestId('slot-candidate-panel');
  await panel.getByTestId('candidate-search').fill('기존 검색');
  await expect.poll(() => partRequests.some((url) => url.searchParams.get('q') === '기존 검색')).toBe(true);
  await panel.getByTestId('candidate-filters-toggle').click();
  await panel.getByTestId('candidate-only-wishlist').check();

  const input = page.getByRole('textbox', { name: 'AI 챗봇에게 PC 사양 질문' });
  await input.fill('고성능 GPU 추천해줘');
  await page.getByRole('button', { name: '질문 보내기' }).click();

  await expect(panel).toHaveAttribute('data-view', 'AI_RECOMMENDATION');
  await expect(panel.getByText('현재 견적 기준 추천 3개')).toBeVisible();
  await expect(panel.getByTestId('candidate-panel-search')).toHaveCount(0);
  await expect(panel.getByTestId('candidate-filters-toggle')).toHaveCount(0);
  const cards = panel.getByTestId('slot-candidate-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText('AI 추천 GPU C');
  await expect(cards.nth(1)).toContainText('AI 추천 GPU A');
  await expect(cards.nth(2)).toContainText('AI 추천 GPU B');
  await expect.poll(() => partRequests[partRequests.length - 1]?.searchParams.get('q') ?? null).toBeNull();

  // 추천 화면을 닫으면 해당 추천은 소비되어 수동 재진입에서 되살아나지 않는다.
  await panel.getByRole('button', { name: '후보 패널 닫기' }).click();
  await page.getByTestId('checklist-GPU').click();
  await expect(page.getByTestId('slot-candidate-panel')).toHaveAttribute('data-view', 'CATALOG');
});

test('추천 ID 일부를 10페이지 안에서 찾지 못하면 로딩을 끝내고 부분 표시를 안내한다', async ({ page }) => {
  await loginAsUser(page);
  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.authUser', JSON.stringify({
      id: 'user-partial-pick', email: 'user@example.com', name: 'Partial Pick User', role: 'USER'
    }));
  });
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(emptyDraft) });
  });
  const requestedPages: number[] = [];
  await page.route('**/api/parts**', async (route) => {
    const pageNumber = Number(new URL(route.request().url()).searchParams.get('page') ?? '0');
    requestedPages.push(pageNumber);
    const items = pageNumber === 0
      ? [candidatePart('gpu-visible-pick', 'GPU', '표시 가능한 추천 GPU')]
      : [candidatePart(`gpu-filler-${pageNumber}`, 'GPU', `일반 GPU ${pageNumber}`)];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items, page: pageNumber, size: 20, total: 220 })
    });
  });
  await page.route('**/api/ai/build-chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        answerType: 'PART',
        message: 'GPU 추천 2개를 부품 목록에 띄웠어요.',
        builds: [],
        warnings: [],
        partRecommendation: {
          category: 'GPU',
          options: [
            { partId: 'gpu-visible-pick', name: '표시 가능한 추천 GPU', price: 100000 },
            { partId: 'gpu-outside-limit', name: '찾지 못한 추천 GPU', price: 200000 }
          ]
        }
      })
    });
  });

  await page.goto('/self-quote');
  await page.getByRole('textbox', { name: 'AI 챗봇에게 PC 사양 질문' }).fill('GPU 추천해줘');
  await page.getByRole('button', { name: '질문 보내기' }).click();

  const panel = page.getByTestId('slot-candidate-panel');
  await expect(panel.getByTestId('candidate-ai-picks-incomplete')).toContainText('추천 2개 중 1개를 표시했습니다');
  await expect(panel.getByText('표시 가능한 추천 GPU')).toBeVisible();
  await expect(panel.getByText('AI 추천 부품을 불러오는 중입니다.')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: '후보 더 보기' })).toHaveCount(0);
  expect(requestedPages).toEqual(expect.arrayContaining([0, 9]));
  expect(Math.max(...requestedPages)).toBe(9);
});

test('추천 추가 페이지 조회가 실패하면 재요청을 멈추고 실패 안내로 전환한다', async ({ page }) => {
  test.setTimeout(20000);
  await loginAsUser(page);
  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.authUser', JSON.stringify({
      id: 'user-pick-page-error', email: 'user@example.com', name: 'Pick Page Error User', role: 'USER'
    }));
  });
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(emptyDraft) });
  });
  let failedPageRequests = 0;
  await page.route('**/api/parts**', async (route) => {
    const pageNumber = Number(new URL(route.request().url()).searchParams.get('page') ?? '0');
    if (pageNumber > 0) {
      failedPageRequests += 1;
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'PAGE_LOAD_FAILED' }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [candidatePart('gpu-page-error-other', 'GPU', '일반 GPU')], page: 0, size: 20, total: 40 })
    });
  });
  await page.route('**/api/ai/build-chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        answerType: 'PART',
        message: 'GPU 추천 1개를 부품 목록에 띄웠어요.',
        builds: [],
        warnings: [],
        partRecommendation: {
          category: 'GPU',
          options: [{ partId: 'gpu-page-error-pick', name: '추가 페이지 추천 GPU', price: 500000 }]
        }
      })
    });
  });

  await page.goto('/self-quote');
  await page.getByRole('textbox', { name: 'AI 챗봇에게 PC 사양 질문' }).fill('GPU 추천해줘');
  await page.getByRole('button', { name: '질문 보내기' }).click();

  const panel = page.getByTestId('slot-candidate-panel');
  await expect(panel.getByTestId('candidate-ai-picks-incomplete')).toContainText('추천 부품을 불러오지 못했습니다', { timeout: 15000 });
  await expect(panel.getByText('AI 추천 부품을 불러오는 중입니다.')).toHaveCount(0);
  expect(failedPageRequests).toBeGreaterThan(0);
  expect(failedPageRequests).toBeLessThanOrEqual(4);
});

test('AI 추천 패널에서 브라우저 뒤로가기를 하면 이전 추천을 소비한다', async ({ page }) => {
  await loginAsUser(page);
  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.authUser', JSON.stringify({
      id: 'user-pick-history', email: 'user@example.com', name: 'Pick History User', role: 'USER'
    }));
  });
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fullDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [candidatePart('gpu-history-pick', 'GPU', '뒤로가기 추천 GPU')], page: 0, size: 20, total: 1 })
    });
  });
  await page.route('**/api/ai/build-chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        answerType: 'PART',
        message: 'GPU 추천 1개를 부품 목록에 띄웠어요.',
        builds: [],
        warnings: [],
        partRecommendation: {
          category: 'GPU',
          options: [{ partId: 'gpu-history-pick', name: '뒤로가기 추천 GPU', price: 500000 }]
        }
      })
    });
  });

  await page.goto('/self-quote');
  await page.getByRole('textbox', { name: 'AI 챗봇에게 PC 사양 질문' }).fill('GPU 추천해줘');
  await page.getByRole('button', { name: '질문 보내기' }).click();
  await expect(page.getByTestId('slot-candidate-panel')).toHaveAttribute('data-view', 'AI_RECOMMENDATION');

  await page.goBack();
  await expect(page).toHaveURL('/self-quote');
  await page.getByTestId('checklist-GPU').click();
  await expect(page.getByTestId('slot-candidate-panel')).toHaveAttribute('data-view', 'CATALOG');
});

test('같은 카테고리의 새 AI 추천을 본 뒤 전체 목록에서 기존 검색어를 복원한다', async ({ page }) => {
  await loginAsUser(page);
  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.authUser', JSON.stringify({
      id: 'user-pick-query', email: 'user@example.com', name: 'Pick Query User', role: 'USER'
    }));
  });
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fullDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [candidatePart('gpu-query-pick', 'GPU', '검색 복원 추천 GPU')], page: 0, size: 20, total: 1 })
    });
  });
  await page.route('**/api/ai/build-chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        answerType: 'PART',
        message: 'GPU 추천 1개를 부품 목록에 띄웠어요.',
        builds: [],
        warnings: [],
        partRecommendation: {
          category: 'GPU',
          options: [{ partId: 'gpu-query-pick', name: '검색 복원 추천 GPU', price: 500000 }]
        }
      })
    });
  });

  await page.goto('/self-quote?category=GPU&q=5090');
  await page.getByRole('textbox', { name: 'AI 챗봇에게 PC 사양 질문' }).fill('고성능 GPU 추천해줘');
  await page.getByRole('button', { name: '질문 보내기' }).click();

  const panel = page.getByTestId('slot-candidate-panel');
  await expect(panel).toHaveAttribute('data-view', 'AI_RECOMMENDATION');
  await expect(page).toHaveURL('/self-quote?category=GPU&q=5090');
  await panel.getByRole('button', { name: '전체 GPU 보기' }).click();
  await expect(panel.getByTestId('candidate-search')).toHaveValue('5090');
});

// 이미 그 카테고리 패널이 열려 있으면 주소가 안 바뀐다 — 리마운트도 카테고리 변경도 없어서
// 신호가 없으면 "띄웠어요"라고 말해 놓고 목록은 한 글자도 안 바뀐다.
test('패널이 열려 있는 채로 다시 추천해도 새 추천 순서를 반영한다', async ({ page }) => {
  await loginAsUser(page);
  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.authUser', JSON.stringify({
      id: 'user-repeat-pick', email: 'user@example.com', name: 'Repeat Pick User', role: 'USER'
    }));
  });
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fullDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          candidatePart('case-a', 'CASE', '케이스 A'),
          candidatePart('case-b', 'CASE', '케이스 B'),
          candidatePart('case-c', 'CASE', '케이스 C')
        ],
        page: 0,
        size: 20,
        total: 3
      })
    });
  });
  let turn = 0;
  await page.route('**/api/ai/build-chat', async (route) => {
    turn += 1;
    const partId = turn === 1 ? 'case-b' : 'case-c';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        answerType: 'PART',
        message: `내부 자산 기준으로 고른 케이스 추천 1개를 부품 목록에 띄웠어요. (${turn})`,
        builds: [],
        warnings: [],
        partRecommendation: { category: 'CASE', options: [{ partId, name: partId, price: 90000 }] }
      })
    });
  });

  // 사용자가 슬롯을 직접 눌러 패널을 먼저 열어 둔 상태에서 묻는 동선이다.
  await page.goto('/self-quote?category=CASE');
  const panel = page.getByTestId('slot-candidate-panel');
  await expect(panel).toBeVisible();
  const names = panel.getByTestId('slot-candidate-list').locator('[data-testid="slot-candidate-card"]');
  await expect(names.first()).toContainText('케이스 A');

  const input = page.getByRole('textbox', { name: 'AI 챗봇에게 PC 사양 질문' });
  const send = page.getByRole('button', { name: '질문 보내기' });
  await input.fill('케이스 추천해줘');
  await send.click();
  await expect(panel).toHaveAttribute('data-view', 'AI_RECOMMENDATION');
  await expect(panel.getByRole('heading', { name: 'AI 추천 케이스' })).toBeVisible();
  await expect(names.first()).toContainText('케이스 B');

  // 조건을 바꿔 다시 묻는 것이 가장 흔한 후속 동작이다 — 이때도 갱신돼야 한다.
  await input.fill('다른 케이스로 추천해줘');
  await send.click();
  await expect(names.first()).toContainText('케이스 C');

  // 전체 목록으로 명시적으로 전환한 뒤에만 카탈로그 정렬을 제공한다.
  await panel.getByRole('button', { name: '전체 케이스 보기' }).click();
  await expect(panel).toHaveAttribute('data-view', 'CATALOG');
  await panel.getByRole('combobox', { name: '후보 정렬 기준' }).selectOption('price_desc');
  await expect(names.first()).toContainText('케이스 A');
});

// 부품 목록 패널은 "가져다 놓고 쓰는 창"이다 — 옮기고 키운 자리를 새로고침 뒤에도,
// 다른 부품 카테고리로 열어도 그대로 지켜야 매번 다시 맞추지 않는다.
test('부품 목록 패널의 자리와 크기는 새로고침과 카테고리 전환을 넘어 남는다', async ({ page }) => {
  await loginAsUser(page);
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fullDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });

  await page.goto('/self-quote?category=CPU');
  const panel = page.getByTestId('slot-candidate-panel');
  await expect(panel).toBeVisible();
  const before = await panel.boundingBox();
  if (!before) throw new Error('패널 위치를 잴 수 없습니다');

  // 헤더를 잡아 옮긴다.
  const handle = page.getByTestId('slot-candidate-panel-handle');
  const grip = await handle.boundingBox();
  if (!grip) throw new Error('패널 핸들 위치를 잴 수 없습니다');
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 8);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 140, grip.y + 8 + 60, { steps: 8 });
  await page.mouse.up();

  // 네이티브 [resize:both] 모서리는 스크립트로 끌 수 없다 — 인라인 크기를 바꿔
  // 같은 경로(ResizeObserver)를 태운다. 관찰 후 저장까지 디바운스 200ms를 기다린다.
  await panel.evaluate((el) => {
    (el as HTMLElement).style.width = '520px';
    (el as HTMLElement).style.height = '600px';
  });
  await expect.poll(async () => (await panel.boundingBox())?.width).toBe(520);
  await page.waitForTimeout(400);

  const moved = await panel.boundingBox();
  if (!moved) throw new Error('옮긴 뒤 패널 위치를 잴 수 없습니다');
  expect(Math.round(moved.x - before.x)).toBeGreaterThan(100);

  // 새로고침해도, 다른 부품으로 열어도 그 자리 그 크기다.
  await page.goto('/self-quote?category=CASE');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: '케이스 부품 목록' })).toBeVisible();
  // 등장 애니메이션이 끝난 뒤의 자리를 본다.
  await expect.poll(async () => {
    const box = await panel.boundingBox();
    return box ? [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)] : null;
  }).toEqual([Math.round(moved.x), Math.round(moved.y), 520, 600]);

  // 핸들 더블클릭 = 기억을 버리고 기본 자리·기본 크기로.
  await handle.dblclick();
  await expect.poll(async () => Math.round(((await panel.boundingBox())?.width) ?? 0)).not.toBe(520);

  // 되돌리기가 만드는 크기 변화도 ResizeObserver에 배달된다 — 그걸 사용자 리사이즈로 오해하면
  // 200ms 뒤 방금 지운 자리를 되살려 써서, 유일한 수동 해제 수단이 새로고침을 못 넘긴다.
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => localStorage.getItem('buildgraph.boardPlacement.slot-candidate-panel'))).toBeNull();
  await page.goto('/self-quote?category=CASE');
  await expect(panel).toBeVisible();
  await expect.poll(async () => Math.round(((await panel.boundingBox())?.width) ?? 0)).not.toBe(520);
});

test('redirects logged-out slot board access to login', async ({ page }) => {
  await page.goto('/self-quote');

  // 기존 인증 정책 유지: 비로그인 진입은 로그인으로 리다이렉트된다.
  await expect(page).toHaveURL('/login?redirect=%2Fself-quote');
  await expect(page.getByRole('heading', { name: '로그인' })).toBeVisible();
});

test('keeps the slot board usable on mobile width with a bottom sheet panel', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsUser(page);
  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.selfQuote.slotBoardVisualMode', 'isometric');
    localStorage.setItem('buildgraph.selfQuote.slotBoardOverlaysVisible', 'false');
  });

  // 관계 팝오버 분기를 결정적으로: PASS 그래프를 명시해 정상(초록) 변형을 검증한다.
  await page.route('**/api/build-graphs/resolve', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildGraphResponse()) });
  });
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...emptyDraft,
        items: [draftItem('part-mobile-gpu-test', 'GPU', '모바일 RTX 테스트', 890000)],
        totalPrice: 890000,
        itemCount: 1
      })
    });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [candidatePart('part-mobile-gpu-candidate', 'GPU', '모바일 후보 GPU')], page: 0, size: 20, total: 1 })
    });
  });

  await page.goto('/self-quote');

  await expect(page.getByTestId('slot-board')).toBeVisible();
  await expect(page.getByTestId('slot-board')).toHaveAttribute('data-visual-mode', 'motherboard');
  await expect(page.getByRole('radiogroup', { name: '보드 보기 방식' })).toHaveCount(0);
  await expect(page.getByRole('switch', { name: '보드 정보 표시' })).toHaveCount(0);
  await expect(page.getByTestId('slot-board-motherboard-art')).toHaveCount(0);
  await expect(page.getByTestId('iso-part-GPU')).toHaveCount(0);
  await expect(page.getByTestId('checklist-GPU')).toContainText('모바일 RTX 테스트');
  await expect(page.getByTestId('slot-GPU')).toHaveAttribute('title', '모바일 RTX 테스트');
  await expect(page.getByTestId('quote-summary-bar')).toBeVisible();

  // 장착 부품 클릭 = 관계/문제 설명 팝오버(픽스처의 GPU-파워 엣지가 WARN → 사유 표시),
  // 후보 패널은 팝오버의 교체 버튼으로 진입한다.
  await page.getByTestId('slot-GPU').click();
  const relationPopover = page.getByTestId('slot-problem-popover');
  await expect(relationPopover).toBeVisible();
  await expect(relationPopover).toContainText('간섭 주의');
  await relationPopover.getByRole('button', { name: '교체 후보 보기' }).click();
  await expect(relationPopover).toHaveCount(0);
  const panel = page.getByTestId('slot-candidate-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('모바일 후보 GPU')).toBeVisible();

  const panelBox = await panel.boundingBox();
  expect(panelBox).not.toBeNull();
  expect(panelBox?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((panelBox?.x ?? 0) + (panelBox?.width ?? 0)).toBeLessThanOrEqual(391);
  await expect.poll(async () => {
    const settledBox = await panel.boundingBox();
    return Math.abs(((settledBox?.y ?? 0) + (settledBox?.height ?? 0)) - 844);
  }).toBeLessThanOrEqual(1);

  const hasBodyOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(hasBodyOverflow).toBe(false);
});

test('keeps the AI recommendation header and catalog action inside a 320px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await loginAsUser(page);
  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.authUser', JSON.stringify({
      id: 'user-mobile-ai-picks', email: 'user@example.com', name: 'Mobile AI Pick User', role: 'USER'
    }));
  });
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fullDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          candidatePart('mobile-ai-gpu-a', 'GPU', '모바일 AI 추천 그래픽카드 A'),
          candidatePart('mobile-ai-gpu-b', 'GPU', '모바일 AI 추천 그래픽카드 B'),
          candidatePart('mobile-ai-gpu-c', 'GPU', '모바일 AI 추천 그래픽카드 C')
        ],
        page: 0,
        size: 20,
        total: 3
      })
    });
  });
  await page.route('**/api/ai/build-chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        answerType: 'PART',
        message: 'GPU 추천 3개를 부품 목록에 띄웠어요.',
        builds: [],
        warnings: [],
        partRecommendation: {
          category: 'GPU',
          options: [
            { partId: 'mobile-ai-gpu-a', name: '모바일 AI 추천 그래픽카드 A', price: 100000 },
            { partId: 'mobile-ai-gpu-b', name: '모바일 AI 추천 그래픽카드 B', price: 200000 },
            { partId: 'mobile-ai-gpu-c', name: '모바일 AI 추천 그래픽카드 C', price: 300000 }
          ]
        }
      })
    });
  });

  await page.goto('/self-quote');
  await page.getByRole('textbox', { name: 'AI 챗봇에게 PC 사양 질문' }).fill('고성능 GPU 추천해줘');
  await page.getByRole('button', { name: '질문 보내기' }).click();

  const panel = page.getByTestId('slot-candidate-panel');
  await expect(panel.getByRole('heading', { name: 'AI 추천 GPU' })).toBeVisible();
  await expect(panel.getByRole('button', { name: '전체 GPU 보기' })).toBeVisible();
  await expect(panel.getByTestId('candidate-ai-current-part')).toContainText('현재 GPU:');
  const panelBox = await panel.boundingBox();
  expect(panelBox).not.toBeNull();
  expect(panelBox?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((panelBox?.x ?? 0) + (panelBox?.width ?? 0)).toBeLessThanOrEqual(321);
  const hasBodyOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(hasBodyOverflow).toBe(false);
});

test('opens checkout from self quote purchase CTA without using the build result route', async ({ page }) => {
  await loginAsUser(page);

  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(checkoutDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });

  await page.goto('/self-quote');

  const purchaseLink = page.getByTestId('quote-checkout-actions').getByRole('link', { name: '구매하기' });
  await expect(purchaseLink).toHaveAttribute('href', '/checkout');
  await purchaseLink.click();

  await expect(page).toHaveURL('/checkout');
  await expect(page).not.toHaveURL(/\/builds\/00000000-0000-4000-8000-000000002001/);
});

test('saves current self quote slots into my quotes', async ({ page }) => {
  const saveRequests: unknown[] = [];
  await loginAsUser(page);

  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(checkoutDraft) });
  });
  await page.route('**/api/builds/from-chat', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    saveRequests.push(body);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'saved-self-quote-build' }) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });

  await page.goto('/self-quote');
  const statusBar = page.getByTestId('slot-status-bar');
  await page.getByTestId('quote-checkout-actions').getByRole('button', { name: '내 견적함에 추가' }).click();

  await expect.poll(() => saveRequests.length).toBe(1);
  expect(saveRequests[0]).toMatchObject({
    sourceBuildId: 'self-quote-draft-checkout-test',
    lastUserMessage: '셀프 견적에서 저장',
    build: {
      id: 'self-quote-draft-checkout-test',
      title: '셀프 견적 저장 조합',
      totalPrice: 1_400_000,
      items: [
        { partId: 'part-checkout-gpu', category: 'GPU', quantity: 1, price: 980_000 },
        { partId: 'part-checkout-cpu', category: 'CPU', quantity: 1, price: 420_000 }
      ]
    }
  });
  // 저장 후 현재 화면을 유지한 채 성공 메시지와 내 견적함 링크를 보여준다.
  await expect(page).toHaveURL('/self-quote');
  await expect(statusBar.getByText('내 견적함에 추가했습니다.')).toBeVisible();
  await expect(statusBar.getByRole('link', { name: '내 견적함 보기' })).toHaveAttribute('href', '/my/quotes');
});

test('shows save failure feedback while keeping the current self quote', async ({ page }) => {
  await loginAsUser(page);
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(checkoutDraft) });
  });
  await page.route('**/api/builds/from-chat', async (route) => {
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'save failed' }) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });

  await page.goto('/self-quote');
  await page.getByTestId('quote-checkout-actions').getByRole('button', { name: '내 견적함에 추가' }).click();

  const statusBar = page.getByTestId('slot-status-bar');
  await expect(statusBar.getByText('견적을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.')).toBeVisible();
  await expect(page).toHaveURL('/self-quote');
  await expect(page.getByTestId('checklist-GPU')).toContainText('RTX 5070 구매 테스트');
});

test('persists an assembly request, selects an offer, and pays points after Toss authentication', async ({ page }) => {
  const quoteDraftMethods: string[] = [];
  const requestId = '00000000-0000-4000-8000-000000020001';
  const longMessage = '플랫폼 제안 메시지 '.repeat(40).slice(0, 500);
  let requestStatus = 'OFFERED';
  let selectedOfferId: string | null = null;
  let paymentStatus: string | null = null;
  let selectRequestCount = 0;
  let selectPostData: string | null = null;
  let detailRequestCount = 0;
  const assemblyResponse = () => ({
    id: requestId,
    requestNo: 'ASM-20990720-TEST0001',
    status: requestStatus,
    serviceType: 'FULL_SERVICE',
    region: '서울',
    preferredDate: '2099-07-20',
    deliveryMethod: 'DELIVERY',
    note: '',
    asPolicyAccepted: true,
    estimatedPartsPrice: 1_400_000,
    itemCount: 2,
    selectedOfferId,
    canCancel: true,
    items: checkoutDraft.items.map((item) => ({ partId: item.partId, category: item.category, name: item.name, manufacturer: item.manufacturer, quantity: item.quantity, unitPrice: item.currentPrice, lineTotal: item.lineTotal, externalOffer: item.externalOffer })),
    offers: [
      { id: 'offer-balanced', technicianId: 'tech-1', technicianName: '박준호 기사', initials: '박', rating: 4.9, completedJobs: 184, responseMinutes: 12, specialties: ['고성능 게이밍 PC'], standardAsAccepted: true, providerType: 'INTERNAL', verified: true, status: selectedOfferId === 'offer-balanced' ? 'SELECTED' : selectedOfferId ? 'EXPIRED' : 'AVAILABLE', confirmedPartsPrice: 1_400_000, assemblyFee: 65_000, deliveryFee: 99_000, finalPrice: 1_470_000, leadTimeDays: 2, stockStatus: '주요 부품 재고 확인', warrantyDays: 0, message: longMessage, note: null },
      { id: 'offer-fast', technicianId: 'tech-2', technicianName: '김도윤 기사', initials: '김', rating: 4.8, completedJobs: 132, responseMinutes: 8, specialties: ['당일 조립'], standardAsAccepted: true, providerType: 'INTERNAL', verified: true, status: selectedOfferId ? 'EXPIRED' : 'AVAILABLE', confirmedPartsPrice: 1_400_000, assemblyFee: 80_000, deliveryFee: 15_000, finalPrice: 1_480_000, leadTimeDays: 1, stockStatus: '주요 부품 재고 확인', warrantyDays: 365, message: null, note: '플랫폼 호환 메시지' },
      { id: 'offer-silent', technicianId: 'tech-3', technicianName: '최민석 기사', initials: '최', rating: 5, completedJobs: 96, responseMinutes: 18, specialties: ['저소음'], standardAsAccepted: true, providerType: 'EXTERNAL', verified: true, status: selectedOfferId ? 'EXPIRED' : 'AVAILABLE', confirmedPartsPrice: 1_400_000, assemblyFee: 95_000, deliveryFee: 20_000, finalPrice: 1_495_000, leadTimeDays: 3, stockStatus: '주요 부품 재고 확인', warrantyDays: 30, message: '정식 사용자 공개 메시지\n선 정리까지 포함합니다.', note: 'LEGACY_MESSAGE_SHOULD_NOT_RENDER', adminNote: 'ADMIN_SECRET_RFQ_4B1' }
    ],
    payment: paymentStatus ? {
      id: 'payment-1',
      amount: 1_470_000,
      paidAmount: paymentStatus === 'PAID' ? 1_470_000 : 0,
      currency: 'KRW',
      provider: paymentStatus === 'PAID' ? 'BUILDGRAPH_POINT' : 'LEGACY_VIRTUAL',
      method: paymentStatus === 'PAID' ? 'POINT' : 'VIRTUAL',
      status: paymentStatus
    } : null,
    statusHistory: [{ fromStatus: null, toStatus: 'REQUESTED', note: '조립 요청 등록' }]
  });
  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.token', 'jwt-user-token');
  });

  await page.route('**/api/quote-drafts/current**', async (route) => {
    quoteDraftMethods.push(route.request().method());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(checkoutDraft)
    });
  });
  await page.route('**/api/build-graphs/resolve', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ mode: 'BUILD_OVERVIEW', summary: '호환 가능', nodes: [], edges: [], focusNodeIds: [], insights: [], toolResults: [] })
    });
  });
  await page.route('**/api/users/me/points', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'point-wallet-1', name: '포인트', balance: 50_000_000, pointValueWon: 1, currency: 'KRW' })
    });
  });
  await page.route('**/api/assembly-requests**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (method === 'GET' && url.endsWith(`/api/assembly-requests/${requestId}`)) {
      detailRequestCount += 1;
    }
    if (method === 'POST' && url.endsWith('/api/assembly-requests')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(assemblyResponse()) });
      return;
    }
    if (method === 'POST' && url.endsWith('/offers/offer-balanced/select')) {
      selectRequestCount += 1;
      selectPostData = route.request().postData();
      await new Promise((resolve) => setTimeout(resolve, 250));
      selectedOfferId = 'offer-balanced';
      requestStatus = 'MATCHED';
      paymentStatus = 'PENDING';
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(assemblyResponse()) });
      return;
    }
    if (method === 'POST' && url.endsWith('/payments/points/confirm')) {
      paymentStatus = 'PAID';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          attempt: {
            id: '00000000-0000-4000-8000-000000020011',
            provider: 'BUILDGRAPH_POINT',
            merchantPaymentId: 'POINT-test-payment',
            payMethod: 'POINT',
            requestedAmount: 1_470_000,
            approvedAmount: 1_470_000,
            currency: 'KRW',
            status: 'SUCCEEDED',
            expiresAt: '2099-07-20T12:00:00+09:00'
          },
          wallet: { id: 'point-wallet-1', name: '포인트', balance: 48_530_000, pointValueWon: 1, currency: 'KRW' }
        })
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(assemblyResponse()) });
  });
  await mockKakaoPostcode(page);

  await page.goto('/checkout');

  await expect(page.getByRole('heading', { name: '조립 견적 요청' })).toBeVisible();
  await expect(page.getByText('예상가', { exact: true })).toBeVisible();
  await expect(page.getByText('최종 견적 금액', { exact: true })).toHaveCount(0);
  await expect(page.getByText('조립 대상 부품 2개')).toBeVisible();
  await expect(page.getByText('RTX 5070 구매 테스트')).toBeVisible();
  await expect(page.getByText('Ryzen 7 구매 테스트')).toBeVisible();
  await expect(page.getByText('1,400,000원').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'RTX 5070 구매 테스트 구매처 이동' })).toHaveAttribute('href', 'https://example.test/checkout-gpu');
  await expect(page.getByRole('button', { name: 'Ryzen 7 구매 테스트 구매처 정보 없음' })).toBeDisabled();

  await page.getByLabel('조립 지역').selectOption('서울');
  await page.getByLabel('희망 일정').fill('2099-07-20');
  await page.getByLabel('수령인').fill('데모 사용자');
  await page.getByLabel('연락처').fill('010-1234-5678');
  await selectCheckoutAddress(page);
  await page.getByLabel('상세 주소').fill('101동 1004호');
  await page.getByRole('checkbox', { name: /Dazzajo 표준 AS 정책 적용에 동의합니다/ }).check();
  await page.getByRole('button', { name: '기사 제안 요청하기' }).click();

  await expect(page).toHaveURL(`/checkout/offers/${requestId}`);
  await expect(page.getByRole('heading', { name: '기사 제안 3건' })).toBeVisible();
  const registeredSection = page.getByTestId('external-offer-section');
  const platformSection = page.getByTestId('internal-offer-section');
  await expect(registeredSection.getByRole('heading', { name: '등록 기사 제안' })).toBeVisible();
  await expect(platformSection.getByRole('heading', { name: '플랫폼 즉시 제안', level: 2 })).toBeVisible();
  await expect(registeredSection.locator('article')).toHaveCount(1);
  await expect(platformSection.locator('article')).toHaveCount(2);
  await expect(registeredSection).toContainText('최민석 기사');
  await expect(registeredSection).not.toContainText('플랫폼 자동 제안');
  await expect(platformSection).not.toContainText('최민석 기사');
  await expect(platformSection).toContainText('플랫폼 자동 제안');
  await expect(registeredSection).toContainText('30일 보증');
  await expect(platformSection).toContainText('보증 없음');
  await expect(platformSection).toContainText('365일 보증');
  await expect(registeredSection).toContainText('정식 사용자 공개 메시지');
  await expect(registeredSection).not.toContainText('LEGACY_MESSAGE_SHOULD_NOT_RENDER');
  await expect(page.getByText('ADMIN_SECRET_RFQ_4B1')).toHaveCount(0);
  await expect(platformSection).toContainText(longMessage);
  await expect(page.getByText('99,000원')).toHaveCount(0);

  const balancedOffer = platformSection.locator('article').filter({ hasText: '1,470,000원' });
  await balancedOffer.getByRole('button', { name: '이 제안 선택' }).click();
  await expect(balancedOffer.getByRole('button', { name: '선택됨' })).toBeVisible();
  const selectedSummary = page.locator('aside').filter({ hasText: '선택 제안' });
  await expect(selectedSummary.getByText('배송 조건')).toBeVisible();
  await expect(selectedSummary.getByText('작업 확정 후 별도 안내')).toBeVisible();
  await page.getByRole('button', { name: '선택한 제안 승인' }).click();
  await expect(balancedOffer.getByRole('button', { name: '선택 중...' })).toBeVisible();
  await expect(platformSection.getByRole('button', { name: '이 제안 선택' })).toBeDisabled();
  await expect(page).toHaveURL(`/checkout/payment/${requestId}`);
  expect(selectRequestCount).toBe(1);
  expect(selectPostData).toBeNull();
  expect(detailRequestCount).toBeGreaterThanOrEqual(1);
  await page.reload();
  await expect(page.getByText('플랫폼 즉시 제안')).toBeVisible();
  await expect(page.getByRole('button', { name: '결제하기', exact: true })).toBeVisible();
  await expect(page.getByText('부품 스냅샷 금액')).toBeVisible();
  await expect(page.getByText('1,400,000원')).toBeVisible();
  await expect(page.getByText('조립 공임')).toBeVisible();
  await expect(page.getByText('65,000원')).toBeVisible();
  await expect(page.getByText('배송 조건은 작업 확정 후 별도로 안내됩니다.')).toBeVisible();
  await expect(page.getByText('99,000원')).toHaveCount(0);
  await expect(page.getByText('1,470,000원')).toBeVisible();
  await page.goto(`/checkout/toss/success/${requestId}?paymentType=NORMAL&paymentKey=test_payment_key&orderId=${requestId}&amount=1470000`);

  await expect(page).toHaveURL(`/checkout/complete/${requestId}`);
  await expect(page.getByRole('heading', { name: '조립 요청 진행 상태' })).toBeVisible();
  await expect(page.getByText('ASM-20990720-TEST0001')).toBeVisible();
  await expect(page.getByText('1,470,000원')).toBeVisible();
  await expect(page.getByText('Dazzajo 표준 AS 적용')).toBeVisible();
  await expect(page.getByText('보증 기간')).toBeVisible();
  await expect(page.getByText('보증 없음')).toBeVisible();
  expect(quoteDraftMethods.every((method) => method === 'GET')).toBe(true);
});

test('refreshes stale offer state and shows a toast when selection conflicts', async ({ page }) => {
  const requestId = '00000000-0000-4000-8000-000000020021';
  let latestState = false;
  let detailRequestCount = 0;
  const offer = {
    id: 'offer-conflict',
    technicianId: 'tech-conflict',
    technicianName: '경합 확인 기사',
    initials: '경',
    rating: 4.8,
    completedJobs: 48,
    responseMinutes: 12,
    specialties: ['게이밍 PC'],
    standardAsAccepted: true,
    providerType: 'EXTERNAL',
    verified: true,
    status: latestState ? 'SELECTED' : 'AVAILABLE',
    confirmedPartsPrice: 1_400_000,
    assemblyFee: 70_000,
    deliveryFee: 30_000,
    finalPrice: 1_470_000,
    leadTimeDays: 2,
    stockStatus: '재고 확인 완료',
    warrantyDays: 30,
    message: '경합 테스트 제안',
    note: null
  };
  const response = () => ({
    id: requestId,
    requestNo: 'ASM-RFQ-CONFLICT',
    status: latestState ? 'MATCHED' : 'OFFERED',
    serviceType: 'FULL_SERVICE',
    region: '서울',
    preferredDate: '2099-07-20',
    deliveryMethod: 'DELIVERY',
    note: '',
    asPolicyAccepted: true,
    estimatedPartsPrice: 1_400_000,
    itemCount: 2,
    selectedOfferId: latestState ? offer.id : null,
    canCancel: !latestState,
    items: [],
    offers: [{ ...offer, status: latestState ? 'SELECTED' : 'AVAILABLE' }],
    payment: latestState ? { id: 'payment-conflict', amount: 1_470_000, paidAmount: 0, currency: 'KRW', provider: 'LEGACY_VIRTUAL', method: 'VIRTUAL', status: 'PENDING' } : null,
    statusHistory: []
  });

  await loginAsUser(page);
  await page.route('**/api/assembly-requests**', async (route) => {
    const method = route.request().method();
    const url = route.request().url();
    if (method === 'POST' && url.endsWith(`/offers/${offer.id}/select`)) {
      latestState = true;
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'CONFLICT_STATE', message: '이미 다른 변경이 반영됨' })
      });
      return;
    }
    if (method === 'GET' && url.endsWith(`/api/assembly-requests/${requestId}`)) {
      detailRequestCount += 1;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response()) });
  });

  await page.goto(`/checkout/offers/${requestId}`);
  await page.getByTestId('external-offer-section').getByRole('button', { name: '이 기사 선택' }).click();
  await page.getByRole('button', { name: '선택한 제안 승인' }).click();

  await expect(page.getByTestId('mutation-toast')).toContainText('다른 변경이 먼저 반영되었습니다. 최신 제안 상태를 다시 불러왔습니다.');
  await expect(page).toHaveURL(`/checkout/offers/${requestId}`);
  await expect.poll(() => detailRequestCount).toBeGreaterThanOrEqual(2);
  await expect(page.getByRole('link', { name: '결제 상태 확인' })).toBeVisible();
  await expect(page.getByTestId('external-offer-section').getByRole('button', { name: '선택됨' })).toBeDisabled();
});

test('uses only the server payment amount for an assembly-only request', async ({ page }) => {
  const requestId = '00000000-0000-4000-8000-000000020022';
  const offer = {
    id: 'offer-assembly-only',
    technicianId: 'tech-assembly-only',
    technicianName: '조립 전용 기사',
    initials: '조',
    rating: 4.9,
    completedJobs: 77,
    responseMinutes: 9,
    specialties: ['조립 전용'],
    standardAsAccepted: true,
    providerType: 'EXTERNAL',
    verified: true,
    status: 'SELECTED',
    confirmedPartsPrice: 0,
    assemblyFee: 70_000,
    deliveryFee: 20_000,
    finalPrice: 70_000,
    leadTimeDays: 1,
    stockStatus: '사용자 준비 부품 확인',
    warrantyDays: 30,
    message: '사용자 준비 부품을 조립합니다.',
    note: null
  };
  const request = {
    id: requestId,
    requestNo: 'ASM-ASSEMBLY-ONLY',
    status: 'MATCHED',
    serviceType: 'ASSEMBLY_ONLY',
    region: '서울',
    preferredDate: '2099-07-21',
    deliveryMethod: 'DELIVERY',
    note: '',
    asPolicyAccepted: true,
    estimatedPartsPrice: 1_400_000,
    itemCount: 2,
    selectedOfferId: offer.id,
    canCancel: false,
    items: [],
    offers: [offer],
    payment: { id: 'payment-assembly-only', amount: 70_000, paidAmount: 0, currency: 'KRW', provider: 'LEGACY_VIRTUAL', method: 'VIRTUAL', status: 'PENDING' },
    statusHistory: []
  };

  await loginAsUser(page);
  await page.route('**/api/assembly-requests**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(request) }));
  await page.route('**/api/users/me/points', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'point-wallet-only', name: '포인트', balance: 1_000_000, pointValueWon: 1, currency: 'KRW' }) }));

  await page.goto(`/checkout/offers/${requestId}`);
  await expect(page.getByTestId('external-offer-section')).toContainText('사용자 준비');
  await expect(page.getByTestId('external-offer-section')).toContainText('70,000원');
  await expect(page.getByText('1,400,000원')).toHaveCount(0);
  await expect(page.getByText('20,000원')).toHaveCount(0);

  await page.getByRole('link', { name: '결제 상태 확인' }).click();
  await expect(page).toHaveURL(`/checkout/payment/${requestId}`);
  await expect(page.getByText('부품', { exact: true })).toBeVisible();
  await expect(page.getByText('사용자 준비', { exact: true })).toBeVisible();
  await expect(page.getByText('최종 결제 금액')).toBeVisible();
  await expect(page.getByText('70,000원')).toHaveCount(2);
  await expect(page.getByText('70,000원').first()).toBeVisible();
  await expect(page.getByText('1,400,000원')).toHaveCount(0);
  await expect(page.getByText('20,000원')).toHaveCount(0);
  await expect(page.getByText('배송 조건은 작업 확정 후 별도로 안내됩니다.')).toBeVisible();
});

test('requires contact and delivery address fields before creating an assembly request', async ({ page }) => {
  const requestId = '00000000-0000-4000-8000-000000020011';
  let submittedBody: Record<string, unknown> | null = null;
  const request = {
    id: requestId,
    requestNo: 'ASM-DEMO-OPTIONAL',
    status: 'REQUESTED',
    serviceType: 'FULL_SERVICE',
    region: '서울',
    preferredDate: '2099-07-20',
    deliveryMethod: 'DELIVERY',
    note: '',
    contact: {
      name: 'Demo User',
      phone: '010-1234-5678',
      postalCode: '06236',
      addressLine1: '서울시 강남구 테헤란로 1 (역삼동)',
      addressLine2: '101동 1004호'
    },
    asPolicyAccepted: true,
    estimatedPartsPrice: 1_400_000,
    itemCount: 2,
    selectedOfferId: null,
    canCancel: true,
    items: [],
    offers: [],
    payment: null,
    statusHistory: []
  };
  await page.addInitScript(() => localStorage.setItem('buildgraph.token', 'jwt-user-token'));
  await mockKakaoPostcode(page);
  await page.route('**/api/quote-drafts/current**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(checkoutDraft) }));
  await page.route('**/api/build-graphs/resolve', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mode: 'BUILD_OVERVIEW', summary: '호환 가능', nodes: [], edges: [], focusNodeIds: [], insights: [], toolResults: [] }) }));
  await page.route('**/api/assembly-requests**', async (route) => {
    if (route.request().method() === 'POST' && route.request().url().endsWith('/api/assembly-requests')) {
      submittedBody = route.request().postDataJSON() as Record<string, unknown>;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(request) });
  });

  await page.goto('/checkout');

  const submitButton = page.getByRole('button', { name: '기사 제안 요청하기' });
  await expect(page.getByLabel('조립 지역')).toHaveValue('서울');
  await expect(page.getByLabel('희망 일정')).not.toHaveValue('');
  await expect(page.getByLabel('수령인')).toHaveAttribute('required', '');
  await expect(page.getByLabel('연락처')).toHaveAttribute('required', '');
  await expect(page.getByLabel('우편번호')).toHaveAttribute('required', '');
  await expect(page.locator('input[autocomplete="address-line1"]')).toHaveAttribute('required', '');
  await expect(page.getByLabel('상세 주소')).toHaveAttribute('required', '');
  await page.getByRole('checkbox', { name: /Dazzajo 표준 AS 정책 적용에 동의합니다/ }).check();
  await expect(submitButton).toBeDisabled();
  await submitButton.hover({ force: true });
  await expect(page.getByRole('tooltip', { name: '정보를 모두 입력해주세요' })).toBeVisible();

  await page.getByLabel('연락처').fill('010-1234-5678');
  await selectCheckoutAddress(page);
  await page.getByLabel('상세 주소').fill('101동 1004호');
  await expect(submitButton).toBeEnabled();
  await submitButton.click();

  await expect(page).toHaveURL(`/checkout/offers/${requestId}`);
  expect(submittedBody).toMatchObject({
    region: '서울',
    contactName: 'Demo User',
    contactPhone: '010-1234-5678',
    postalCode: '06236',
    addressLine1: '서울시 강남구 테헤란로 1 (역삼동)',
    addressLine2: '101동 1004호',
    asPolicyAccepted: true
  });
});

test('keeps the checkout request panel expanded while editing contact information', async ({ page }) => {
  await loginAsUser(page);
  await page.route('**/api/quote-drafts/current**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(checkoutDraft)
  }));
  await page.route('**/api/build-graphs/resolve', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(buildGraphResponse('BUILD_OVERVIEW'))
  }));

  await page.goto('/checkout');

  const requestPanel = page.locator('#checkout-request-info');
  await expect(page.getByLabel('연락처')).toBeVisible();
  await expect.poll(() => requestPanel.evaluate((element) => element.style.height)).toBe('auto');

  await requestPanel.evaluate((element) => {
    const panel = element as HTMLElement & {
      checkoutHeightChanges?: string[];
      checkoutHeightObserver?: MutationObserver;
    };
    panel.checkoutHeightChanges = [];
    panel.checkoutHeightObserver = new MutationObserver(() => {
      panel.checkoutHeightChanges?.push(panel.style.height);
    });
    panel.checkoutHeightObserver.observe(panel, { attributes: true, attributeFilter: ['style'] });
  });

  await page.getByLabel('연락처').type('0');
  await page.evaluate(() => new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  }));

  const heightChanges = await requestPanel.evaluate((element) => {
    const panel = element as HTMLElement & {
      checkoutHeightChanges?: string[];
      checkoutHeightObserver?: MutationObserver;
    };
    panel.checkoutHeightObserver?.disconnect();
    return panel.checkoutHeightChanges ?? [];
  });
  expect(heightChanges).not.toContain('0px');
});

test('shows a newly arrived technician offer from the in-progress request without reload', async ({ page }) => {
  const requestId = '00000000-0000-4000-8000-000000020012';
  let detailCalls = 0;
  const baseRequest = {
    id: requestId,
    requestNo: 'ASM-DEMO-RETURN',
    serviceType: 'FULL_SERVICE',
    region: '서울',
    preferredDate: '2099-07-20',
    deliveryMethod: 'DELIVERY',
    note: '',
    contact: { name: 'Demo User', phone: null },
    asPolicyAccepted: true,
    estimatedPartsPrice: 1_400_000,
    itemCount: 2,
    selectedOfferId: null,
    canCancel: true,
    items: [],
    payment: null,
    statusHistory: []
  };
  const offer = { id: 'offer-external-new', technicianId: 'tech-external', technicianName: '외부 테스트 기사', initials: '외', rating: 4.8, completedJobs: 24, responseMinutes: 10, specialties: ['게이밍 PC'], standardAsAccepted: true, providerType: 'EXTERNAL', verified: true, status: 'AVAILABLE', confirmedPartsPrice: 1_390_000, assemblyFee: 70_000, deliveryFee: 10_000, finalPrice: 1_470_000, leadTimeDays: 2, stockStatus: '재고 확인 완료' };
  await page.addInitScript(() => localStorage.setItem('buildgraph.token', 'jwt-user-token'));
  await page.route('**/api/assembly-requests**', async (route) => {
    const url = route.request().url();
    if (url.includes(`/${requestId}`)) {
      detailCalls += 1;
      const arrived = detailCalls > 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...baseRequest, status: arrived ? 'OFFERED' : 'REQUESTED', offers: arrived ? [offer] : [] }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [{ ...baseRequest, status: 'OFFERED', availableOfferCount: 1 }], page: 0, size: 20, total: 1 }) });
  });

  await page.goto(`/my/assembly-requests/${requestId}`);

  await expect(page.getByText('기사 제안 대기 중')).toBeVisible();
  const compareLink = page.getByRole('link', { name: /기사 제안 비교·선택/ });
  await expect(compareLink).toBeVisible({ timeout: 8_000 });
  await expect(compareLink).toHaveAttribute('href', `/checkout/offers/${requestId}`);

  await page.goto('/my/assembly-requests');
  await expect(page.locator(`a[href="/checkout/offers/${requestId}"]`)).toContainText('기사 제안 1건 비교·선택');
});

test('blocks an incompatible assembly request and does not expose a demo bypass', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.token', 'jwt-user-token');
    sessionStorage.clear();
  });
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(checkoutDraft) });
  });
  await page.route('**/api/build-graphs/resolve', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        mode: 'ISSUE_PATH', summary: '장착 불가', focusNodeIds: [], insights: [], edges: [], toolResults: [],
        nodes: [{ id: 'part-cpu', type: 'PART', category: 'CPU', status: 'FAIL', label: 'CPU' }]
      })
    });
  });
  await mockKakaoPostcode(page, {
    zonecode: '13500',
    address: '경기도 성남시 분당구 1',
    roadAddress: '경기도 성남시 분당구 1',
    jibunAddress: '경기도 성남시 분당동 1',
    bname: '분당동'
  });

  await page.goto('/checkout');
  await page.getByLabel('조립 지역').selectOption('경기');
  await page.getByLabel('희망 일정').fill('2099-08-01');
  await page.getByLabel('수령인').fill('데모 사용자');
  await page.getByLabel('연락처').fill('010-1234-5678');
  await selectCheckoutAddress(page, '경기도 성남시 분당구 1 (분당동)', '13500');
  await page.getByLabel('상세 주소').fill('101동 1004호');
  await page.getByRole('checkbox', { name: /Dazzajo 표준 AS 정책 적용에 동의합니다/ }).check();
  await expect(page.getByRole('button', { name: '기사 제안 요청하기' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '데모 제안 보기' })).toHaveCount(0);
  await expect(page).toHaveURL('/checkout');
});

test('shows checkout empty state and keeps mobile layout within viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.token', 'jwt-user-token');
    sessionStorage.clear();
  });

  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'draft-empty-checkout',
        status: 'EMPTY',
        name: '셀프 견적',
        items: [],
        totalPrice: 0,
        itemCount: 0
      })
    });
  });

  await page.goto('/checkout');

  await expect(page.getByRole('heading', { name: '조립할 부품이 없습니다' })).toBeVisible();
  await expect(page.getByRole('link', { name: '셀프 견적으로 돌아가기' })).toHaveAttribute('href', '/self-quote');

  const hasBodyOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(hasBodyOverflow).toBe(false);
});

test('self quote chatbot sends current draft and never mutates the draft automatically', async ({ page }) => {
  const buildChatBodies: unknown[] = [];
  const draftMutationMethods: string[] = [];
  const gpuDraft = {
    id: 'draft-chat-test',
    status: 'ACTIVE',
    name: '셀프 견적',
    items: [draftItem('part-gpu-chat', 'GPU', 'RTX 5070 챗봇 테스트', 890000)],
    totalPrice: 890000,
    itemCount: 1
  };
  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.token', 'jwt-user-token');
    localStorage.setItem('buildgraph.authUser', JSON.stringify({
      id: 'user-test',
      email: 'user@example.com',
      name: 'Demo User',
      role: 'USER'
    }));
    sessionStorage.clear();
  });

  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'user-test',
        email: 'user@example.com',
        name: 'Demo User',
        role: 'USER'
      })
    });
  });

  await page.route('**/api/quote-drafts/current**', async (route) => {
    const method = route.request().method();
    if (method !== 'GET') {
      draftMutationMethods.push(method);
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(gpuDraft)
    });
  });

  await page.route('**/api/parts**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/price-history')) {
      await mockEmptyPriceHistory(route, 'part-gpu-chat');
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 })
    });
  });

  await page.route('**/api/ai/build-chat', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    buildChatBodies.push(body);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        answerType: 'BUDGET',
        message: '현재 견적에 담긴 부품은 유지하고 나머지 카테고리를 내부 자산 기준으로 채웠습니다.',
        builds: [],
        warnings: []
      })
    });
  });

  await page.goto('/self-quote');
  await expect(page.getByTestId('checklist-GPU')).toContainText('RTX 5070 챗봇 테스트');
  const chatbotPanel = page.getByTestId('ai-chatbot-panel');
  await expect(chatbotPanel).toBeVisible();
  await expect(chatbotPanel.getByText('이렇게 물어보세요')).toHaveCount(0);
  await expect(chatbotPanel.getByRole('button', { name: '200만원 게이밍 PC' })).toHaveCount(0);
  await expect(chatbotPanel.getByRole('button', { name: '견적 마저 채우기' })).toHaveCount(0);
  await expect(chatbotPanel.getByRole('button', { name: '성능 비교' })).toHaveCount(0);
  await expect(chatbotPanel.getByRole('button', { name: '800만원 PC 추천' })).toHaveCount(0);
  await expect(chatbotPanel.getByRole('button', { name: '9950X3D 상세' })).toHaveCount(0);
  await expect(chatbotPanel.getByRole('button', { name: '내 견적함' })).toHaveCount(0);
  // 명확한 카테고리 화면 이동은 브라우저에서 즉시 처리하고 Build Chat을 호출하지 않는다.
  await page.getByRole('textbox', { name: 'AI 챗봇에게 PC 사양 질문' }).fill('GPU 보여줘');
  await page.getByRole('button', { name: '질문 보내기' }).click();
  await expect(page).toHaveURL('/self-quote?category=GPU');
  expect(buildChatBodies).toHaveLength(0);
  await expect(page.getByTestId('ai-chat-messages')).toContainText('GPU 부품 화면으로 이동했습니다.');

  // 견적 완성 요청은 현재 견적(드래프트) 문맥이 필요하므로 서버로 draft가 전송돼야 한다
  await page.getByRole('textbox', { name: 'AI 챗봇에게 PC 사양 질문' }).fill('지금 견적 기준으로 나머지 부품 채워줘');
  await page.getByRole('button', { name: '질문 보내기' }).click();

  await expect.poll(() => buildChatBodies.length).toBe(1);
  expect((buildChatBodies[0] as { currentQuoteDraft?: { items?: Array<{ partId: string }> } }).currentQuoteDraft?.items?.[0]?.partId).toBe('part-gpu-chat');
  await expect(page.getByTestId('ai-chat-messages')).toContainText('나머지 카테고리를 내부 자산 기준으로 채웠습니다.');

  // 추천처럼 문장 자체에 변경 어휘가 없어도 셀프견적에서는 현재 상태를 항상 보낸다.
  // 그래야 추천 칩 재전송과 다음 추천이 방금 적용한 draft를 기준으로 동작한다.
  await page.getByRole('textbox', { name: 'AI 챗봇에게 PC 사양 질문' }).fill('CPU 추천해줘');
  await page.getByRole('button', { name: '질문 보내기' }).click();
  await expect.poll(() => buildChatBodies.length).toBe(2);
  expect((buildChatBodies[1] as { currentQuoteDraft?: { items?: Array<{ partId: string }> } }).currentQuoteDraft?.items?.[0]?.partId).toBe('part-gpu-chat');

  expect(draftMutationMethods).toHaveLength(0);
  // 부품명은 체크리스트(품목 지도)와 슬롯 카드 양쪽에 반영된다. 데스크톱(lg)에서 보드 슬롯은 절대위치
  // + overflow-hidden 컴팩트 레이아웃이라 긴 이름이 클리핑될 수 있으므로, 항상 보이는 체크리스트로 확인한다.
  await expect(page.getByTestId('checklist-GPU').getByText('RTX 5070 챗봇 테스트')).toBeVisible();
});

test.skip('opens cooler candidate panel from self quote nav link', async ({ page }) => {
  await loginAsUser(page);

  await page.route('**/api/parts**', async (route) => {
    const url = new URL(route.request().url());
    const category = url.searchParams.get('category') ?? '';
    const items = category === 'COOLER'
      ? [
          {
            id: 'part-cooler-home-test',
            category: 'COOLER',
            name: 'Liquid Freezer III 360 테스트',
            manufacturer: 'ARCTIC',
            price: 165000,
            status: 'ACTIVE',
            benchmarkSummary: { score: 77.7 },
            attributes: {
              shortSpec: '360mm AIO, AM5/LGA1851'
            },
            externalOffer: {
              imageUrl: 'https://example.test/cooler.png',
              supplierName: '쿨러테스트몰',
              offerUrl: 'https://example.test/cooler',
              lowPrice: 165000,
              source: 'NAVER_SHOPPING_SEARCH'
            }
          }
        ]
      : [];

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items,
        page: 0,
        size: 20,
        total: items.length
      })
    });
  });

  await page.goto('/');
  await page.getByRole('navigation').getByRole('link', { name: '셀프 견적' }).click();
  await expect(page).toHaveURL('/self-quote');
  await page.getByRole('button', { name: '쿨러 슬롯 열기' }).click();

  await expect(page).toHaveURL('/self-quote?category=COOLER');
  const panel = page.getByTestId('slot-candidate-panel');
  await expect(panel.getByRole('heading', { name: '쿨러 부품 목록' })).toBeVisible();
  await expect(panel.getByText('Liquid Freezer III 360 테스트')).toBeVisible();
  await expect(panel.getByText('쿨러테스트몰')).toBeVisible();
  await expect(page.getByText('ACTIVE')).toHaveCount(0);
  await expect(page.getByText('77.7')).toHaveCount(0);
});

test.skip('opens GPU candidate panel from self quote nav link', async ({ page }) => {
  await loginAsUser(page);

  await page.route('**/api/parts**', async (route) => {
    const url = new URL(route.request().url());
    const category = url.searchParams.get('category') ?? '';
    const items = category === 'GPU'
      ? [
          {
            id: 'part-gpu-home-test',
            category: 'GPU',
            name: '홈에서 열린 RTX 테스트',
            manufacturer: 'NVIDIA',
            price: 890000,
            status: 'ACTIVE',
            benchmarkSummary: { score: 92.4 },
            externalOffer: {
              imageUrl: 'https://example.test/home-rtx.png',
              supplierName: '홈테스트몰',
              offerUrl: 'https://example.test/home-rtx',
              lowPrice: 890000,
              source: 'NAVER_SHOPPING_SEARCH'
            }
          }
        ]
      : [];

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items,
        page: 0,
        size: 20,
        total: items.length
      })
    });
  });

  await page.goto('/');
  await page.getByRole('navigation').getByRole('link', { name: '셀프 견적' }).click();
  await expect(page).toHaveURL('/self-quote');
  await page.getByRole('button', { name: 'GPU', exact: true }).click();

  await expect(page).toHaveURL('/self-quote?category=GPU');
  const panel = page.getByTestId('slot-candidate-panel');
  await expect(panel.getByRole('heading', { name: 'GPU 부품 목록' })).toBeVisible();
  await expect(panel.getByText('홈에서 열린 RTX 테스트')).toBeVisible();
  await expect(panel.getByText('홈테스트몰')).toBeVisible();
});

test('applies a recent AI recommendation from the assistant without rendering duplicate comparison panels', async ({ page }) => {
  // 승인된 단일 화면 계약: 최근 추천안은 AI 어시스턴트 카드에서 적용하고,
  // 별도 비교/선택 패널은 기본 화면에 중복 노출하지 않는다.
  const compareBuild = (tier: string, tierLabel: string, gpuPartId: string, gpuName: string, cpuPartId: string, cpuName: string, totalPrice: number) => ({
    id: `ai-${tier}`,
    tier,
    label: tierLabel.replace('형', ''),
    title: `${tierLabel} 추천 조합`,
    summary: `${tierLabel} 데모 조합`,
    totalPrice,
    badges: [],
    budgetWon: 2000000,
    budgetLabel: '200만원',
    tierLabel,
    appliedPartCategories: ['GPU', 'CPU'],
    items: [
      { partId: gpuPartId, category: 'GPU', name: gpuName, manufacturer: 'NVIDIA', quantity: 1, price: Math.round(totalPrice * 0.6), note: '' },
      { partId: cpuPartId, category: 'CPU', name: cpuName, manufacturer: 'AMD', quantity: 1, price: Math.round(totalPrice * 0.4), note: '' }
    ]
  });

  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.token', 'jwt-user-token');
    localStorage.setItem('buildgraph.authUser', JSON.stringify({ id: 'user-test', email: 'user@example.com', name: 'Demo User', role: 'USER' }));
  });
  await page.addInitScript((builds) => {
    sessionStorage.setItem('buildgraph.ai.assistantSession:user-test', JSON.stringify({
      messages: [
        { id: 'msg-user', role: 'user', text: '게이밍 200만원', createdAt: '2026-07-06T09:00:00.000Z' },
        { id: 'msg-assistant', role: 'assistant', text: '추천 조합 3개를 구성했습니다.', createdAt: '2026-07-06T09:00:05.000Z', builds }
      ],
      latestBuilds: builds,
      savedBuildIds: {},
      updatedAt: '2026-07-06T09:00:05.000Z'
    }));
  }, [
    compareBuild('budget', '가성비형', 'part-gpu-budget', '가성비 GPU', 'part-cpu-budget', '가성비 CPU', 1500000),
    compareBuild('balanced', '균형형', 'part-gpu-current', '현재 장착 GPU', 'part-cpu-balanced', '균형 CPU', 1900000),
    compareBuild('performance', '고성능형', 'part-gpu-perf', '고성능 GPU', 'part-cpu-perf', '고성능 CPU', 2400000)
  ]);

  const applyRequests: Array<{ buildId: string; itemCount: number }> = [];
  let compareDraftItems = [draftItem('part-gpu-current', 'GPU', '현재 장착 GPU', 1140000)];

  await page.route('**/api/build-graphs/resolve', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        mode: 'ISSUE_PATH', summary: '현재 견적 평가', nodes: [], edges: [], focusNodeIds: [], insights: [],
        compositeScore: { score: 734, maxScore: 1000, grade: 'B', label: '균형형', summary: '균형 잡힌 구성', components: [], caps: [] },
        toolResults: [{ tool: 'compatibility', status: 'PASS', confidence: 'HIGH', summary: '호환성 통과' }]
      })
    });
  });
  await page.route('**/api/tools/performance/check', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tool: 'performance', status: 'PASS', confidence: 'HIGH', summary: '공개 FPS 참고값',
        details: {
          gameFpsEvidence: [
            { gameTitle: '배틀그라운드', gameKey: 'pubg', resolution: '4K', avgFps: 55 },
            { gameTitle: '배틀그라운드', gameKey: 'pubg', resolution: 'QHD', avgFps: 132 },
            { gameTitle: '배틀그라운드', gameKey: 'pubg', resolution: 'FHD', avgFps: 190 }
          ]
        }
      })
    });
  });

  await page.route('**/api/quote-drafts/current**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'PUT' && url.pathname.endsWith('/apply-ai-build')) {
      const body = JSON.parse(route.request().postData() ?? '{}') as { buildId: string; items: Array<{ partId: string; category: string; quantity: number }> };
      applyRequests.push({ buildId: body.buildId, itemCount: body.items.length });
      compareDraftItems = body.items.map((item, index) =>
        draftItem(item.partId, item.category, item.partId === 'part-gpu-budget' ? '가성비 GPU' : item.partId === 'part-cpu-budget' ? '가성비 CPU' : `적용 부품 ${index}`, 750000)
      );
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...emptyDraft,
        items: compareDraftItems,
        totalPrice: compareDraftItems.reduce((sum, item) => sum + item.lineTotal, 0),
        itemCount: compareDraftItems.reduce((sum, item) => sum + item.quantity, 0)
      })
    });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });

  await page.goto('/self-quote');

  await expect(page.getByTestId('quote-compare-open')).toHaveCount(0);
  await expect(page.getByTestId('quote-compare-panel')).toHaveCount(0);
  await expect(page.getByTestId('ai-selected-build-panel')).toHaveCount(0);

  const assistant = page.getByTestId('ai-chatbot-panel');
  const budgetCard = assistant.locator('article').filter({ hasText: '가성비형 추천 조합' });
  await expect(budgetCard).toContainText('1,500,000원');
  await expect(assistant.locator('article').filter({ hasText: '고성능형 추천 조합' })).toContainText('2,400,000원');

  // 가성비안 적용 → 기존 일괄 적용 API 호출 + 체크리스트에 실제 적용 결과 반영.
  await budgetCard.getByRole('button', { name: '이 조합으로 셀프 견적 보기' }).click();
  await expect.poll(() => applyRequests).toEqual([{ buildId: 'ai-budget', itemCount: 2 }]);
  // 일괄 적용은 바뀐 행이 권장 순서(CPU→GPU)대로 80ms 계단식 카드 채워짐 플래시를 재생한다.
  await expect(page.getByTestId('checklist-CPU')).toHaveAttribute('data-flash', 'true');
  await expect(page.getByTestId('checklist-CPU')).toHaveCSS('animation-delay', '0s');
  await expect(page.getByTestId('checklist-GPU')).toHaveAttribute('data-flash', 'true');
  await expect(page.getByTestId('checklist-GPU')).toHaveCSS('animation-delay', '0.08s');
  await expect(page.getByTestId('checklist-GPU')).toContainText('가성비 GPU');
  await expect(page.getByTestId('checklist-CPU')).toContainText('가성비 CPU');
  await expect(page.getByTestId('checklist-CPU')).toHaveAttribute('data-flash', 'false', { timeout: 3000 });
  await expect(page.getByTestId('checklist-GPU')).toHaveAttribute('data-flash', 'false', { timeout: 3000 });
  // 해상도 하나(4K)만 보고하면 최소 견적이 저평가된다 — 근거가 있는 해상도를 낮은 순으로 모두 싣고
  // 120Hz 기준 판정을 덧붙인다(2026-07-20 팀 제언).
  // 문장은 개별 블록으로 렌더되므로 문장 단위로 단언한다(경계를 넘는 문자열은 공백이 사라져 매칭되지 않는다).
  await expect(page.getByTestId('ai-chat-messages')).toContainText('완성 견적이 담겼습니다. 현재 종합 점수는 734점입니다.');
  await expect(page.getByTestId('ai-chat-messages')).toContainText('배그 예상 성능은 FHD 190 · QHD 132 · 4K 55FPS입니다.');
  await expect(page.getByTestId('ai-chat-messages')).toContainText('FHD·QHD는 120Hz 이상으로 쾌적하고, 4K는 120Hz에 못 미치니 참고하세요.');
  await expect(page.getByTestId('ai-selected-build-panel')).toHaveCount(0);

  // reduced-motion에서는 플래시 신호(data-flash)는 토글되지만 모션 자체는 꺼진다(전 화면 공통 규칙).
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await assistant.locator('article').filter({ hasText: '고성능형 추천 조합' }).getByRole('button', { name: '이 조합으로 셀프 견적 보기' }).click();
  await expect(page.getByTestId('checklist-GPU')).toHaveAttribute('data-flash', 'true');
  await expect(page.getByTestId('checklist-GPU')).toHaveCSS('animation-name', 'none');
  await expect(page.getByTestId('checklist-GPU')).toHaveAttribute('data-flash', 'false', { timeout: 3000 });
});

test('applies the single immediately preceding AI build from an explicit natural-language confirmation', async ({ page }) => {
  const previewBuild = {
    id: 'ai-draft-rebuild-natural-apply',
    tier: 'balanced',
    label: '전체 변경안',
    title: '예산 맞춤 전체 변경안',
    summary: '현재 견적을 대체하는 검증된 완성 조합입니다.',
    totalPrice: 1800000,
    badges: ['DRAFT_REBUILD_PREVIEW'],
    budgetWon: 2000000,
    budgetLabel: '목표 200만원',
    tierLabel: '균형형',
    appliedPartCategories: [],
    items: [
      { partId: 'part-natural-gpu', category: 'GPU', name: '자연어 적용 GPU', manufacturer: 'NVIDIA', quantity: 1, price: 1100000, note: '' },
      { partId: 'part-natural-cpu', category: 'CPU', name: '자연어 적용 CPU', manufacturer: 'AMD', quantity: 1, price: 700000, note: '' }
    ],
    toolResults: [
      { tool: 'compatibility', status: 'PASS', confidence: 'HIGH', summary: '호환성 통과' },
      { tool: 'power', status: 'PASS', confidence: 'HIGH', summary: '전력 통과' }
    ]
  };
  await page.addInitScript((build) => {
    localStorage.setItem('buildgraph.token', 'jwt-user-token');
    localStorage.setItem('buildgraph.authUser', JSON.stringify({ id: 'user-natural-apply', email: 'user@example.com', name: 'Demo User', role: 'USER' }));
    sessionStorage.setItem('buildgraph.ai.assistantSession:user-natural-apply', JSON.stringify({
      messages: [
        { id: 'msg-user', role: 'user', text: '전체를 200만원으로 맞춰줘', createdAt: '2026-07-15T09:00:00.000Z', kind: 'general' },
        { id: 'msg-preview', role: 'assistant', text: '전체 변경안을 확인했습니다.', createdAt: '2026-07-15T09:00:01.000Z', kind: 'budget', builds: [build] }
      ],
      latestBuilds: [build],
      savedBuildIds: {},
      updatedAt: '2026-07-15T09:00:01.000Z'
    }));
  }, previewBuild);

  const applyRequests: Array<{ buildId: string; itemCount: number }> = [];
  let buildChatCalls = 0;
  let currentDraft: {
    id: string;
    status: string;
    name: string;
    items: ReturnType<typeof draftItem>[];
    totalPrice: number;
    itemCount: number;
  } = { ...emptyDraft, items: [] };
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'user-natural-apply', email: 'user@example.com', name: 'Demo User', role: 'USER' }) });
  });
  await page.route('**/api/quote-drafts/current**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'PUT' && url.pathname.endsWith('/apply-ai-build')) {
      const body = JSON.parse(route.request().postData() ?? '{}') as { buildId: string; items: Array<{ partId: string; category: string; quantity: number }> };
      applyRequests.push({ buildId: body.buildId, itemCount: body.items.length });
      const items = body.items.map((item) => draftItem(
        item.partId,
        item.category,
        item.partId === 'part-natural-gpu' ? '자연어 적용 GPU' : '자연어 적용 CPU',
        item.partId === 'part-natural-gpu' ? 1100000 : 700000
      ));
      currentDraft = {
        ...emptyDraft,
        items,
        totalPrice: 1800000,
        itemCount: 2
      };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(currentDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });
  await page.route('**/api/build-graphs/resolve', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        mode: 'ISSUE_PATH',
        summary: '현재 견적 평가',
        nodes: [],
        edges: [],
        focusNodeIds: [],
        insights: [],
        compositeScore: {
          score: 736,
          maxScore: 1000,
          grade: 'B',
          label: '균형형',
          summary: '균형 잡힌 구성입니다.',
          components: [],
          caps: []
        },
        toolResults: [{ tool: 'compatibility', status: 'PASS', confidence: 'HIGH', summary: '호환성 통과' }]
      })
    });
  });
  await page.route('**/api/tools/performance/check', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tool: 'performance',
        status: 'PASS',
        confidence: 'HIGH',
        summary: '공개 FPS 참고값',
        details: {
          gameFpsEvidence: [{ gameTitle: '배틀그라운드', gameKey: 'pubg', resolution: '4K', avgFps: 70 }]
        }
      })
    });
  });
  await page.route('**/api/ai/build-chat', async (route) => {
    buildChatCalls += 1;
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/self-quote');
  await page.getByRole('textbox', { name: 'AI 챗봇에게 PC 사양 질문' }).fill('그걸로 적용해줘');
  await page.getByRole('button', { name: '질문 보내기' }).click();

  await expect.poll(() => applyRequests).toEqual([{ buildId: 'ai-draft-rebuild-natural-apply', itemCount: 2 }]);
  expect(buildChatCalls).toBe(0);
  await expect(page.getByTestId('ai-chat-messages')).toContainText('완성 견적이 담겼습니다');
  await expect(page.getByTestId('ai-chat-messages')).toContainText('현재 종합 점수는 736점');
  await expect(page.getByTestId('ai-chat-messages')).toContainText('배그 예상 성능은 4K 70FPS입니다');
  await expect(page.getByTestId('checklist-GPU')).toContainText('자연어 적용 GPU');
});

test('auto-applies a single server-verified case repair when the current draft has a blocking size failure', async ({ page }) => {
  await loginAsUser(page);
  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.authUser', JSON.stringify({
      id: 'user-test',
      email: 'user@example.com',
      name: 'Demo User',
      role: 'USER'
    }));
  });
  const failingItems = [
    draftItem('part-long-gpu', 'GPU', '긴 그래픽카드', 900000, 1, { lengthMm: 350 }),
    draftItem('part-small-case', 'CASE', '장착 불가 케이스', 90000, 1, { maxGpuLengthMm: 300 })
  ];
  let currentDraft = {
    ...emptyDraft,
    items: failingItems,
    totalPrice: 990000,
    itemCount: 2
  };
  let applyCalls = 0;
  let buildChatCalls = 0;

  await page.route('**/api/quote-drafts/current**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'PUT' && url.pathname.endsWith('/apply-ai-build')) {
      applyCalls += 1;
      const body = JSON.parse(route.request().postData() ?? '{}') as {
        items: Array<{ partId: string; category: string; quantity: number }>;
      };
      const appliedItems = body.items.map((item) => draftItem(
        item.partId,
        item.category,
        item.partId === 'part-compatible-case' ? '호환 케이스' : '긴 그래픽카드',
        item.partId === 'part-compatible-case' ? 120000 : 900000,
        item.quantity,
        item.partId === 'part-compatible-case' ? { maxGpuLengthMm: 420 } : { lengthMm: 350 }
      ));
      currentDraft = {
        ...emptyDraft,
        items: appliedItems,
        totalPrice: 1020000,
        itemCount: 2
      };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(currentDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });
  await page.route('**/api/build-graphs/resolve', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...buildGraphResponse(),
        compositeScore: compositeScoreFixture(741, '균형형'),
        toolResults: [{ tool: 'size', status: 'PASS', confidence: 'HIGH', summary: '장착 가능' }]
      })
    });
  });
  await page.route('**/api/tools/performance/check', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tool: 'performance',
        status: 'PASS',
        confidence: 'HIGH',
        summary: '공개 FPS 참고값',
        details: { gameFpsEvidence: [{ gameTitle: '배틀그라운드', gameKey: 'pubg', resolution: '4K', avgFps: 64 }] }
      })
    });
  });
  await page.route('**/api/ai/build-chat', async (route) => {
    buildChatCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        answerType: 'PART',
        message: '현재 장착 문제를 해소하는 검증된 단일 복구안으로 자동 반영합니다.',
        warnings: [],
        quickReplies: [],
        builds: [{
          id: 'ai-auto-case-repair',
          tier: 'draft-edit',
          label: '변경 미리보기',
          title: '변경 적용 미리보기',
          summary: '현재 장착 문제를 해소하고 자동 검증을 통과한 단일 복구안입니다.',
          totalPrice: 1020000,
          badges: ['DRAFT_EDIT_PREVIEW', 'AUTO_APPLY_VERIFIED_REPAIR'],
          budgetWon: 1020000,
          budgetLabel: '102만원',
          tierLabel: '변경 미리보기',
          appliedPartCategories: ['CASE'],
          items: [
            { partId: 'part-long-gpu', category: 'GPU', name: '긴 그래픽카드', manufacturer: '테스트제조사', quantity: 1, price: 900000, note: '' },
            { partId: 'part-compatible-case', category: 'CASE', name: '호환 케이스', manufacturer: '테스트제조사', quantity: 1, price: 120000, note: '' }
          ],
          toolResults: [{ tool: 'size', status: 'PASS', confidence: 'HIGH', summary: '장착 가능' }]
        }]
      })
    });
  });

  await page.goto('/self-quote');
  await page.evaluate(() => {
    const snapshots: string[] = [];
    const messages = document.querySelector('[data-testid="ai-chat-messages"]');
    if (messages) {
      const record = () => snapshots.push(messages.textContent ?? '');
      new MutationObserver(record).observe(messages, { childList: true, subtree: true, characterData: true });
      record();
    }
    (window as typeof window & { __aiChatTextSnapshots?: string[] }).__aiChatTextSnapshots = snapshots;
  });
  await page.getByRole('textbox', { name: 'AI 챗봇에게 PC 사양 질문' }).fill('호환되는 케이스로 바꿔줘');
  await page.getByRole('button', { name: '질문 보내기' }).click();

  await expect.poll(() => applyCalls).toBe(1);
  expect(buildChatCalls).toBe(1);
  const changeCard = page.getByTestId('ai-auto-applied-change');
  await expect(changeCard).toContainText('변경 전후');
  await expect(changeCard.getByTestId('ai-change-before')).toHaveText('장착 불가 케이스');
  await expect(changeCard.getByTestId('ai-change-after')).toHaveText('호환 케이스');
  await expect(changeCard.getByTestId('ai-price-before')).toHaveText('990,000원');
  await expect(changeCard.getByTestId('ai-price-after')).toHaveText('1,020,000원');
  await expect(page.getByTestId('ai-build-card').getByRole('button', { name: '이 조합으로 셀프 견적 보기' })).toHaveCount(0);
  await expect(page.getByTestId('checklist-CASE')).toContainText('호환 케이스');
  await expect(page.getByTestId('ai-chat-messages')).toContainText('요청한 변경이 반영되었습니다');
  await expect(page.getByTestId('ai-chat-messages')).toContainText('현재 종합 점수는 741점');
  const feedbackMessage = page.getByTestId('ai-chat-message-assistant').last();
  await expect(feedbackMessage).toContainText('상단에서 종합 점수와 게임별 예상 성능을 확인해 보세요.');
  // 해상도 요약과 120Hz 판정이 각각 한 문장씩 늘었다(점수 → FPS 나열 → 판정 → 안내).
  await expect(feedbackMessage).toContainText('배그 예상 성능은 4K 64FPS입니다.');
  await expect(feedbackMessage).toContainText('4K 64FPS로 플레이하기 충분하지만, 120Hz 고주사율에는 못 미칩니다.');
  await expect(feedbackMessage.getByTestId('ai-message-sentence')).toHaveCount(5);
  const snapshots = await page.evaluate(() => (
    (window as typeof window & { __aiChatTextSnapshots?: string[] }).__aiChatTextSnapshots ?? []
  ));
  expect(snapshots.some((text) => (
    text.includes('요청한 변경이 반영되었습니다')
    && !text.includes('상단에서 종합 점수와 게임별 예상 성능을 확인해 보세요.')
  ))).toBe(true);
});

// 케이스 '추천'(장착 여유 개선)은 자동 적용 계약이 아니다: 서버는 자동 반영 badge 없이 미리보기
// 카드만 내려주고, 사용자가 카드의 적용 버튼으로 확인해야 견적이 변경된다. size FAIL 복구
// (AUTO_APPLY_VERIFIED_REPAIR)의 자동 반영과 구분되는 흐름이다.
test('shows the verified top case improvement as a preview and applies it only after user confirmation', async ({ page }) => {
  await loginAsUser(page);
  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.authUser', JSON.stringify({
      id: 'user-test',
      email: 'user@example.com',
      name: 'Demo User',
      role: 'USER'
    }));
  });
  const currentItems = [
    draftItem('part-long-gpu', 'GPU', '긴 그래픽카드', 900000, 1, { lengthMm: 350 }),
    draftItem('part-tight-case', 'CASE', '빠듯한 케이스', 90000, 1, { maxGpuLengthMm: 360 })
  ];
  let currentDraft = {
    ...emptyDraft,
    items: currentItems,
    totalPrice: 990000,
    itemCount: 2
  };
  let applyCalls = 0;
  let buildChatCalls = 0;

  await page.route('**/api/quote-drafts/current**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'PUT' && url.pathname.endsWith('/apply-ai-build')) {
      applyCalls += 1;
      const body = JSON.parse(route.request().postData() ?? '{}') as {
        items: Array<{ partId: string; category: string; quantity: number }>;
      };
      const appliedItems = body.items.map((item) => draftItem(
        item.partId,
        item.category,
        item.partId === 'part-roomy-case' ? '여유 케이스' : '긴 그래픽카드',
        item.partId === 'part-roomy-case' ? 120000 : 900000,
        item.quantity,
        item.partId === 'part-roomy-case' ? { maxGpuLengthMm: 420 } : { lengthMm: 350 }
      ));
      currentDraft = {
        ...emptyDraft,
        items: appliedItems,
        totalPrice: 1020000,
        itemCount: 2
      };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(currentDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });
  await page.route('**/api/build-graphs/resolve', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...buildGraphResponse(),
        compositeScore: compositeScoreFixture(741, '균형형'),
        toolResults: [{ tool: 'size', status: 'PASS', confidence: 'HIGH', summary: '장착 가능' }]
      })
    });
  });
  await page.route('**/api/tools/performance/check', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tool: 'performance',
        status: 'PASS',
        confidence: 'HIGH',
        summary: '공개 FPS 참고값',
        details: { gameFpsEvidence: [{ gameTitle: '배틀그라운드', gameKey: 'pubg', resolution: '4K', avgFps: 64 }] }
      })
    });
  });
  await page.route('**/api/ai/build-chat', async (route) => {
    buildChatCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        answerType: 'PART',
        message: '장착 여유가 개선되고 자동 검증을 통과한 1위 케이스는 여유 케이스입니다. 아래 미리보기 카드에서 적용할 수 있습니다.',
        warnings: [],
        quickReplies: [],
        builds: [{
          id: 'ai-case-improvement-preview',
          tier: 'draft-edit',
          label: '변경 미리보기',
          title: '변경 적용 미리보기',
          summary: '현재 케이스보다 장착 여유가 개선된 1위 변경안입니다.',
          totalPrice: 1020000,
          badges: ['DRAFT_EDIT_PREVIEW'],
          budgetWon: 1020000,
          budgetLabel: '102만원',
          tierLabel: '변경 미리보기',
          appliedPartCategories: ['CASE'],
          items: [
            { partId: 'part-long-gpu', category: 'GPU', name: '긴 그래픽카드', manufacturer: '테스트제조사', quantity: 1, price: 900000, note: '' },
            { partId: 'part-roomy-case', category: 'CASE', name: '여유 케이스', manufacturer: '테스트제조사', quantity: 1, price: 120000, note: '' }
          ],
          toolResults: [{ tool: 'size', status: 'PASS', confidence: 'HIGH', summary: '장착 가능' }]
        }]
      })
    });
  });

  await page.goto('/self-quote');
  await page.getByRole('textbox', { name: 'AI 챗봇에게 PC 사양 질문' }).fill('현재 부품이 여유 있게 들어가는 케이스 추천해줘');
  await page.getByRole('button', { name: '질문 보내기' }).click();

  // 미리보기 단계: 적용 버튼이 있는 일반 미리보기 카드만 보이고, 자동 반영 UI·apply 호출은 없다.
  const applyButton = page.getByTestId('ai-build-card').getByRole('button', { name: '이 조합으로 셀프 견적 보기' });
  await expect(applyButton).toBeVisible();
  await expect(page.getByTestId('ai-chat-messages')).toContainText('아래 미리보기 카드에서 적용할 수 있습니다.');
  await expect(page.getByTestId('ai-auto-apply-status')).toHaveCount(0);
  await expect(page.getByTestId('ai-auto-applied-change')).toHaveCount(0);
  expect(applyCalls).toBe(0);
  await expect(page.getByTestId('checklist-CASE')).toContainText('빠듯한 케이스');

  // 사용자가 적용 버튼으로 확인해야만 견적이 바뀐다.
  await applyButton.click();
  await expect.poll(() => applyCalls).toBe(1);
  expect(buildChatCalls).toBe(1);
  await expect(page.getByTestId('checklist-CASE')).toContainText('여유 케이스');
  await expect(page.getByTestId('ai-chat-messages')).toContainText('요청한 변경이 반영되었습니다');
  await expect(page.getByTestId('ai-chat-messages')).toContainText('현재 종합 점수는 741점');
});

test('resumes a pending AI application receipt after reload and reports score without inventing FPS', async ({ page }) => {
  const items = [
    draftItem('part-feedback-cpu', 'CPU', '피드백 CPU', 500000),
    draftItem('part-feedback-gpu', 'GPU', '피드백 GPU', 900000)
  ];
  const currentDraft = {
    ...emptyDraft,
    items,
    totalPrice: 1400000,
    itemCount: 2
  };
  await page.addInitScript(({ draft }) => {
    localStorage.setItem('buildgraph.token', 'jwt-user-token');
    localStorage.setItem('buildgraph.authUser', JSON.stringify({ id: 'user-feedback-resume', email: 'resume@example.com', name: 'Resume User', role: 'USER' }));
    const startedAt = new Date().toISOString();
    sessionStorage.setItem('buildgraph.ai.assistantSession:user-feedback-resume', JSON.stringify({
      messages: [{
        id: 'feedback-message-resume',
        role: 'assistant',
        text: '견적 반영이 완료되었습니다. 종합 점수와 게임 성능을 확인하고 있습니다.',
        createdAt: startedAt,
        kind: 'part'
      }],
      latestBuilds: [],
      savedBuildIds: {},
      draftApplicationFeedback: {
        id: 'feedback-resume',
        messageId: 'feedback-message-resume',
        draftFingerprint: draft.items.map((item: { category: string; partId: string; quantity: number }) => `${item.category}:${item.partId}:${item.quantity}`).sort().join('|'),
        applicationKind: 'COMPLETE_BUILD',
        status: 'PENDING',
        startedAt,
        performanceView: {
          gameLabel: '발로란트',
          gameQuery: 'valorant',
          resolutionLabel: 'FHD',
          resolutionQuery: 'fhd'
        }
      },
      updatedAt: startedAt
    }));
    sessionStorage.setItem('buildgraph.ai.performance-view:user-feedback-resume', JSON.stringify({
      gameLabel: '발로란트',
      gameQuery: 'valorant',
      resolutionLabel: 'FHD',
      resolutionQuery: 'fhd',
      sourceFingerprint: 'old-cpu,old-gpu',
      evidenceSettled: false,
      avgFps: 999,
      updatedAt: startedAt
    }));
  }, { draft: currentDraft });
  const performanceContexts: Array<{ game?: string; resolution?: string }> = [];
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'user-feedback-resume', email: 'resume@example.com', name: 'Resume User', role: 'USER' }) });
  });
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(currentDraft) });
  });
  await page.route('**/api/build-graphs/resolve', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        mode: 'ISSUE_PATH', summary: '현재 견적 평가', nodes: [], edges: [], focusNodeIds: [], insights: [],
        compositeScore: { score: 812, maxScore: 1000, grade: 'A', label: '고성능', summary: '고성능 구성', components: [], caps: [] },
        toolResults: [{ tool: 'compatibility', status: 'PASS', confidence: 'HIGH', summary: '호환성 통과' }]
      })
    });
  });
  await page.route('**/api/tools/performance/check', async (route) => {
    const payload = JSON.parse(route.request().postData() ?? '{}') as { context?: { game?: string; resolution?: string } };
    performanceContexts.push(payload.context ?? {});
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tool: 'performance', status: 'WARN', confidence: 'LOW', summary: 'FPS 근거 없음', details: { gameFpsEvidence: [] } })
    });
  });

  await page.goto('/self-quote');
  const messages = page.getByTestId('ai-chat-messages');
  await expect(messages).toContainText('완성 견적이 담겼습니다');
  await expect(messages).toContainText('현재 종합 점수는 812점');
  // 근거가 없으면 성능 문장을 통째로 생략한다 — "자료 없음"을 굳이 알리지 않되 수치를 지어내지도 않는다.
  await expect(messages).not.toContainText('FPS 근거가 없어');
  await expect(messages).not.toContainText('예상 성능은');
  await expect(messages).not.toContainText('평균 0FPS');
  await expect(messages).not.toContainText('999FPS');
  await expect.poll(() => performanceContexts.some((context) => context.game === 'valorant' && context.resolution === 'fhd')).toBe(true);
  await expect(messages.getByText(/완성 견적이 담겼습니다/)).toHaveCount(1);

  await page.reload();
  await expect(page.getByTestId('ai-chat-messages').getByText(/완성 견적이 담겼습니다/)).toHaveCount(1);
});

// 전 해상도가 120Hz에 못 미치면 "할 수 있는 것"을 먼저 말하고 한계를 뒤에 붙인다(부정문 선두 금지).
test('전 해상도가 120Hz 미만이면 가장 낮은 해상도 기준으로 플레이 가능 여부를 먼저 알린다', async ({ page }) => {
  await loginAsUser(page);
  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.authUser', JSON.stringify({ id: 'user-lowfps', email: 'user@example.com', name: 'Demo User', role: 'USER' }));
  });
  const items = [
    draftItem('part-lowfps-cpu', 'CPU', '보급형 CPU', 200000),
    draftItem('part-lowfps-gpu', 'GPU', '보급형 GPU', 300000)
  ];
  const draft = { ...emptyDraft, id: 'draft-lowfps', items, totalPrice: 500000, itemCount: items.length };
  await page.route('**/api/quote-drafts/current**', async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(draft) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(draft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });
  await page.route('**/api/build-graphs/resolve', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...buildGraphResponse(), compositeScore: compositeScoreFixture(620, '보급형') })
    });
  });
  await page.route('**/api/tools/performance/check', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tool: 'performance', status: 'WARN', confidence: 'MEDIUM', summary: '',
        details: {
          gameFpsEvidence: [
            { gameTitle: '배틀그라운드', gameKey: 'pubg', resolution: '4K', avgFps: 38 },
            { gameTitle: '배틀그라운드', gameKey: 'pubg', resolution: 'QHD', avgFps: 61 },
            { gameTitle: '배틀그라운드', gameKey: 'pubg', resolution: 'FHD', avgFps: 95 }
          ]
        }
      })
    });
  });

  await page.goto('/self-quote');
  await page.evaluate(() => {
    const ownerKey = 'user-lowfps';
    const startedAt = new Date().toISOString();
    const session = {
      messages: [{ id: 'msg-lowfps', role: 'assistant', text: '적용 중', createdAt: startedAt, kind: 'part' }],
      latestBuilds: [],
      savedBuildIds: {},
      draftApplicationFeedback: {
        id: 'feedback-lowfps',
        messageId: 'msg-lowfps',
        draftFingerprint: 'CPU:part-lowfps-cpu:1|GPU:part-lowfps-gpu:1',
        applicationKind: 'COMPLETE_BUILD',
        status: 'PENDING',
        startedAt
      },
      updatedAt: startedAt
    };
    sessionStorage.setItem(`buildgraph.ai.assistantSession:${ownerKey}`, JSON.stringify(session));
    window.dispatchEvent(new Event('buildgraph.ai.assistantSessionChanged'));
  });

  const messages = page.getByTestId('ai-chat-messages');
  await expect(messages).toContainText('배그 예상 성능은 FHD 95 · QHD 61 · 4K 38FPS입니다');
  await expect(messages).toContainText('FHD 95FPS로 플레이하기 충분하지만, 120Hz 고주사율에는 못 미칩니다');
  // 부정문이 문장 앞에 오지 않는다 — "쾌적한 해상도가 없습니다" 같은 표현 금지.
  await expect(messages).not.toContainText('쾌적한 해상도');
});

test('prioritizes a zero-score Tool failure over available FPS after an AI change', async ({ page }) => {
  const items = [
    draftItem('part-feedback-fail-cpu', 'CPU', '실패 CPU', 500000),
    draftItem('part-feedback-fail-gpu', 'GPU', '실패 GPU', 1200000),
    draftItem('part-feedback-fail-case', 'CASE', '작은 케이스', 100000)
  ];
  const currentDraft = {
    ...emptyDraft,
    items,
    totalPrice: 1800000,
    itemCount: 3
  };
  await page.addInitScript(({ draft }) => {
    localStorage.setItem('buildgraph.token', 'jwt-user-token');
    localStorage.setItem('buildgraph.authUser', JSON.stringify({ id: 'user-feedback-fail', email: 'fail@example.com', name: 'Fail User', role: 'USER' }));
    const startedAt = new Date().toISOString();
    sessionStorage.setItem('buildgraph.ai.assistantSession:user-feedback-fail', JSON.stringify({
      messages: [{
        id: 'feedback-message-fail',
        role: 'assistant',
        text: '견적 반영이 완료되었습니다. 종합 점수와 게임 성능을 확인하고 있습니다.',
        createdAt: startedAt,
        kind: 'part'
      }],
      latestBuilds: [],
      savedBuildIds: {},
      draftApplicationFeedback: {
        id: 'feedback-fail',
        messageId: 'feedback-message-fail',
        draftFingerprint: draft.items.map((item: { category: string; partId: string; quantity: number }) => `${item.category}:${item.partId}:${item.quantity}`).sort().join('|'),
        applicationKind: 'PARTIAL_CHANGE',
        status: 'PENDING',
        startedAt
      },
      updatedAt: startedAt
    }));
  }, { draft: currentDraft });
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'user-feedback-fail', email: 'fail@example.com', name: 'Fail User', role: 'USER' }) });
  });
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(currentDraft) });
  });
  await page.route('**/api/build-graphs/resolve', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        mode: 'ISSUE_PATH', summary: '장착 실패', nodes: [], edges: [], focusNodeIds: [], insights: [],
        compositeScore: { score: 0, maxScore: 1000, grade: 'F', label: '장착 불가', summary: '케이스 장착 불가', components: [], caps: [] },
        toolResults: [{ tool: 'size', status: 'FAIL', confidence: 'HIGH', summary: 'GPU 길이가 케이스 허용 길이를 초과합니다.' }]
      })
    });
  });
  await page.route('**/api/tools/performance/check', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tool: 'performance', status: 'PASS', confidence: 'HIGH', summary: '공개 FPS 참고값',
        details: { gameFpsEvidence: [{ gameTitle: '배틀그라운드', gameKey: 'pubg', resolution: '4K', avgFps: 120 }] }
      })
    });
  });

  await page.goto('/self-quote');
  const messages = page.getByTestId('ai-chat-messages');
  await expect(messages).toContainText('종합 점수는 0점입니다');
  await expect(messages).toContainText('상단 경고를 먼저 확인해 주세요');
  await expect(messages).not.toContainText('240FPS');
});

test('does not apply an older build when the immediately preceding assistant turn has no build', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.token', 'jwt-user-token');
    localStorage.setItem('buildgraph.authUser', JSON.stringify({ id: 'user-natural-missing', email: 'user@example.com', name: 'Demo User', role: 'USER' }));
    sessionStorage.setItem('buildgraph.ai.assistantSession:user-natural-missing', JSON.stringify({
      messages: [
        { id: 'msg-old-build', role: 'assistant', text: '예전 추천입니다.', createdAt: '2026-07-15T09:00:00.000Z', kind: 'budget', builds: [{
          id: 'old-build', tier: 'balanced', label: '추천', title: '예전 추천', summary: '', totalPrice: 1000000,
          badges: [], budgetWon: 1000000, budgetLabel: '100만원', tierLabel: '균형형', appliedPartCategories: [],
          items: [{ partId: 'old-part', category: 'CPU', name: '예전 CPU', manufacturer: 'AMD', quantity: 1, price: 1000000, note: '' }]
        }] },
        { id: 'msg-latest', role: 'assistant', text: '다른 설명을 드렸습니다.', createdAt: '2026-07-15T09:00:01.000Z', kind: 'general' }
      ],
      latestBuilds: [],
      savedBuildIds: {},
      updatedAt: '2026-07-15T09:00:01.000Z'
    }));
  });
  let applyCalls = 0;
  let buildChatCalls = 0;
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'user-natural-missing', email: 'user@example.com', name: 'Demo User', role: 'USER' }) });
  });
  await page.route('**/api/quote-drafts/current**', async (route) => {
    if (route.request().method() === 'PUT') applyCalls += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(emptyDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });
  await page.route('**/api/ai/build-chat', async (route) => {
    buildChatCalls += 1;
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/self-quote');
  await page.getByRole('textbox', { name: 'AI 챗봇에게 PC 사양 질문' }).fill('적용해줘');
  await page.getByRole('button', { name: '질문 보내기' }).click();

  await expect(page.getByTestId('ai-chat-messages')).toContainText('바로 앞 대화에 적용할 변경안이 없습니다');
  expect(applyCalls).toBe(0);
  expect(buildChatCalls).toBe(0);
});

test('requires card selection when natural-language apply follows multiple builds', async ({ page }) => {
  await page.addInitScript(() => {
    const makeBuild = (id: string, partId: string, name: string) => ({
      id,
      tier: 'balanced',
      label: '추천',
      title: name,
      summary: '',
      totalPrice: 1500000,
      badges: [],
      budgetWon: 1500000,
      budgetLabel: '150만원',
      tierLabel: '균형형',
      appliedPartCategories: [],
      items: [{ partId, category: 'CPU', name, manufacturer: 'AMD', quantity: 1, price: 1500000, note: '' }]
    });
    localStorage.setItem('buildgraph.token', 'jwt-user-token');
    localStorage.setItem('buildgraph.authUser', JSON.stringify({ id: 'user-natural-ambiguous', email: 'user@example.com', name: 'Demo User', role: 'USER' }));
    sessionStorage.setItem('buildgraph.ai.assistantSession:user-natural-ambiguous', JSON.stringify({
      messages: [{
        id: 'msg-multiple-builds',
        role: 'assistant',
        text: '두 가지 조합을 추천합니다.',
        createdAt: '2026-07-15T09:00:00.000Z',
        kind: 'budget',
        builds: [makeBuild('build-a', 'part-a', '추천 CPU A'), makeBuild('build-b', 'part-b', '추천 CPU B')]
      }],
      latestBuilds: [],
      savedBuildIds: {},
      updatedAt: '2026-07-15T09:00:00.000Z'
    }));
  });
  let applyCalls = 0;
  let buildChatCalls = 0;
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'user-natural-ambiguous', email: 'user@example.com', name: 'Demo User', role: 'USER' }) });
  });
  await page.route('**/api/quote-drafts/current**', async (route) => {
    if (route.request().method() === 'PUT') applyCalls += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(emptyDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });
  await page.route('**/api/ai/build-chat', async (route) => {
    buildChatCalls += 1;
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/self-quote');
  await page.getByRole('textbox', { name: 'AI 챗봇에게 PC 사양 질문' }).fill('적용해줘');
  await page.getByRole('button', { name: '질문 보내기' }).click();

  await expect(page.getByTestId('ai-chat-messages')).toContainText('선택 가능한 조합이 여러 개입니다');
  expect(applyCalls).toBe(0);
  expect(buildChatCalls).toBe(0);
});

test('hides the compare entry when there is no recent AI recommendation batch', async ({ page }) => {
  await loginAsUser(page);
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(emptyDraft) });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });

  await page.goto('/self-quote');

  await expect(page.getByTestId('quote-start-banner')).toBeVisible();
  await expect(page.getByTestId('quote-compare-open')).toHaveCount(0);
});

test.skip('upgrade advisor turns a symptom into a replacement simulation question', async ({ page }) => {
  // R1 업그레이드 진단: 증상 선택 → 현재 장착 부품보다 상위 후보 2안(최소/고성능) 제시 →
  // 클릭하면 기존 교체 시뮬레이션 질문("…로 바꾸면 어때?")을 챗봇에 자동 전송한다.
  // 챗봇 전송은 ownerKey(authUser)가 필요하다 — 토큰만으로는 로그인 안내로 빠진다.
  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.token', 'jwt-user-token');
    localStorage.setItem('buildgraph.authUser', JSON.stringify({ id: 'user-test', email: 'user@example.com', name: 'Demo User', role: 'USER' }));
  });
  const partSearches: Array<{ category: string | null; minPrice: string | null }> = [];
  const chatMessages: string[] = [];

  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...emptyDraft,
        items: [draftItem('part-gpu-now', 'GPU', '현재 GPU', 900000)],
        totalPrice: 900000,
        itemCount: 1
      })
    });
  });
  await page.route('**/api/parts**', async (route) => {
    const url = new URL(route.request().url());
    const minPrice = url.searchParams.get('minPrice');
    partSearches.push({ category: url.searchParams.get('category'), minPrice });
    const items = minPrice === '900001'
      ? [candidatePart('part-gpu-step', 'GPU', '한 단계 위 GPU', { price: 1100000 })]
      : minPrice === '1440000'
        ? [candidatePart('part-gpu-max', 'GPU', '고성능 GPU', { price: 1600000 })]
        : [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items, page: 0, size: 1, total: items.length }) });
  });
  await page.route('**/api/ai/build-chat', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { message?: string };
    chatMessages.push(body.message ?? '');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ answerType: 'GENERAL', message: '교체 성능을 비교했습니다.', builds: [], warnings: [] })
    });
  });

  await page.goto('/self-quote');

  await page.getByTestId('upgrade-advisor-open').click();
  await expect(page.getByTestId('upgrade-advisor-panel')).toBeVisible();
  await page.getByTestId('upgrade-symptom-frame').click();

  // 현재가(90만) 기준 상위 후보 두 티어를 조회한다.
  await expect(page.getByTestId('upgrade-option-minimal')).toContainText('한 단계 위 GPU');
  await expect(page.getByTestId('upgrade-option-minimal')).toContainText('(+200,000원)');
  await expect(page.getByTestId('upgrade-option-performance')).toContainText('고성능 GPU');
  expect(partSearches.filter((search) => search.category === 'GPU').map((search) => search.minPrice)).toEqual(
    expect.arrayContaining(['900001', '1440000'])
  );

  // 후보 클릭 → 챗봇이 열리고 교체 시뮬레이션 질문이 자동 전송된다.
  await page.getByTestId('upgrade-option-minimal').click();
  await expect(page.getByTestId('ai-chatbot-panel')).toBeVisible();
  await expect.poll(() => chatMessages).toEqual(['한 단계 위 GPU(으)로 바꾸면 어때?']);
});

test.skip('upgrade advisor guides to mount the category first when it is missing', async ({ page }) => {
  await loginAsUser(page);
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...emptyDraft,
        items: [draftItem('part-cpu-now', 'CPU', '현재 CPU', 400000)],
        totalPrice: 400000,
        itemCount: 1
      })
    });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });

  await page.goto('/self-quote');

  await page.getByTestId('upgrade-advisor-open').click();
  await page.getByTestId('upgrade-symptom-frame').click();

  // GPU가 견적에 없으므로 진단 대신 장착 안내 + 후보 패널 열기로 이어준다.
  await expect(page.getByTestId('upgrade-advisor-panel')).toContainText('먼저 GPU를 견적에 담아 주세요');
  await page.getByTestId('upgrade-open-slot').click();
  await expect(page).toHaveURL('/self-quote?category=GPU');
  await expect(page.getByTestId('slot-candidate-panel')).toBeVisible();
});

test('keeps the applied draft visible without rendering a duplicate selected AI build panel', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.token', 'jwt-user-token');
    localStorage.setItem('buildgraph.authUser', JSON.stringify({
      id: 'user-test',
      email: 'user@example.com',
      name: 'Demo User',
      role: 'USER'
    }));
    sessionStorage.setItem('buildgraph.ai.selectedBuild:user-test', JSON.stringify({
      id: 'ai-balanced',
      tier: 'balanced',
      title: '균형 추천 조합',
      summary: 'QHD 게임과 개발을 함께 고려한 데모 조합입니다.',
      totalPrice: 1980000,
      appliedPartCategories: ['GPU'],
      selectedAt: '2026-06-30T09:00:00.000Z',
      items: [
        {
          partId: 'part-gpu-test',
          category: 'GPU',
          name: 'RTX 4070 SUPER 테스트',
          manufacturer: 'NVIDIA',
          quantity: 1,
          price: 890000,
          note: 'QHD 게임용 그래픽카드'
        },
        {
          partId: 'ai-cpu-balanced',
          category: 'CPU',
          name: 'Ryzen 7 AI 균형 CPU',
          manufacturer: 'AMD',
          quantity: 1,
          price: 420000,
          note: '게임과 개발 균형'
        }
      ]
    }));
  });

  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'draft-ai-panel-test',
        status: 'ACTIVE',
        name: '셀프 견적',
        items: [draftItem('part-gpu-test', 'GPU', 'RTX 4070 SUPER 테스트', 890000)],
        totalPrice: 890000,
        itemCount: 1
      })
    });
  });

  await page.route('**/api/parts**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/price-history')) {
      await mockEmptyPriceHistory(route, 'part-gpu-test');
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [candidatePart('part-gpu-test', 'GPU', 'RTX 4070 SUPER 테스트', { price: 890000 })],
        page: 0,
        size: 20,
        total: 1
      })
    });
  });

  await page.goto('/self-quote?category=GPU');

  await expect(page.getByTestId('ai-selected-build-panel')).toHaveCount(0);
  await expect(page.getByTestId('ai-chatbot-panel')).toBeVisible();
  await expect(page.getByTestId('checklist-GPU')).toContainText('RTX 4070 SUPER 테스트');
  await expect(page.getByTestId('checklist-CPU')).toContainText('+ 부품 선택');
  await expect(page.getByRole('heading', { name: '셀프 견적 · 구성 관계도' })).toHaveCount(0);
  await expect(page.getByTestId('quote-summary-bar')).toContainText('890,000원');
});

test('keeps the current draft total without rendering the removed AI price panel', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.token', 'jwt-user-token');
    localStorage.setItem('buildgraph.authUser', JSON.stringify({
      id: 'user-test',
      email: 'user@example.com',
      name: 'Demo User',
      role: 'USER'
    }));
    sessionStorage.setItem('buildgraph.ai.selectedBuild:user-test', JSON.stringify({
      id: 'ai-price-change-savings',
      tier: 'balanced',
      title: '가격 비교 추천 조합',
      summary: '추천 시점 대비 현재가 비교 테스트 조합입니다.',
      totalPrice: 1310000,
      appliedPartCategories: ['GPU', 'CPU'],
      selectedAt: '2026-06-30T09:00:00.000Z',
      items: [
        {
          partId: 'part-gpu-price-change',
          category: 'GPU',
          name: 'RTX 가격 비교 GPU',
          manufacturer: 'NVIDIA',
          quantity: 1,
          price: 890000,
          note: '추천 시점 GPU 가격'
        },
        {
          partId: 'part-cpu-price-change',
          category: 'CPU',
          name: 'Ryzen 가격 비교 CPU',
          manufacturer: 'AMD',
          quantity: 1,
          price: 420000,
          note: '추천 시점 CPU 가격'
        }
      ]
    }));
  });

  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'draft-price-change-savings',
        status: 'ACTIVE',
        name: '셀프 견적',
        items: [
          {
            ...draftItem('part-gpu-price-change', 'GPU', 'RTX 가격 비교 GPU', 890000),
            currentPrice: 850000,
            lineTotal: 850000
          },
          {
            ...draftItem('part-cpu-price-change', 'CPU', 'Ryzen 가격 비교 CPU', 420000),
            currentPrice: 410000,
            lineTotal: 410000
          }
        ],
        totalPrice: 1260000,
        itemCount: 2
      })
    });
  });

  await page.route('**/api/parts**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/price-history')) {
      await mockEmptyPriceHistory(route, 'part-price-change');
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 })
    });
  });

  await page.goto('/self-quote');

  await expect(page.getByTestId('ai-selected-build-panel')).toHaveCount(0);
  await expect(page.getByTestId('quote-summary-bar')).toContainText('1,260,000원');
  await expect(page.getByTestId('checklist-GPU')).toContainText('RTX 가격 비교 GPU');
  await expect(page.getByTestId('checklist-CPU')).toContainText('Ryzen 가격 비교 CPU');
  await expect(page.getByTestId('quote-price-change-summary')).toHaveCount(0);
  await expect(page.getByTestId('quote-price-change-list')).toHaveCount(0);
  await expect(page.getByText(/AI 추천 시점 대비/)).toHaveCount(0);
});

test('does not show selected AI build increase summary in the slot status bar', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.token', 'jwt-user-token');
    localStorage.setItem('buildgraph.authUser', JSON.stringify({
      id: 'user-test',
      email: 'user@example.com',
      name: 'Demo User',
      role: 'USER'
    }));
    sessionStorage.setItem('buildgraph.ai.selectedBuild:user-test', JSON.stringify({
      id: 'ai-price-change-increase',
      tier: 'balanced',
      title: '상승 비교 추천 조합',
      summary: '추천 시점 대비 현재가 상승 비교 테스트 조합입니다.',
      totalPrice: 1000000,
      appliedPartCategories: ['GPU'],
      selectedAt: '2026-06-30T09:00:00.000Z',
      items: [
        {
          partId: 'part-gpu-price-increase',
          category: 'GPU',
          name: 'RTX 상승 비교 GPU',
          manufacturer: 'NVIDIA',
          quantity: 1,
          price: 1000000,
          note: '추천 시점 GPU 가격'
        }
      ]
    }));
  });

  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'draft-price-change-increase',
        status: 'ACTIVE',
        name: '셀프 견적',
        items: [
          {
            ...draftItem('part-gpu-price-increase', 'GPU', 'RTX 상승 비교 GPU', 1000000),
            currentPrice: 1080000,
            lineTotal: 1080000
          }
        ],
        totalPrice: 1080000,
        itemCount: 1
      })
    });
  });

  await page.route('**/api/parts**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/price-history')) {
      await mockEmptyPriceHistory(route, 'part-gpu-price-increase');
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 })
    });
  });

  await page.goto('/self-quote');

  await expect(page.getByTestId('quote-summary-bar')).toBeVisible();
  await expect(page.getByTestId('quote-price-change-summary')).toHaveCount(0);
  await expect(page.getByTestId('quote-price-change-list')).toHaveCount(0);
  await expect(page.getByText(/AI 추천 시점 대비/)).toHaveCount(0);
});

test('does not show selected AI build no-movement summary in the slot status bar', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.token', 'jwt-user-token');
    localStorage.setItem('buildgraph.authUser', JSON.stringify({
      id: 'user-test',
      email: 'user@example.com',
      name: 'Demo User',
      role: 'USER'
    }));
    sessionStorage.setItem('buildgraph.ai.selectedBuild:user-test', JSON.stringify({
      id: 'ai-price-change-same',
      tier: 'balanced',
      title: '동일 가격 추천 조합',
      summary: '추천 시점 대비 현재가 동일 테스트 조합입니다.',
      totalPrice: 890000,
      appliedPartCategories: ['GPU'],
      selectedAt: '2026-06-30T09:00:00.000Z',
      items: [
        {
          partId: 'part-gpu-price-same',
          category: 'GPU',
          name: 'RTX 동일 가격 GPU',
          manufacturer: 'NVIDIA',
          quantity: 1,
          price: 890000,
          note: '추천 시점 GPU 가격'
        }
      ]
    }));
  });

  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'draft-price-change-same',
        status: 'ACTIVE',
        name: '셀프 견적',
        items: [draftItem('part-gpu-price-same', 'GPU', 'RTX 동일 가격 GPU', 890000)],
        totalPrice: 890000,
        itemCount: 1
      })
    });
  });

  await page.route('**/api/parts**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/price-history')) {
      await mockEmptyPriceHistory(route, 'part-gpu-price-same');
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 })
    });
  });

  await page.goto('/self-quote');

  await expect(page.getByTestId('quote-summary-bar')).toBeVisible();
  await expect(page.getByTestId('quote-price-change-summary')).toHaveCount(0);
  await expect(page.getByTestId('quote-price-change-list')).toHaveCount(0);
  await expect(page.getByText(/AI 추천 시점 대비/)).toHaveCount(0);
});

test('shows the chatbot replacement in the draft without rendering the removed selected panel', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.token', 'jwt-user-token');
    localStorage.setItem('buildgraph.authUser', JSON.stringify({
      id: 'user-test',
      email: 'user@example.com',
      name: 'Demo User',
      role: 'USER'
    }));
    sessionStorage.setItem('buildgraph.ai.selectedBuild:user-test', JSON.stringify({
      id: 'ai-performance',
      tier: 'performance',
      title: '고성능형 추천 조합',
      summary: 'RTX 5090을 포함한 AI 추천 조합입니다.',
      totalPrice: 11606530,
      appliedPartCategories: ['GPU'],
      selectedAt: '2026-06-30T09:00:00.000Z',
      items: [
        {
          partId: 'part-gpu-5090-original',
          category: 'GPU',
          name: '조텍 GAMING 지포스 RTX 5090 SOLID OC D7 32GB',
          manufacturer: '조텍',
          quantity: 1,
          price: 5002190,
          note: 'AI 최초 추천 GPU'
        },
        {
          partId: 'part-cpu-ai-original',
          category: 'CPU',
          name: 'AI 최초 추천 CPU',
          manufacturer: 'AMD',
          quantity: 1,
          price: 6604340,
          note: 'AI 최초 추천 CPU'
        }
      ]
    }));
  });

  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'user-test',
        email: 'user@example.com',
        name: 'Demo User',
        role: 'USER'
      })
    });
  });

  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'draft-ai-replaced-panel-test',
        status: 'ACTIVE',
        name: '셀프 견적',
        items: [draftItem('part-gpu-5080-replaced', 'GPU', 'MSI 지포스 RTX 5080 쉐도우 3X OC D7 16GB MSI코리아', 2078000)],
        totalPrice: 8682340,
        itemCount: 1
      })
    });
  });

  await page.route('**/api/parts**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/price-history')) {
      await mockEmptyPriceHistory(route, 'part-gpu-5080-replaced');
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 })
    });
  });

  await page.goto('/self-quote?category=GPU');

  await expect(page.getByTestId('ai-selected-build-panel')).toHaveCount(0);
  await expect(page.getByTestId('checklist-GPU')).toContainText('RTX 5080');
  await expect(page.getByTestId('quote-summary-bar')).toContainText('8,682,340원');
});

test('shows price trend chart on product detail page', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.token', 'jwt-user-token');
  });

  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'user-test',
        email: 'user@example.com',
        name: 'Demo User',
        role: 'USER'
      })
    });
  });

  await page.route('**/api/parts/part-gpu-trend-test**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/price-history')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          partId: 'part-gpu-trend-test',
          partName: '가격 추이 RTX 테스트',
          currentPrice: 950000,
          days: 3650,
          source: 'NAVER_SHOPPING_SEARCH',
          items: [
            { price: 1030000, source: 'NAVER_SHOPPING_SEARCH', collectedAt: '2026-06-05T00:00:00Z' },
            { price: 1020000, source: 'DANAWA_PRICE_TREND', collectedAt: '2026-06-01T00:00:00Z' },
            { price: 990000, source: 'DANAWA_PRICE_TREND', collectedAt: '2026-06-20T00:00:00Z' },
            // 서버가 KST 7월 월초 자정을 UTC로 직렬화한 형태 — 브라우저 타임존과 무관하게 26.07로 버킷돼야 한다.
            { price: 950000, source: 'DANAWA_PRICE_TREND', collectedAt: '2026-06-30T15:00:00Z' }
          ],
          summary: {
            sampleCount: 4,
            currentPrice: 950000,
            minPrice: 950000,
            maxPrice: 1030000,
            firstPrice: 1030000,
            lastPrice: 950000,
            changeAmount: -80000,
            changeRatePercent: -7.77
          }
        })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'part-gpu-trend-test',
        category: 'GPU',
        name: '가격 추이 RTX 테스트',
        manufacturer: 'NVIDIA',
        price: 950000,
        status: 'ACTIVE',
        latestPriceCollectedAt: '2026-06-29T00:00:00Z',
        attributes: {
          shortSpec: 'RTX price trend test',
          vramGb: 12,
          wattage: 220
        },
        externalOffer: {
          imageUrl: 'https://example.test/trend-gpu.png',
          supplierName: '가격테스트몰',
          offerUrl: 'https://example.test/trend-gpu',
          lowPrice: 950000,
          source: 'NAVER_SHOPPING_SEARCH'
        }
      })
    });
  });

  await page.goto('/parts/part-gpu-trend-test');

  await expect(page.getByRole('heading', { name: '가격 추이 RTX 테스트' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '주요 스펙' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '가격 변동 추이' })).toBeVisible();
  await expect(page.getByRole('img', { name: '가격 변동 추이 그래프' })).toBeVisible();
  await expect(page.getByText('950,000원').first()).toBeVisible();
  await expect(page.getByText('26.06')).toBeVisible();
  await expect(page.getByText('26.07')).toBeVisible();
  await expect(page.getByLabel('가격 변동 추이 그래프').getByText('현재가')).toBeVisible();
  await expect(page.getByText('103만')).toBeVisible();
  await expect(page.getByText('99만')).toBeVisible();
  await expect(page.getByText('95만')).toBeVisible();
  await expect(page.getByText('-80,000원 (-7.77%)')).toBeVisible();
  await page.getByTestId('price-trend-point').first().hover();
  await expect(page.getByTestId('price-trend-tooltip')).toBeVisible();
  await expect(page.getByTestId('price-trend-tooltip').getByText(/다나와 추이/)).toBeVisible();
  await expect(page.getByText('전체 내부 스펙')).toHaveCount(0);
});

test('returns to the product detail page after login from its redirect', async ({ page }) => {
  let savedToDraft = false;

  await page.route('**/api/parts/part-gpu-detail-test', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'part-gpu-detail-test',
        category: 'GPU',
        name: '상세 담기 RTX 테스트',
        manufacturer: 'NVIDIA',
        price: 1200000,
        status: 'ACTIVE',
        attributes: {
          shortSpec: 'RTX detail save test',
          toolReady: true
        },
        externalOffer: {
          imageUrl: 'https://example.test/detail-gpu.png',
          supplierName: '상세테스트몰',
          offerUrl: 'https://example.test/detail-gpu',
          lowPrice: 1200000,
          source: 'NAVER_SHOPPING_SEARCH'
        }
      })
    });
  });

  await page.route('**/api/auth/login', async (route) => {
    expect(JSON.parse(route.request().postData() ?? '{}')).toEqual({
      email: 'user@example.com',
      password: 'passw0rd!'
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        accessToken: 'jwt-user-token',
        refreshToken: 'demo-refresh-user',
        user: {
          id: 'user-test',
          email: 'user@example.com',
          name: 'Demo User',
          role: 'USER'
        }
      })
    });
  });

  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'user-test',
        email: 'user@example.com',
        name: 'Demo User',
        role: 'USER'
      })
    });
  });

  await page.route('**/api/quote-drafts/current/items/part-gpu-detail-test', async (route) => {
    expect(route.request().method()).toBe('PUT');
    expect(route.request().headers().authorization).toBe('Bearer jwt-user-token');
    savedToDraft = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'draft-detail-test',
        status: 'ACTIVE',
        name: '셀프 견적',
        items: [
          {
            id: 'draft-item-detail-test',
            partId: 'part-gpu-detail-test',
            category: 'GPU',
            name: '상세 담기 RTX 테스트',
            quantity: 1,
            currentPrice: 1200000,
            lineTotal: 1200000
          }
        ],
        totalPrice: 1200000,
        itemCount: 1
      })
    });
  });

  await page.goto('/parts/part-gpu-detail-test');
  await expect(page).toHaveURL('/login?redirect=%2Fparts%2Fpart-gpu-detail-test');
  await page.getByLabel('이메일').fill('user@example.com');
  await page.getByLabel('비밀번호').fill('passw0rd!');
  await page.getByRole('button', { name: '로그인' }).click();

  // 로그인 전 보던 상세 페이지로 복귀한다(가드가 보존한 redirect 파라미터).
  await expect(page).toHaveURL('/parts/part-gpu-detail-test');
  await expect(page.getByRole('heading', { name: '상세 담기 RTX 테스트' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('buildgraph.refreshToken'))).toBe('demo-refresh-user');
  await page.locator('summary[aria-label^="계정 메뉴:"]').click();
  await expect(page.getByText('user@example.com')).toBeVisible();

  expect(savedToDraft).toBe(false);
});

test('records home recommendation detail and draft add events on product detail page', async ({ page }) => {
  const events: Array<{ eventType?: string; sourceSurface?: string; recommendationId?: string; rankPosition?: number; partId?: string }> = [];

  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.token', 'jwt-user-token');
  });

  await page.route('**/api/parts/part-home-rec-test**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/price-history')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          partId: 'part-home-rec-test',
          partName: '홈 추천 상세 이벤트 GPU',
          currentPrice: 1500000,
          days: 3650,
          items: [{ price: 1500000, source: 'NAVER_SHOPPING_SEARCH', collectedAt: '2026-07-03T00:00:00Z' }],
          summary: {
            sampleCount: 1,
            currentPrice: 1500000,
            minPrice: 1500000,
            maxPrice: 1500000,
            firstPrice: 1500000,
            lastPrice: 1500000,
            changeAmount: 0,
            changeRatePercent: 0
          }
        })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'part-home-rec-test',
        category: 'GPU',
        name: '홈 추천 상세 이벤트 GPU',
        manufacturer: 'NVIDIA',
        price: 1500000,
        status: 'ACTIVE',
        attributes: { shortSpec: '추천 이벤트 저장 테스트', toolReady: true },
        externalOffer: {
          imageUrl: 'https://example.test/home-rec-gpu.png',
          supplierName: '추천테스트몰',
          offerUrl: null,
          lowPrice: 1500000,
          source: 'NAVER_SHOPPING_SEARCH'
        }
      })
    });
  });

  await page.route('**/api/recommendation-events', async (route) => {
    const body = route.request().postDataJSON() as { eventType?: string; sourceSurface?: string; recommendationId?: string; rankPosition?: number; partId?: string };
    events.push(body);
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        id: `event-${events.length}`,
        eventType: body.eventType,
        labelScore: body.eventType === 'ADD_PART_TO_DRAFT' ? 3 : 1,
        sourceSurface: body.sourceSurface,
        recommendationId: body.recommendationId,
        rankPosition: body.rankPosition,
        createdAt: '2026-07-03T10:00:00Z'
      })
    });
  });

  await page.route('**/api/quote-drafts/current/items/part-home-rec-test', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'draft-home-rec-test',
        status: 'ACTIVE',
        name: '셀프 견적',
        items: [],
        totalPrice: 1500000,
        itemCount: 1
      })
    });
  });

  await page.goto('/parts/part-home-rec-test?recId=home-part-part-home-rec-test&recSurface=HOME_RECOMMENDED_PARTS&rank=2');
  await expect(page.getByRole('heading', { name: '홈 추천 상세 이벤트 GPU' })).toBeVisible();
  await expect.poll(() => events.some((event) => event.eventType === 'DETAIL_VIEW')).toBe(true);

  await page.getByRole('button', { name: '견적에 담기' }).click();
  await expect.poll(() => events.some((event) => event.eventType === 'ADD_PART_TO_DRAFT')).toBe(true);
  expect(events).toEqual(expect.arrayContaining([
    expect.objectContaining({
      eventType: 'DETAIL_VIEW',
      sourceSurface: 'HOME_RECOMMENDED_PARTS',
      recommendationId: 'home-part-part-home-rec-test',
      rankPosition: 2,
      partId: 'part-home-rec-test'
    }),
    expect.objectContaining({
      eventType: 'ADD_PART_TO_DRAFT',
      sourceSurface: 'HOME_RECOMMENDED_PARTS',
      recommendationId: 'home-part-part-home-rec-test',
      rankPosition: 2,
      partId: 'part-home-rec-test'
    })
  ]));
});

// 셀프견적 임베드 어시스턴트도 홈과 동일한 공용 컴포넌트라 응답 대기 상태가 떠야 한다(surface별 회귀 방지).
test('셀프견적 임베드 챗봇도 느린 응답 동안 박스 없는 대기 표시를 보여준다', async ({ page }) => {
  await loginAsUser(page);
  // AI 세션 소유자 키는 캐시된 authUser에서 나온다. auth/me 응답을 기다리는 경합 없이
  // 첫 제출부터 owner 키가 준비되도록 localStorage를 직접 심는다(홈 헬퍼와 동일한 패턴).
  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.authUser', JSON.stringify({ id: 'user-test', email: 'user@example.com', name: 'Demo User', role: 'USER' }));
  });
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'draft-loading-smoke', status: 'ACTIVE', name: '셀프 견적', items: [], totalPrice: 0, itemCount: 0 })
    });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });
  let chatCalls = 0;
  await page.route('**/api/ai/build-chat', async (route) => {
    chatCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ answerType: 'GENERAL', message: '셀프견적 응답이 도착했습니다.', builds: [], warnings: [] })
    });
  });

  await page.goto('/self-quote');
  await page.getByRole('textbox', { name: 'AI 챗봇에게 PC 사양 질문' }).fill('200만원 PC 추천');
  await page.getByRole('button', { name: '질문 보내기' }).click();

  const pending = page.getByTestId('ai-chat-pending');
  await expect(pending).toBeVisible();
  await expect(pending).toHaveAttribute('data-response-surface', 'plain');
  await expect(pending).toContainText('답변을 준비하고 있어요');
  expect(chatCalls).toBe(1);

  await expect(page.getByText('셀프견적 응답이 도착했습니다.')).toBeVisible();
  await expect(pending).toHaveCount(0);
});

// 답변이 단계별로 채워지는 동안 최신 글자까지 따라가되, 사용자가 위로 올려 읽는 중에는 끌어내리지 않는다.
test('AI 답변이 길어져도 바닥을 따라가고, 위로 올려 읽는 중에는 새 메시지 버튼으로만 복귀한다', async ({ page }) => {
  await loginAsUser(page);
  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.authUser', JSON.stringify({ id: 'user-follow-scroll', email: 'user@example.com', name: 'Demo User', role: 'USER' }));
  });
  await page.route('**/api/quote-drafts/current**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'draft-follow-scroll', status: 'ACTIVE', name: '셀프 견적', items: [], totalPrice: 0, itemCount: 0 })
    });
  });
  await page.route('**/api/parts**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }) });
  });
  // 컨테이너를 확실히 넘치게 만드는 긴 답변 — 문장이 하나씩 드러나며 높이가 계속 자란다.
  const longAnswer = Array.from({ length: 12 }, (_, index) => (
    `${index + 1}번째 근거 문단입니다. 현재 구성의 전력·발열·장착 여유와 게임별 예상 성능을 근거 수치와 함께 길게 설명하는 문단입니다.`
  )).join(' ');
  await page.route('**/api/ai/build-chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ answerType: 'GENERAL', message: longAnswer, builds: [], warnings: [] })
    });
  });

  await page.goto('/self-quote');
  const messages = page.getByTestId('ai-chat-messages');
  await page.getByRole('textbox', { name: 'AI 챗봇에게 PC 사양 질문' }).fill('현재 견적 평가해줘');
  await page.getByRole('button', { name: '질문 보내기' }).click();
  await expect(messages).toContainText('1번째 근거 문단입니다');

  // 답변이 문장 단위로 드러나며 컨테이너를 넘길 때까지 기다린다(메시지 개수는 그대로인 성장 구간).
  await expect.poll(async () => messages.evaluate((element) => (
    element.scrollHeight - element.clientHeight
  )), { timeout: 15000 }).toBeGreaterThan(100);
  // 마지막 문단까지 드러난 뒤에도 바닥에 붙어 있어야 한다 — 개수만 보던 기존 방식은 여기서 뒤처졌다.
  // (문장이 하나씩 드러나므로 기본 5초보다 넉넉한 대기가 필요하다.)
  await expect(messages).toContainText('12번째 근거 문단입니다', { timeout: 20000 });
  await expect.poll(async () => messages.evaluate((element) => (
    element.scrollHeight - element.scrollTop - element.clientHeight
  )), { timeout: 10000 }).toBeLessThanOrEqual(48);

  // AI가 아직 쓰는 중에 위로 올려 읽으면: 남은 문장이 계속 붙어도 끌어내리지 않고 버튼만 띄운다.
  await page.getByRole('textbox', { name: 'AI 챗봇에게 PC 사양 질문' }).fill('하나 더 물어볼게');
  await page.getByRole('button', { name: '질문 보내기' }).click();
  await expect(messages).toContainText('2번째 근거 문단입니다');
  await messages.evaluate((element) => { element.scrollTop = 0; });

  const scrollToLatest = page.getByTestId('ai-chat-scroll-to-latest');
  await expect(scrollToLatest).toBeVisible();
  expect(await messages.evaluate((element) => element.scrollTop)).toBeLessThan(200);

  // 버튼을 누르면 최신 글자로 복귀하고, 바닥에 닿았으므로 버튼은 사라진다(추적 재개).
  await scrollToLatest.click();
  await expect.poll(async () => messages.evaluate((element) => (
    element.scrollHeight - element.scrollTop - element.clientHeight
  )), { timeout: 10000 }).toBeLessThanOrEqual(48);
  await expect(scrollToLatest).toHaveCount(0);
});

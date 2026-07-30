import { expect, test } from '@playwright/test';

const profile = {
  id: 'tech-external-1',
  displayName: '최민석 기사',
  initials: '최',
  status: 'ACTIVE',
  providerType: 'EXTERNAL',
  verificationStatus: 'APPROVED',
  businessName: '민석 PC 조립',
  contactPhone: '010-0000-1004',
  serviceRegions: ['서울'],
  serviceTypes: ['FULL_SERVICE'],
  specialties: ['저소음 조립'],
  rating: 4.7,
  completedJobs: 41,
  avgResponseMinutes: 15,
  assemblyFee: 70000,
  deliveryFee: 12000,
  leadTimeDays: 2,
  partsPriceAdjustment: 0,
  sortPriority: 100,
  standardAsAccepted: true,
  seeded: true
};

const requestSummary = {
  id: 'assembly-open-1', requestNo: 'ASM-20990720-OPEN0001', status: 'OFFERED',
  serviceType: 'FULL_SERVICE', region: '서울', preferredDate: '2099-07-20',
  deliveryMethod: 'DELIVERY', estimatedPartsPrice: 1400000, itemCount: 2
};

const requestItem = { partId: 'part-gpu', category: 'GPU', name: 'RTX 5070', manufacturer: 'NVIDIA', quantity: 1, unitPrice: 980000, lineTotal: 980000 };

function technicianOwnOffer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'external-offer-1',
    status: 'AVAILABLE',
    confirmedPartsPrice: 1400000,
    assemblyFee: 70000,
    deliveryFee: 0,
    finalPrice: 1470000,
    leadTimeDays: 2,
    stockStatus: '재고 확인 완료',
    warrantyDays: 30,
    message: '기본 공개 제안 메시지',
    note: '기본 공개 제안 메시지',
    updatedAt: '2099-07-01T00:00:00Z',
    ...overrides
  };
}

function technicianRequestDetail(id: string, ownOffer: Record<string, unknown> | null, overrides: Record<string, unknown> = {}) {
  return {
    ...requestSummary,
    id,
    requestNo: `ASM-${id}`,
    status: 'OFFERED',
    itemCount: 1,
    items: [requestItem],
    ownOffer,
    contact: null,
    note: null,
    ...overrides
  };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('buildgraph.token', 'jwt-user-token'));
  await page.route('**/api/auth/me', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'user-tech', email: 'technician@example.com', name: 'Demo Technician', role: 'USER' }) }));
  await page.route('**/api/support/chat-sessions/current**', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'NOT_FOUND', message: '상담방 없음' }) }));
  await page.route('**/api/technician/profile', (route) => route.fulfill({ status: 204 }));
});

test('refreshes checkout offers when a new technician offer arrives', async ({ page }) => {
  let includeExternalOffer = false;
  const liveRequest = () => ({
    id: 'assembly-live-1',
    requestNo: 'ASM-20990721-LIVE0001',
    status: 'OFFERED',
    serviceType: 'FULL_SERVICE',
    region: '서울',
    preferredDate: '2099-07-21',
    deliveryMethod: 'DELIVERY',
    note: '',
    asPolicyAccepted: true,
    estimatedPartsPrice: 1_400_000,
    itemCount: 1,
    selectedOfferId: null,
    canCancel: true,
    items: [{ partId: 'part-gpu', category: 'GPU', name: 'RTX 5070', manufacturer: 'NVIDIA', quantity: 1, unitPrice: 980_000, lineTotal: 980_000 }],
    offers: [
      { id: 'offer-internal', technicianId: 'tech-internal', technicianName: '내부 빠른 기사', initials: '내', rating: 4.9, completedJobs: 184, responseMinutes: 12, specialties: ['고성능 게이밍 PC'], standardAsAccepted: true, providerType: 'INTERNAL', verified: true, status: 'AVAILABLE', confirmedPartsPrice: 1_405_000, assemblyFee: 65_000, deliveryFee: 0, finalPrice: 1_470_000, leadTimeDays: 2, stockStatus: '주요 부품 재고 확인' },
      ...(includeExternalOffer ? [{ id: 'offer-external-live', technicianId: 'tech-external-live', technicianName: '새 외부 기사', initials: '새', rating: 4.8, completedJobs: 44, responseMinutes: 10, specialties: ['저소음 조립'], standardAsAccepted: true, providerType: 'EXTERNAL', verified: true, status: 'AVAILABLE', confirmedPartsPrice: 1_398_000, assemblyFee: 72_000, deliveryFee: 12_000, finalPrice: 1_482_000, leadTimeDays: 2, stockStatus: '재고 확인 완료' }] : [])
    ],
    payment: null,
    statusHistory: [{ fromStatus: null, toStatus: 'REQUESTED', note: '조립 요청 등록' }]
  });
  await page.route('**/api/assembly-requests/assembly-live-1', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(liveRequest()) });
  });

  await page.goto('/checkout/offers/assembly-live-1');

  await expect(page.getByRole('heading', { name: '기사 제안 1건' })).toBeVisible();
  const platformSection = page.getByTestId('internal-offer-section');
  await expect(platformSection.getByRole('heading', { name: '플랫폼 즉시 제안', level: 2 })).toBeVisible();
  await expect(platformSection.getByRole('button', { name: '이 제안 선택' })).toBeEnabled();
  await expect(page.getByText('내부 빠른 기사')).toHaveCount(0);

  includeExternalOffer = true;

  await expect(page.getByRole('heading', { name: '기사 제안 2건' })).toBeVisible({ timeout: 7000 });
  await expect(page.getByText('새 외부 기사')).toBeVisible();
  await expect(page.getByText('새 기사 제안 1건이 도착했습니다.')).toBeVisible();
});

test('submits a lightweight external technician application', async ({ page }) => {
  let submitted = false;
  await page.route('**/api/technician/profile', (route) => route.fulfill({ status: 204 }));
  await page.route('**/api/technician/applications', async (route) => {
    submitted = true;
    const body = route.request().postDataJSON();
    expect(body.standardAsAccepted).toBe(true);
    expect(body.serviceRegions).toContain('서울');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...profile, status: 'INACTIVE', verificationStatus: 'PENDING' }) });
  });

  await page.goto('/technician/apply');
  await page.getByLabel('기사 활동명').fill('외부 테스트 기사');
  await page.getByLabel('연락처').fill('010-1111-2222');
  await page.getByRole('checkbox', { name: /표준 AS 정책/ }).check();
  await expect(page.getByRole('button', { name: '기사 신청 제출' })).toBeEnabled();
  await page.getByRole('button', { name: '기사 신청 제출' }).click();

  await expect(page.getByText('기사 신청이 접수되었습니다')).toBeVisible();
  expect(submitted).toBe(true);
});

test('shows matched anonymous requests and submits an external offer without contact data', async ({ page }) => {
  let ownOffer: Record<string, unknown> | null = null;
  let submittedPayload: Record<string, unknown> | null = null;
  let userOfferEndpointCalls = 0;
  await page.route('**/api/technician/profile', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile) }));
  await page.route('**/api/technician/assembly-requests?scope=OPEN**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [requestSummary], page: 0, size: 20, total: 1 }) }));
  await page.route('**/api/assembly-requests/**', (route) => {
    userOfferEndpointCalls += 1;
    return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'UNEXPECTED_USER_OFFER_API' }) });
  });
  await page.route('**/api/technician/assembly-requests/assembly-open-1**', async (route) => {
    if (route.request().method() === 'POST') {
      submittedPayload = route.request().postDataJSON();
      ownOffer = { id: 'external-offer-1', status: 'AVAILABLE', confirmedPartsPrice: 1400000, assemblyFee: 70000, deliveryFee: 0, finalPrice: 1470000, leadTimeDays: 2, stockStatus: '재고 확인 완료', warrantyDays: 0, message: '조립 후 기본 점검을 포함합니다.', note: '조립 후 기본 점검을 포함합니다.' };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...requestSummary, items: [{ partId: 'part-gpu', category: 'GPU', name: 'RTX 5070', manufacturer: 'NVIDIA', quantity: 1, unitPrice: 980000, lineTotal: 980000 }], ownOffer, contact: null, note: null, otherOffers: [{ technicianName: 'OTHER_TECHNICIAN_SECRET_RFQ_4B2', assemblyFee: 999999 }] }) });
  });

  await page.goto('/technician');
  await expect(page.getByText('ASM-20990720-OPEN0001')).toBeVisible();
  await page.getByText('ASM-20990720-OPEN0001').click();
  await expect(page.getByText('RTX 5070')).toBeVisible();
  await expect(page.getByText('010-1234-5678')).toHaveCount(0);
  await page.getByLabel('재고 확인 문구').fill('재고 확인 완료');
  await page.getByLabel('보증 기간').fill('0');
  await page.getByLabel('제안 메시지').fill('조립 후 기본 점검을 포함합니다.');
  await page.getByRole('button', { name: '제안 제출' }).click();
  await expect(page.getByText('수정 가능')).toBeVisible();
  expect(submittedPayload).toEqual({
    assemblyFee: 70000,
    leadTimeDays: 2,
    stockStatus: '재고 확인 완료',
    warrantyDays: 0,
    message: '조립 후 기본 점검을 포함합니다.'
  });
  expect(submittedPayload).not.toHaveProperty('confirmedPartsPrice');
  expect(submittedPayload).not.toHaveProperty('deliveryFee');
  expect(submittedPayload).not.toHaveProperty('finalPrice');
  expect(submittedPayload).not.toHaveProperty('adminNote');
  expect(submittedPayload).not.toHaveProperty('note');
  expect(userOfferEndpointCalls).toBe(0);
  await expect(page.getByText('OTHER_TECHNICIAN_SECRET_RFQ_4B2')).toHaveCount(0);
});

test('loads canonical offer values and updates or deletes the public message', async ({ page }) => {
  const requestId = 'assembly-edit-contract';
  const longMessage = '가'.repeat(500);
  const patchPayloads: Array<Record<string, unknown>> = [];
  let ownOffer: Record<string, unknown> = technicianOwnOffer({
    message: 'CANONICAL_MESSAGE_RFQ_4B2',
    note: 'LEGACY_NOTE_SHOULD_NOT_WIN',
    adminNote: 'ADMIN_NOTE_SECRET_RFQ_4B2',
    warrantyDays: 30,
    assemblyFee: 71000,
    leadTimeDays: 3
  });
  await page.route('**/api/technician/profile', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile) }));
  await page.route(`**/api/technician/assembly-requests/${requestId}`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(technicianRequestDetail(requestId, ownOffer))
  }));
  await page.route('**/api/technician/offers/external-offer-1', async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    patchPayloads.push(payload);
    ownOffer = {
      ...ownOffer,
      ...payload,
      message: payload.message ?? null,
      note: payload.message ?? null,
      updatedAt: `2099-07-01T00:00:0${patchPayloads.length}Z`
    };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ownOffer) });
  });

  await page.goto(`/technician/requests/${requestId}`);

  await expect(page.getByLabel('조립 공임')).toHaveValue('71000');
  await expect(page.getByLabel('예상 작업 기간')).toHaveValue('3');
  await expect(page.getByLabel('보증 기간')).toHaveValue('30');
  await expect(page.getByLabel('제안 메시지')).toHaveValue('CANONICAL_MESSAGE_RFQ_4B2');
  await expect(page.getByText('LEGACY_NOTE_SHOULD_NOT_WIN')).toHaveCount(0);
  await expect(page.getByText('ADMIN_NOTE_SECRET_RFQ_4B2')).toHaveCount(0);

  await page.getByLabel('조립 공임').fill('75000');
  await page.getByLabel('예상 작업 기간').fill('4');
  await page.getByLabel('보증 기간').fill('365');
  await page.getByLabel('제안 메시지').fill(longMessage);
  await expect(page.getByText('500/500')).toBeVisible();
  await page.getByRole('button', { name: '제안 수정' }).click();
  await expect.poll(() => patchPayloads.length).toBe(1);

  expect(patchPayloads[0]).toEqual({
    assemblyFee: 75000,
    leadTimeDays: 4,
    stockStatus: '재고 확인 완료',
    warrantyDays: 365,
    message: longMessage
  });
  expect(patchPayloads[0]).not.toHaveProperty('confirmedPartsPrice');
  expect(patchPayloads[0]).not.toHaveProperty('deliveryFee');
  expect(patchPayloads[0]).not.toHaveProperty('finalPrice');
  expect(patchPayloads[0]).not.toHaveProperty('adminNote');
  expect(patchPayloads[0]).not.toHaveProperty('note');

  await page.getByLabel('제안 메시지').fill('');
  await page.getByRole('button', { name: '제안 수정' }).click();
  await expect.poll(() => patchPayloads.length).toBe(2);
  expect(patchPayloads[1]).toMatchObject({ message: null, warrantyDays: 365 });
  await expect(page.getByLabel('제안 메시지')).toHaveValue('');
});

test('validates warranty boundaries before creating an offer', async ({ page }) => {
  const requestId = 'assembly-warranty-boundary';
  let createCalls = 0;
  let submittedWarranty: unknown;
  let ownOffer: Record<string, unknown> | null = null;
  await page.route('**/api/technician/profile', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile) }));
  await page.route(`**/api/technician/assembly-requests/${requestId}**`, async (route) => {
    if (route.request().method() === 'POST') {
      createCalls += 1;
      submittedWarranty = route.request().postDataJSON().warrantyDays;
      ownOffer = technicianOwnOffer({ warrantyDays: submittedWarranty });
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(technicianRequestDetail(requestId, ownOffer)) });
  });

  await page.goto(`/technician/requests/${requestId}`);

  await page.getByLabel('보증 기간').fill('-1');
  await page.getByRole('button', { name: '제안 제출' }).click();
  await expect(page.getByText('보증 기간은 0~365일 범위의 정수로 입력해 주세요.')).toBeVisible();
  expect(createCalls).toBe(0);

  await page.getByLabel('보증 기간').fill('366');
  await page.getByRole('button', { name: '제안 제출' }).click();
  await expect(page.getByText('보증 기간은 0~365일 범위의 정수로 입력해 주세요.')).toBeVisible();
  expect(createCalls).toBe(0);

  await page.getByLabel('보증 기간').fill('365');
  await page.getByRole('button', { name: '제안 제출' }).click();
  await expect.poll(() => createCalls).toBe(1);
  expect(submittedWarranty).toBe(365);
});

test('keeps dirty offer inputs while the request detail polls', async ({ page }) => {
  const requestId = 'assembly-polling-dirty';
  let detailCalls = 0;
  const originalOffer = technicianOwnOffer({ assemblyFee: 70000, message: '서버 최초 메시지' });
  const polledOffer = technicianOwnOffer({ assemblyFee: 990000, message: '서버 polling 메시지', updatedAt: '2099-07-01T00:00:05Z' });
  await page.route('**/api/technician/profile', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile) }));
  await page.route(`**/api/technician/assembly-requests/${requestId}`, (route) => {
    detailCalls += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(technicianRequestDetail(requestId, detailCalls === 1 ? originalOffer : polledOffer))
    });
  });

  await page.goto(`/technician/requests/${requestId}`);
  await page.getByLabel('조립 공임').fill('77777');
  await page.getByLabel('제안 메시지').fill('polling이 덮어쓰면 안 되는 로컬 입력');
  await expect.poll(() => detailCalls, { timeout: 7000 }).toBeGreaterThan(1);
  await expect(page.getByLabel('조립 공임')).toHaveValue('77777');
  await expect(page.getByLabel('제안 메시지')).toHaveValue('polling이 덮어쓰면 안 되는 로컬 입력');
});

test('serializes save and withdraw actions in the technician offer form', async ({ page }) => {
  const requestId = 'assembly-mutation-lock';
  let ownOffer = technicianOwnOffer();
  let saveCalls = 0;
  let withdrawCalls = 0;
  let releaseSave!: () => void;
  let releaseWithdraw!: () => void;
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
  const withdrawGate = new Promise<void>((resolve) => { releaseWithdraw = resolve; });
  await page.route('**/api/technician/profile', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile) }));
  await page.route(`**/api/technician/assembly-requests/${requestId}`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(technicianRequestDetail(requestId, ownOffer))
  }));
  await page.route('**/api/technician/offers/external-offer-1', async (route) => {
    saveCalls += 1;
    await saveGate;
    ownOffer = { ...ownOffer, ...route.request().postDataJSON(), updatedAt: '2099-07-01T00:00:10Z' };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ownOffer) });
  });
  await page.route('**/api/technician/offers/external-offer-1/withdraw', async (route) => {
    withdrawCalls += 1;
    await withdrawGate;
    ownOffer = { ...ownOffer, status: 'WITHDRAWN', updatedAt: '2099-07-01T00:00:20Z' };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ownOffer) });
  });

  await page.goto(`/technician/requests/${requestId}`);
  await page.getByLabel('조립 공임').fill('72000');
  await page.getByRole('button', { name: '제안 수정' }).click();
  await expect(page.getByRole('button', { name: '제안 저장 중...' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '철회' })).toBeDisabled();
  await page.getByRole('button', { name: '제안 저장 중...' }).evaluate((button: HTMLButtonElement) => button.click());
  expect(saveCalls).toBe(1);
  releaseSave();
  await expect(page.getByRole('button', { name: '제안 수정' })).toBeEnabled();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '철회' }).click();
  await expect(page.getByRole('button', { name: '철회 중...' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '제안 수정' })).toBeDisabled();
  await page.getByRole('button', { name: '철회 중...' }).evaluate((button: HTMLButtonElement) => button.click());
  expect(withdrawCalls).toBe(1);
  releaseWithdraw();
  await expect(page.getByText('철회된 제안')).toBeVisible();
});

test('refreshes and locks the offer when an update conflicts', async ({ page }) => {
  const requestId = 'assembly-update-conflict';
  let detailCalls = 0;
  let updateCalls = 0;
  let ownOffer = technicianOwnOffer();
  await page.route('**/api/technician/profile', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile) }));
  await page.route(`**/api/technician/assembly-requests/${requestId}`, (route) => {
    detailCalls += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(technicianRequestDetail(requestId, ownOffer, { status: ownOffer.status === 'SELECTED' ? 'MATCHED' : 'OFFERED' })) });
  });
  await page.route('**/api/technician/offers/external-offer-1', (route) => {
    updateCalls += 1;
    ownOffer = technicianOwnOffer({ status: 'SELECTED', updatedAt: '2099-07-01T00:01:00Z' });
    return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 'CONFLICT_STATE', message: '이미 선택됨' }) });
  });

  await page.goto(`/technician/requests/${requestId}`);
  await page.getByLabel('조립 공임').fill('73000');
  await page.getByRole('button', { name: '제안 수정' }).click();

  await expect(page.getByTestId('mutation-toast')).toContainText('다른 변경이 먼저 반영되었습니다. 최신 제안 상태를 다시 불러왔습니다.');
  await expect.poll(() => detailCalls).toBeGreaterThan(1);
  await expect(page.getByText('선택된 제안')).toBeVisible();
  await expect(page.getByRole('button', { name: '제안 수정' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '철회' })).toHaveCount(0);
  expect(updateCalls).toBe(1);
});

test('refreshes and locks the offer when withdrawal conflicts', async ({ page }) => {
  const requestId = 'assembly-withdraw-conflict';
  let detailCalls = 0;
  let withdrawCalls = 0;
  let ownOffer = technicianOwnOffer();
  await page.route('**/api/technician/profile', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile) }));
  await page.route(`**/api/technician/assembly-requests/${requestId}`, (route) => {
    detailCalls += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(technicianRequestDetail(requestId, ownOffer)) });
  });
  await page.route('**/api/technician/offers/external-offer-1/withdraw', (route) => {
    withdrawCalls += 1;
    ownOffer = technicianOwnOffer({ status: 'WITHDRAWN', updatedAt: '2099-07-01T00:02:00Z' });
    return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 'CONFLICT_STATE', message: '이미 철회됨' }) });
  });

  await page.goto(`/technician/requests/${requestId}`);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '철회' }).click();

  await expect(page.getByTestId('mutation-toast')).toContainText('다른 변경이 먼저 반영되었습니다. 최신 제안 상태를 다시 불러왔습니다.');
  await expect.poll(() => detailCalls).toBeGreaterThan(1);
  await expect(page.getByText('철회된 제안')).toBeVisible();
  await expect(page.getByRole('button', { name: '제안 수정' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '철회' })).toHaveCount(0);
  expect(withdrawCalls).toBe(1);
});

for (const state of [
  { status: 'SELECTED', requestStatus: 'MATCHED', title: '선택된 제안' },
  { status: 'WITHDRAWN', requestStatus: 'OFFERED', title: '철회된 제안' },
  { status: 'EXPIRED', requestStatus: 'OFFERED', title: '만료된 제안' }
]) {
  test(`locks offer controls when the own offer is ${state.status}`, async ({ page }) => {
    const requestId = `assembly-locked-${state.status.toLowerCase()}`;
    await page.route('**/api/technician/profile', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile) }));
    await page.route(`**/api/technician/assembly-requests/${requestId}`, (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(technicianRequestDetail(requestId, technicianOwnOffer({ status: state.status }), { status: state.requestStatus }))
    }));

    await page.goto(`/technician/requests/${requestId}`);
    await expect(page.getByText(state.title)).toBeVisible();
    await expect(page.getByLabel('조립 공임')).toBeDisabled();
    await expect(page.getByRole('button', { name: '제안 수정' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '철회' })).toHaveCount(0);
  });
}

test('reveals contact only for the selected and paid external technician', async ({ page }) => {
  await page.route('**/api/technician/profile', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile) }));
  await page.route('**/api/technician/assembly-requests/assembly-selected-1', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    ...requestSummary,
    id: 'assembly-selected-1', status: 'MATCHED', paymentStatus: 'PAID',
    items: [{ partId: 'part-gpu', category: 'GPU', name: 'RTX 5070', manufacturer: 'NVIDIA', quantity: 1, unitPrice: 980000, lineTotal: 980000 }],
    ownOffer: { id: 'external-offer-1', status: 'SELECTED', confirmedPartsPrice: 1400000, assemblyFee: 70000, deliveryFee: 0, finalPrice: 1470000, leadTimeDays: 2, stockStatus: '재고 확인 완료', warrantyDays: 30, message: '선택된 제안 메시지', note: '선택된 제안 메시지' },
    contact: { name: '데모 사용자', phone: '010-1234-5678', postalCode: '06236', addressLine1: '서울시 강남구 테헤란로 1', addressLine2: '101호' },
    note: '선정리 요청'
  }) }));

  await page.goto('/technician/requests/assembly-selected-1');
  await expect(page.getByText('010-1234-5678')).toBeVisible();
  await expect(page.getByText(/서울시 강남구 테헤란로 1/)).toBeVisible();
  await expect(page.getByRole('button', { name: '제안 수정' })).toHaveCount(0);
});

test('keeps selected jobs visible after an approved technician is suspended', async ({ page }) => {
  await page.route('**/api/technician/profile', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ...profile, status: 'SUSPENDED' })
  }));
  await page.route('**/api/technician/assembly-requests?scope=SELECTED**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ items: [{ ...requestSummary, id: 'assembly-selected-2', status: 'MATCHED', ownOfferStatus: 'SELECTED', paymentStatus: 'PAID' }], page: 0, size: 20, total: 1 })
  }));

  await page.goto('/technician/jobs');

  await expect(page.getByText('ASM-20990720-OPEN0001')).toBeVisible();
  await expect(page.getByRole('heading', { name: '선택된 작업' })).toBeVisible();
});

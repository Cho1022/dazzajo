import { expect, test, type Page } from '@playwright/test';

const ROOM_ID = '00000000-0000-4000-8000-000000009001';
const TICKET_ID = '00000000-0000-4000-8000-000000006001';

test('티켓이 없는 사용자는 기존 AS 접수 안내를 유지한다', async ({ page }) => {
  await mockUser(page);
  await page.route('**/api/support/chat-sessions/current**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ contact: null, messages: [], supportNewPath: '/support/new', pollingIntervalMs: 5000 })
  }));

  await page.goto('/');
  await page.getByLabel('상담방 열기').click();

  await expect(page.getByText('AS 티켓이 필요합니다.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'AS 접수로 이동' })).toHaveAttribute('href', '/support/new');
});

test('사용자는 STOMP CONNECT와 SEND만 사용하고 canonical event로 optimistic 메시지를 치환한다', async ({ page }) => {
  let legacyPostCalls = 0;
  await installFakeStomp(page);
  await mockUser(page);
  await mockUserChat(page);
  await page.route(`**/api/support/chat-sessions/${ROOM_ID}/messages`, async (route) => {
    legacyPostCalls += 1;
    await route.fulfill({ status: 410, body: 'removed' });
  });

  await page.goto(`/support/${TICKET_ID}`);
  await page.getByLabel('상담방 열기').click();
  await expect(page.getByText('실시간 연결')).toBeVisible();

  const connectFrame = await latestFrame(page, 'CONNECT');
  expect(connectFrame).toContain('Authorization:Bearer jwt-user-token');
  expect(await destinations(page, 'SUBSCRIBE')).toEqual(expect.arrayContaining([
    `/topic/support-chat/rooms/${ROOM_ID}`,
    '/user/queue/support-chat-errors'
  ]));

  await page.getByPlaceholder('메시지를 입력하세요').fill('지금 상담 가능할까요?');
  await page.getByRole('button', { name: '전송' }).click();

  const sendFrame = await latestFrame(page, 'SEND');
  expect(sendFrame).toContain('destination:/app/support-chat/messages');
  const payload = JSON.parse(frameBody(sendFrame)) as { roomId: string; clientMessageId: string; content: string };
  expect(payload.roomId).toBe(ROOM_ID);
  expect(payload.content).toBe('지금 상담 가능할까요?');
  expect(payload.clientMessageId).toMatch(/^[0-9a-f-]{36}$/);
  expect(legacyPostCalls).toBe(0);

  await pushStomp(page, `/topic/support-chat/rooms/${ROOM_ID}`, messageEvent(payload.clientMessageId, '지금 상담 가능할까요?', 'USER'));
  await expect(page.getByText('지금 상담 가능할까요?')).toHaveCount(1);
});

test('개인 오류 queue가 해당 전송 오류를 사용자에게 안전하게 표시한다', async ({ page }) => {
  await installFakeStomp(page);
  await mockUser(page);
  await mockUserChat(page);

  await page.goto(`/support/${TICKET_ID}`);
  await page.getByLabel('상담방 열기').click();
  await expect(page.getByText('실시간 연결')).toBeVisible();
  await page.getByPlaceholder('메시지를 입력하세요').fill('거절될 메시지');
  await page.getByRole('button', { name: '전송' }).click();
  const payload = JSON.parse(frameBody(await latestFrame(page, 'SEND'))) as { clientMessageId: string };

  await pushStomp(page, '/user/queue/support-chat-errors', {
    clientMessageId: payload.clientMessageId,
    code: 'SUPPORT_CHAT_CONFLICT',
    message: '종료된 상담방에는 메시지를 보낼 수 없습니다.',
    retryable: false
  });

  await expect(page.getByRole('alert')).toHaveText('종료된 상담방에는 메시지를 보낼 수 없습니다.');
  await expect(page.getByText('SQLException')).toHaveCount(0);
});

test('관리자는 admin queue 증분 patch를 받고 선택한 방에 STOMP로 답변한다', async ({ page }) => {
  await installFakeStomp(page);
  await mockAdmin(page);
  await mockAdminChats(page);

  await page.goto('/admin/support-chat-sessions');
  await expect(page.getByRole('heading', { name: '상담방 관리' })).toBeVisible();
  await expect.poll(() => destinations(page, 'SUBSCRIBE')).toEqual(expect.arrayContaining([
    '/topic/support-chat/admin-queue',
    `/topic/support-chat/rooms/${ROOM_ID}`,
    '/user/queue/support-chat-errors'
  ]));

  await pushStomp(page, '/topic/support-chat/admin-queue', {
    type: 'ROOM_UPDATED',
    roomId: ROOM_ID,
    room: roomSummary({ lastMessage: '큐에서 갱신된 최신 문의', adminUnreadCount: 3 }),
    refreshRequired: false
  });
  await expect(page.getByRole('cell', { name: '큐에서 갱신된 최신 문의' })).toBeVisible();

  await page.getByPlaceholder('관리자 답변을 입력하세요').fill('로그를 확인하겠습니다.');
  await page.getByRole('button', { name: '답변 전송' }).click();
  const sendFrame = await latestFrame(page, 'SEND');
  const payload = JSON.parse(frameBody(sendFrame)) as { clientMessageId: string; content: string };
  expect(payload.content).toBe('로그를 확인하겠습니다.');

  await pushStomp(page, `/topic/support-chat/rooms/${ROOM_ID}`, messageEvent(payload.clientMessageId, payload.content, 'ADMIN'));
  await expect(page.getByTestId('admin-support-chat-messages').getByText('로그를 확인하겠습니다.')).toHaveCount(1);
});

test('STOMP 재연결 성공 직후 REST 상세를 다시 동기화한다', async ({ page }) => {
  let detailReads = 0;
  await installFakeStomp(page);
  await mockUser(page);
  await mockUserChat(page, () => { detailReads += 1; });

  await page.goto(`/support/${TICKET_ID}`);
  await page.getByLabel('상담방 열기').click();
  await expect(page.getByText('실시간 연결')).toBeVisible();
  const beforeReconnect = detailReads;

  await page.evaluate(() => {
    const sockets = (window as unknown as { __stompSockets: Array<{ serverClose: () => void }> }).__stompSockets;
    sockets[sockets.length - 1]?.serverClose();
  });
  await expect(page.getByText('재연결 중')).toBeVisible();
  await expect.poll(async () => page.evaluate(() => (
    window as unknown as { __stompSockets: unknown[] }
  ).__stompSockets.length), { timeout: 8000 }).toBeGreaterThan(1);
  await expect(page.getByText('실시간 연결')).toBeVisible({ timeout: 8000 });
  await expect.poll(() => detailReads).toBeGreaterThan(beforeReconnect);
});

async function installFakeStomp(page: Page) {
  await page.addInitScript(() => {
    type FakeSocketShape = EventTarget & {
      readyState: number;
      url: string;
      frames: string[];
      serverClose: () => void;
      serverMessage: (data: string) => void;
    };
    const sockets: FakeSocketShape[] = [];
    const allFrames: string[] = [];

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
      url: string;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor(url: string) {
        super();
        this.url = String(url);
        sockets.push(this as unknown as FakeSocketShape);
        setTimeout(() => {
          this.readyState = FakeWebSocket.OPEN;
          const event = new Event('open');
          this.onopen?.(event);
          this.dispatchEvent(event);
        }, 0);
      }

      send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
        const frame = String(data);
        this.frames.push(frame);
        allFrames.push(frame);
        if (frame.startsWith('CONNECT\n') || frame.startsWith('STOMP\n')) {
          setTimeout(() => this.serverMessage('CONNECTED\nversion:1.2\nheart-beat:0,0\n\n\0'), 0);
        }
      }

      close() {
        this.readyState = FakeWebSocket.CLOSED;
        const event = new CloseEvent('close', { code: 1000, reason: 'client close' });
        this.onclose?.(event);
        this.dispatchEvent(event);
      }

      serverClose() {
        this.readyState = FakeWebSocket.CLOSED;
        const event = new CloseEvent('close', { code: 1006, reason: 'network lost' });
        this.onclose?.(event);
        this.dispatchEvent(event);
      }

      serverMessage(data: string) {
        const event = new MessageEvent('message', { data });
        this.onmessage?.(event);
        this.dispatchEvent(event);
      }
    }

    const header = (frame: string, name: string) => frame
      .split('\n')
      .find((line) => line.startsWith(`${name}:`))
      ?.slice(name.length + 1);

    (window as unknown as { WebSocket: typeof WebSocket }).WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    (window as unknown as { __stompSockets: FakeSocketShape[] }).__stompSockets = sockets;
    (window as unknown as { __stompFrames: string[] }).__stompFrames = allFrames;
    (window as unknown as { __stompPush: (destination: string, body: unknown) => void }).__stompPush = (destination, body) => {
      for (const socket of sockets) {
        const subscription = [...socket.frames].reverse().find((frame) =>
          frame.startsWith('SUBSCRIBE\n') && header(frame, 'destination') === destination
        );
        if (!subscription || socket.readyState !== FakeWebSocket.OPEN) continue;
        const id = header(subscription, 'id');
        socket.serverMessage(`MESSAGE\nsubscription:${id}\ndestination:${destination}\nmessage-id:test-message\ncontent-type:application/json\n\n${JSON.stringify(body)}\0`);
      }
    };
  });
}

async function latestFrame(page: Page, command: string) {
  return expect.poll(async () => page.evaluate((prefix) => {
    const frames = (window as unknown as { __stompFrames: string[] }).__stompFrames;
    return [...frames].reverse().find((frame) => frame.startsWith(`${prefix}\n`)) ?? null;
  }, command)).not.toBeNull().then(async () => page.evaluate((prefix) => {
    const frames = (window as unknown as { __stompFrames: string[] }).__stompFrames;
    return [...frames].reverse().find((frame) => frame.startsWith(`${prefix}\n`)) as string;
  }, command));
}

async function destinations(page: Page, command: string) {
  return page.evaluate((prefix) => {
    const frames = (window as unknown as { __stompFrames: string[] }).__stompFrames;
    return frames
      .filter((frame) => frame.startsWith(`${prefix}\n`))
      .map((frame) => frame.split('\n').find((line) => line.startsWith('destination:'))?.slice('destination:'.length))
      .filter(Boolean);
  }, command);
}

async function pushStomp(page: Page, destination: string, body: unknown) {
  await page.evaluate(({ destination, body }) => {
    (window as unknown as { __stompPush: (target: string, payload: unknown) => void }).__stompPush(destination, body);
  }, { destination, body });
}

function frameBody(frame: string) {
  return frame.slice(frame.indexOf('\n\n') + 2).replace(/\0$/, '');
}

async function mockUser(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.token', 'jwt-user-token');
    localStorage.setItem('buildgraph.authUser', JSON.stringify({
      id: '00000000-0000-4000-8000-000000001004', email: 'user@example.com', name: 'Demo User', role: 'USER'
    }));
  });
  await page.route('**/api/auth/me**', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      id: '00000000-0000-4000-8000-000000001004', email: 'user@example.com', name: 'Demo User', role: 'USER'
    })
  }));
  await page.route('**/api/quote-drafts/current**', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ id: null, status: 'EMPTY', name: '빈 견적', items: [], totalPrice: 0, itemCount: 0 })
  }));
}

async function mockAdmin(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('buildgraph.token', 'jwt-admin-token');
    localStorage.setItem('buildgraph.authUser', JSON.stringify({
      id: '00000000-0000-4000-8000-000000000001', email: 'admin@example.com', name: 'Admin', role: 'ADMIN'
    }));
  });
  await page.route('**/api/auth/me**', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      id: '00000000-0000-4000-8000-000000000001', email: 'admin@example.com', name: 'Admin', role: 'ADMIN'
    })
  }));
}

async function mockUserChat(page: Page, onDetailRead?: () => void) {
  const detail = chatDetail();
  await page.route(`**/api/as-tickets/${TICKET_ID}`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ id: TICKET_ID, status: 'OPEN', symptom: 'GPU 온도 상승', supportChatRoomId: ROOM_ID, causeCandidates: [], upgradeCandidates: [] })
  }));
  await page.route('**/api/support/chat-sessions/current**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(detail)
  }));
  await page.route(`**/api/support/chat-sessions/${ROOM_ID}`, (route) => {
    onDetailRead?.();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail) });
  });
}

async function mockAdminChats(page: Page) {
  const contact = { ...roomSummary({ lastMessage: '게임 실행 후 온도가 95도까지 올라갑니다.', adminUnreadCount: 2 }), id: ROOM_ID, lastMessagePreview: '게임 실행 후 온도가 95도까지 올라갑니다.' };
  delete (contact as { roomId?: string }).roomId;
  const detail = { ...chatDetail(), contact };
  await page.route('**/api/admin/support/chat-sessions', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ items: [contact], pollingIntervalMs: 5000 })
  }));
  await page.route(`**/api/admin/support/chat-sessions/${ROOM_ID}**`, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(detail)
  }));
}

function chatDetail() {
  return {
    contact: {
      id: ROOM_ID,
      asTicketId: TICKET_ID,
      status: 'ACTIVE',
      ticketStatus: 'OPEN',
      title: 'AS 상담방',
      symptom: 'GPU 온도 상승',
      userUnreadCount: 0,
      adminUnreadCount: 0,
      canSendMessage: true
    },
    messages: [{
      id: '00000000-0000-4000-8000-000000009101',
      role: 'SYSTEM',
      content: '상담방이 생성되었습니다. 문의 내용을 남기면 담당자가 확인합니다.',
      createdAt: '2026-08-02T09:00:00+09:00'
    }],
    pollingIntervalMs: 5000
  };
}

function roomSummary(overrides: Record<string, unknown> = {}) {
  return {
    roomId: ROOM_ID,
    asTicketId: TICKET_ID,
    status: 'ACTIVE',
    ticketStatus: 'OPEN',
    title: 'AS 상담방',
    symptom: 'GPU 온도 상승',
    lastMessage: '상담방이 생성되었습니다.',
    lastMessageAt: '2026-08-02T09:00:00+09:00',
    userUnreadCount: 0,
    adminUnreadCount: 0,
    assignedAdminId: null,
    canSendMessage: true,
    user: { id: 'user-id', email: 'user@example.com', name: 'Demo User' },
    ...overrides
  };
}

function messageEvent(clientMessageId: string, content: string, senderRole: 'USER' | 'ADMIN') {
  return {
    type: 'MESSAGE_CREATED',
    messageId: `00000000-0000-4000-8000-${senderRole === 'USER' ? '000000009201' : '000000009301'}`,
    clientMessageId,
    roomId: ROOM_ID,
    senderId: senderRole === 'USER' ? 'user-id' : 'admin-id',
    senderRole,
    senderName: senderRole === 'USER' ? 'Demo User' : 'Admin',
    content,
    createdAt: '2026-08-02T10:00:00+09:00',
    room: roomSummary({ lastMessage: content, lastMessageAt: '2026-08-02T10:00:00+09:00' })
  };
}

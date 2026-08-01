import { Client, type IMessage, type StompSubscription } from '@stomp/stompjs';
import { API_BASE_URL, api, getToken } from '../../lib/api';
import type { SupportChatContact, SupportChatSessionDto, SupportChatSessionListDto } from './types';

const SUPPORT_CHAT_ENDPOINT = '/ws/support-chat';
const SEND_DESTINATION = '/app/support-chat/messages';
const ROOM_TOPIC_PREFIX = '/topic/support-chat/rooms/';
const ADMIN_QUEUE_TOPIC = '/topic/support-chat/admin-queue';
const ERROR_QUEUE = '/user/queue/support-chat-errors';

export function getCurrentSupportChat(asTicketId?: string | null, summary = false) {
  const params = new URLSearchParams();
  if (asTicketId) params.set('asTicketId', asTicketId);
  if (summary) params.set('summary', 'true');
  const query = params.toString();
  return api<SupportChatSessionDto>(`/api/support/chat-sessions/current${query ? `?${query}` : ''}`);
}

export function getSupportChatSession(sessionId: string) {
  return api<SupportChatSessionDto>(`/api/support/chat-sessions/${sessionId}`);
}

export function putSupportChatVisitReservation(sessionId: string, payload: { scheduledAt: string; addressSnapshot?: string }) {
  return api<SupportChatSessionDto>(`/api/support/chat-sessions/${sessionId}/visit-reservation`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function getAdminSupportChatSession(sessionId: string, markRead = true) {
  const query = markRead ? '' : '?markRead=false';
  return api<SupportChatSessionDto>(`/api/admin/support/chat-sessions/${sessionId}${query}`);
}

export function getAdminSupportChatSessions() {
  return api<SupportChatSessionListDto>('/api/admin/support/chat-sessions');
}

export function deleteAdminSupportChatSession(sessionId: string) {
  return api<SupportChatSessionDto>(`/api/admin/support/chat-sessions/${sessionId}`, {
    method: 'DELETE'
  });
}

export function putAdminSupportChatVisitReservation(sessionId: string, payload: { scheduledAt: string; technicianNote?: string }) {
  return api<SupportChatSessionDto>(`/api/admin/support/chat-sessions/${sessionId}/visit-reservation`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function deleteAdminSupportChatVisitReservation(sessionId: string) {
  return api<SupportChatSessionDto>(`/api/admin/support/chat-sessions/${sessionId}/visit-reservation`, {
    method: 'DELETE'
  });
}

export type SupportChatMessageEvent = {
  type: 'MESSAGE_CREATED';
  messageId: string;
  clientMessageId: string;
  roomId: string;
  senderId: string;
  senderRole: 'USER' | 'ADMIN' | 'SYSTEM';
  senderName?: string | null;
  content: string;
  createdAt?: string;
  room: SupportChatRoomSummary;
};

export type SupportChatRoomSummary = {
  roomId: string;
  asTicketId: string;
  status: string;
  ticketStatus?: string;
  title: string;
  symptom?: string;
  lastMessage?: string | null;
  lastMessageAt?: string | null;
  userUnreadCount?: number;
  adminUnreadCount?: number;
  assignedAdminId?: string | null;
  canSendMessage?: boolean;
  user?: SupportChatContact['user'];
};

export type SupportChatRoomEvent = {
  type: 'ROOM_UPDATED' | 'ROOM_REMOVED';
  roomId: string;
  room?: SupportChatRoomSummary | null;
  refreshRequired?: boolean;
};

export type SupportChatSocketError = {
  clientMessageId?: string | null;
  code?: string;
  message?: string;
  retryable?: boolean;
};

export type SupportChatSocket = {
  close: () => void;
  sendMessage: (content: string, clientMessageId?: string) => string;
  isConnected: () => boolean;
};

export function roomSummaryToContact(room: SupportChatRoomSummary): SupportChatContact {
  return {
    id: room.roomId,
    asTicketId: room.asTicketId,
    status: room.status,
    ticketStatus: room.ticketStatus,
    title: room.title,
    symptom: room.symptom,
    lastMessagePreview: room.lastMessage,
    lastMessageAt: room.lastMessageAt,
    userUnreadCount: room.userUnreadCount,
    adminUnreadCount: room.adminUnreadCount,
    assignedAdminId: room.assignedAdminId,
    canSendMessage: room.canSendMessage,
    user: room.user
  };
}

export async function openSupportChatSocket(options: {
  mode: 'user' | 'admin';
  sessionId: string;
  onMessage: (event: SupportChatMessageEvent) => void;
  onRoom?: (event: SupportChatRoomEvent) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: () => void;
  onSocketError?: (error: SupportChatSocketError) => void;
}): Promise<SupportChatSocket | null> {
  return createSupportChatClient({ ...options, subscribeAdminQueue: false });
}

export async function openAdminSupportChatQueueSocket(options: {
  onUpdated: (contact: SupportChatContact) => void;
  onRemoved: (id: string) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: () => void;
  onSocketError?: (error: SupportChatSocketError) => void;
}): Promise<SupportChatSocket | null> {
  return createSupportChatClient({
    mode: 'admin',
    sessionId: null,
    subscribeAdminQueue: true,
    onMessage: () => undefined,
    onOpen: options.onOpen,
    onClose: options.onClose,
    onError: options.onError,
    onSocketError: options.onSocketError,
    onRoom: (event) => {
      if (event.type === 'ROOM_REMOVED') {
        options.onRemoved(event.roomId);
      } else if (event.room) {
        options.onUpdated(roomSummaryToContact(event.room));
      }
    }
  });
}

function createSupportChatClient(options: {
  mode: 'user' | 'admin';
  sessionId: string | null;
  subscribeAdminQueue: boolean;
  onMessage: (event: SupportChatMessageEvent) => void;
  onRoom?: (event: SupportChatRoomEvent) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: () => void;
  onSocketError?: (error: SupportChatSocketError) => void;
}): SupportChatSocket | null {
  const token = getToken();
  if (!token || typeof WebSocket === 'undefined') return null;

  let subscriptions: StompSubscription[] = [];
  const client = new Client({
    brokerURL: supportChatSocketUrl(),
    connectHeaders: { Authorization: `Bearer ${token}` },
    reconnectDelay: 5_000,
    heartbeatIncoming: 10_000,
    heartbeatOutgoing: 10_000,
    beforeConnect: async () => {
      const latestToken = getToken();
      if (!latestToken) throw new Error('Login is required.');
      client.connectHeaders = { Authorization: `Bearer ${latestToken}` };
    },
    onConnect: () => {
      subscriptions = [];
      if (options.sessionId) {
        subscriptions.push(client.subscribe(`${ROOM_TOPIC_PREFIX}${options.sessionId}`, (frame) => {
          const payload = parseFrame<SupportChatMessageEvent | SupportChatRoomEvent>(frame);
          if (!payload) return;
          if (payload.type === 'MESSAGE_CREATED') options.onMessage(payload);
          else options.onRoom?.(payload);
        }));
      }
      if (options.subscribeAdminQueue) {
        subscriptions.push(client.subscribe(ADMIN_QUEUE_TOPIC, (frame) => {
          const payload = parseFrame<SupportChatRoomEvent>(frame);
          if (payload) options.onRoom?.(payload);
        }));
      }
      subscriptions.push(client.subscribe(ERROR_QUEUE, (frame) => {
        const payload = parseFrame<SupportChatSocketError>(frame);
        if (payload) options.onSocketError?.(payload);
      }));
      options.onOpen?.();
    },
    onWebSocketClose: () => options.onClose?.(),
    onWebSocketError: () => options.onError?.(),
    onStompError: (frame) => options.onSocketError?.({
      code: 'SUPPORT_CHAT_BROKER_ERROR',
      message: frame.headers.message ?? '상담 연결을 처리하지 못했습니다.',
      retryable: true
    })
  });
  client.activate();

  return {
    close() {
      subscriptions.forEach((subscription) => subscription.unsubscribe());
      subscriptions = [];
      void client.deactivate();
    },
    sendMessage(content, clientMessageId = crypto.randomUUID()) {
      if (!client.connected || !options.sessionId) {
        throw new Error('상담 연결이 끊겨 있어 메시지를 보낼 수 없습니다.');
      }
      client.publish({
        destination: SEND_DESTINATION,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roomId: options.sessionId, clientMessageId, content })
      });
      return clientMessageId;
    },
    isConnected() {
      return client.connected;
    }
  };
}

function supportChatSocketUrl() {
  const base = API_BASE_URL || window.location.origin;
  const url = new URL(SUPPORT_CHAT_ENDPOINT, base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

function parseFrame<T>(frame: IMessage): T | null {
  try {
    return JSON.parse(frame.body) as T;
  } catch {
    return null;
  }
}

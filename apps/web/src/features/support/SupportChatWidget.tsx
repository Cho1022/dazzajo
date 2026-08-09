import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { LifeBuoy, MessageCircle, Send, X } from 'lucide-react';
import { AUTH_CHANGED_EVENT, getCachedAuthUser, getToken } from '../../lib/api';
import { AI_BUILD_ASSISTANT_CLOSE_EVENT, AI_BUILD_ASSISTANT_OPEN_EVENT, AI_BUILD_ASSISTANT_TOGGLE_EVENT, SUPPORT_CHAT_CLOSE_EVENT, SUPPORT_CHAT_OPEN_EVENT } from '../../lib/events';
import { getCurrentUser } from '../auth/authApi';
import { getCurrentSupportChat, getSupportChatSession, openSupportChatSocket, putSupportChatVisitReservation, roomSummaryToContact, type SupportChatMessageEvent, type SupportChatSocket } from './supportChatApi';
import { SupportChatMessageContent } from './SupportChatMessageContent';
import type { SupportChatMessage, SupportChatSessionDto, VisitSupportReservation } from './types';

const DEFAULT_POLL_MS = 5000;
// 닫힌 위젯의 배지 갱신용 기본 폴링 — 서버 지시(pollingIntervalMs)가 없을 때만 적용된다.
const CLOSED_WIDGET_DEFAULT_POLL_MS = 30_000;
const SUPPORT_CHAT_MOBILE_QUERY = '(max-width: 767px)';
type SocketStatus = 'polling' | 'connecting' | 'reconnecting' | 'connected' | 'disconnected';

export function SupportChatWidget() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const socketRef = useRef<SupportChatSocket | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const wasAtBottomRef = useRef(true);
  const forceScrollToBottomRef = useRef(false);
  const previousLastMessageIdRef = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [visitScheduledAt, setVisitScheduledAt] = useState('');
  const [visitAddress, setVisitAddress] = useState('');
  const [visitError, setVisitError] = useState<string | null>(null);
  const [socketStatus, setSocketStatus] = useState<SocketStatus>('polling');
  const [authToken, setAuthToken] = useState(() => getToken());
  const [newMarkerMessageId, setNewMarkerMessageId] = useState<string | null>(null);
  const hidden = shouldHideSupportChat(location.pathname);
  const hasToken = Boolean(authToken);
  const cachedUser = getCachedAuthUser();
  const cachedRole = cachedUserRole(cachedUser);
  const roleQuery = useQuery({
    queryKey: ['support-chat', authScopeKey(cachedUser), 'current-user-role'],
    queryFn: getCurrentUser,
    enabled: hasToken && !hidden && cachedRole == null,
    staleTime: 30_000,
    retry: false
  });
  const currentRole = cachedRole ?? roleQuery.data?.role ?? null;
  const authScope = authScopeKey(roleQuery.data ?? cachedUser);
  const canUseUserChat = currentRole === 'USER';
  const routeTicketId = supportTicketIdFromPath(location.pathname);
  const shouldAutoOpen = new URLSearchParams(location.search).get('chat') === '1';

  const currentQuery = useQuery({
    queryKey: ['support-chat', authScope, 'current', routeTicketId ?? 'latest'],
    // 배지/세션 판별용 경량 요약(summary=true) — 전체 대화(messages 100건)를 매 폴링마다
    // 끌어오던 상시 부하를 없앤다. 열면 detailQuery가 전체 상세를 담당한다.
    queryFn: () => getCurrentSupportChat(routeTicketId, true),
    enabled: hasToken && !hidden && canUseUserChat,
    // 닫힌 위젯: 서버가 지시한 주기는 그대로 따르고, 지시가 없을 때만 느슨한 기본값(30초)을 쓴다
    // — 다탭 환경에서 배지 갱신용 기본 폴링이 요청 폭주를 만들지 않게 한다.
    refetchInterval: (query) => {
      if (open) return false;
      const serverInterval = (query.state.data as SupportChatSessionDto | undefined)?.pollingIntervalMs;
      return typeof serverInterval === 'number' && Number.isFinite(serverInterval) && serverInterval > 0
        ? serverInterval
        : CLOSED_WIDGET_DEFAULT_POLL_MS;
    },
    retry: false
  });

  const sessionId = currentQuery.data?.contact?.id ?? null;
  const detailQuery = useQuery({
    queryKey: ['support-chat', authScope, sessionId],
    queryFn: () => getSupportChatSession(sessionId as string),
    enabled: Boolean(open && sessionId),
    refetchInterval: (query) => open && sessionId && socketStatus !== 'connected'
      ? pollingInterval(query.state.data as SupportChatSessionDto | undefined)
      : false,
    retry: false
  });

  const updateChatCache = useCallback((detail: SupportChatSessionDto) => {
    wasAtBottomRef.current = isNearBottom(messagesRef.current);
    queryClient.setQueryData<SupportChatSessionDto | undefined>(
      ['support-chat', authScope, 'current', routeTicketId ?? 'latest'],
      (existing) => shouldApplyDetail(detail, existing) ? detail : existing
    );
    if (detail.contact?.id) {
      queryClient.setQueryData<SupportChatSessionDto | undefined>(
        ['support-chat', authScope, detail.contact.id],
        (existing) => shouldApplyDetail(detail, existing) ? detail : existing
      );
    }
  }, [authScope, queryClient, routeTicketId]);

  const applyMessageEvent = useCallback((event: SupportChatMessageEvent) => {
    wasAtBottomRef.current = isNearBottom(messagesRef.current);
    const patch = (existing?: SupportChatSessionDto) => patchMessageEvent(existing, event);
    queryClient.setQueryData<SupportChatSessionDto | undefined>(
      ['support-chat', authScope, 'current', routeTicketId ?? 'latest'],
      patch
    );
    queryClient.setQueryData<SupportChatSessionDto | undefined>(
      ['support-chat', authScope, event.roomId],
      patch
    );
  }, [authScope, queryClient, routeTicketId]);

  const visitReservationMutation = useMutation({
    mutationFn: () => putSupportChatVisitReservation(sessionId as string, {
      scheduledAt: toSeoulOffsetDateTime(visitScheduledAt),
      addressSnapshot: visitAddress.trim()
    }),
    onSuccess: (detail) => {
      setVisitError(null);
      updateChatCache(detail);
    },
    onError: (error) => {
      setVisitError(errorMessage(error));
    }
  });

  const activeChat = detailQuery.data ?? currentQuery.data;
  const contact = activeChat?.contact ?? null;
  const messages = activeChat?.messages ?? [];
  const messageCount = messages.length;
  const canSend = Boolean(contact?.canSendMessage && message.trim() && socketStatus === 'connected');
  const canRequestVisit = Boolean(contact?.canSendMessage && visitScheduledAt && !visitReservationMutation.isPending);

  useEffect(() => {
    const reservation = contact?.visitReservation;
    setVisitScheduledAt(toDatetimeLocalValue(reservation?.scheduledAt));
    setVisitAddress(reservation?.addressSnapshot ?? '');
    setVisitError(null);
  }, [contact?.id, contact?.visitReservation?.id, contact?.visitReservation?.scheduledAt, contact?.visitReservation?.addressSnapshot]);

  const openChat = useCallback((announce = true) => {
    setOpen(true);
    if (isSupportChatMobile()) {
      window.dispatchEvent(new Event(AI_BUILD_ASSISTANT_CLOSE_EVENT));
    }
    if (announce) {
      window.dispatchEvent(new Event(SUPPORT_CHAT_OPEN_EVENT));
    }
  }, []);

  const closeChat = useCallback(() => {
    setOpen(false);
    setNewMarkerMessageId(null);
  }, []);

  useEffect(() => {
    const handleAuthChanged = () => {
      setAuthToken(getToken());
      closeChat();
      setMessage('');
      setSendError(null);
      socketRef.current?.close();
      socketRef.current = null;
      setSocketStatus('polling');
      queryClient.removeQueries({ queryKey: ['support-chat'] });
    };
    window.addEventListener(AUTH_CHANGED_EVENT, handleAuthChanged);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, handleAuthChanged);
  }, [closeChat, queryClient]);

  useEffect(() => {
    const handleSupportOpen = () => openChat(false);
    const handleSupportClose = () => closeChat();
    const handleAiOpen = () => {
      if (isSupportChatMobile()) {
        closeChat();
      }
    };
    window.addEventListener(SUPPORT_CHAT_OPEN_EVENT, handleSupportOpen);
    window.addEventListener(SUPPORT_CHAT_CLOSE_EVENT, handleSupportClose);
    window.addEventListener(AI_BUILD_ASSISTANT_OPEN_EVENT, handleAiOpen);
    window.addEventListener(AI_BUILD_ASSISTANT_TOGGLE_EVENT, handleAiOpen);
    return () => {
      window.removeEventListener(SUPPORT_CHAT_OPEN_EVENT, handleSupportOpen);
      window.removeEventListener(SUPPORT_CHAT_CLOSE_EVENT, handleSupportClose);
      window.removeEventListener(AI_BUILD_ASSISTANT_OPEN_EVENT, handleAiOpen);
      window.removeEventListener(AI_BUILD_ASSISTANT_TOGGLE_EVENT, handleAiOpen);
    };
  }, [closeChat, openChat]);

  useEffect(() => {
    if (shouldAutoOpen && hasToken && canUseUserChat && !hidden) {
      openChat();
    }
  }, [canUseUserChat, hasToken, hidden, openChat, shouldAutoOpen]);

  useEffect(() => {
    socketRef.current?.close();
    socketRef.current = null;
    setSocketStatus('polling');
    if (!open || !sessionId) {
      return undefined;
    }
    let disposed = false;
    const connect = async () => {
      if (disposed) return;
      setSocketStatus('connecting');
      try {
        const socket = await openSupportChatSocket({
          mode: 'user',
          sessionId,
          onOpen: () => {
            if (disposed) return;
            setSocketStatus('connected');
            void queryClient.invalidateQueries({ queryKey: ['support-chat', authScope, sessionId] });
            void queryClient.invalidateQueries({ queryKey: ['support-chat', authScope, 'current'] });
          },
          onClose: () => {
            if (disposed) return;
            setSocketStatus('reconnecting');
          },
          onError: () => {
            if (disposed) return;
            setSocketStatus('reconnecting');
          },
          onSocketError: (error) => {
            if (error.message) {
              setSendError(error.message);
            }
            if (error.clientMessageId) {
              markMessageFailed(queryClient, authScope, error.clientMessageId);
            }
          },
          onMessage: applyMessageEvent,
          onRoom: (event) => {
            if (event.refreshRequired) {
              void queryClient.invalidateQueries({ queryKey: ['support-chat', authScope, sessionId] });
            }
          }
        });
        if (disposed) {
          socket?.close();
          return;
        }
        socketRef.current = socket;
        if (!socket) {
          setSocketStatus('polling');
        }
      } catch (error) {
        if (disposed) return;
        setSocketStatus('disconnected');
      }
    };

    connect();
    return () => {
      disposed = true;
      socketRef.current?.close();
      socketRef.current = null;
      setSocketStatus('polling');
    };
  }, [applyMessageEvent, authScope, open, queryClient, sessionId]);

  useEffect(() => {
    if (!open || !messagesRef.current) return;
    const lastMessageId = messages.length > 0 ? messages[messages.length - 1].id : null;
    const previousLastMessageId = previousLastMessageIdRef.current;
    const hasNewMessage = Boolean(previousLastMessageId && lastMessageId && previousLastMessageId !== lastMessageId);
    const shouldScroll = forceScrollToBottomRef.current || !hasNewMessage || wasAtBottomRef.current;
    const markerMessageId = hasNewMessage && !shouldScroll
      ? firstMessageAfter(messages, previousLastMessageId) ?? lastMessageId
      : null;
    previousLastMessageIdRef.current = lastMessageId;
    forceScrollToBottomRef.current = false;

    const frame = window.requestAnimationFrame(() => {
      if (shouldScroll) {
        scrollMessagesToBottom(messagesRef.current);
        setNewMarkerMessageId(null);
        wasAtBottomRef.current = true;
      } else {
        setNewMarkerMessageId(markerMessageId);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, open, sessionId]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSend || !sessionId) return;
    const outgoing = message.trim();
    setSendError(null);
    try {
      const clientMessageId = crypto.randomUUID();
      appendOptimisticMessage(queryClient, authScope, sessionId, routeTicketId, clientMessageId, outgoing, 'USER');
      socketRef.current?.sendMessage(outgoing, clientMessageId);
      forceScrollToBottomRef.current = true;
      setMessage('');
    } catch (error) {
      setSendError(errorMessage(error));
    }
  }

  function submitVisitReservation(event: FormEvent) {
    event.preventDefault();
    if (!canRequestVisit || !sessionId) return;
    setVisitError(null);
    visitReservationMutation.mutate();
  }

  if (hidden || !hasToken || !canUseUserChat) {
    return null;
  }

  if (!open) {
    return (
      <button
        type="button"
        aria-label="상담방 열기"
        onClick={() => openChat()}
        className="fixed bottom-5 left-5 z-50 grid h-14 w-14 place-items-center rounded-2xl bg-[#ce7237] text-white shadow-2xl transition hover:-translate-y-0.5 hover:bg-[#b85f2c] focus:outline-none focus:ring-4 focus:ring-[#ce7237]/20"
      >
        <MessageCircle size={24} />
      </button>
    );
  }

  return (
    <section className="fixed bottom-4 left-4 z-50 flex h-[min(calc(100vh-2rem),clamp(460px,78vh,930px))] w-[min(calc(100vw-2rem),clamp(390px,52vw,585px))] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-200 bg-[#ce7237] px-4 py-3 text-white">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-white text-[#ce7237]">
            <LifeBuoy size={20} />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-black">PC Agent 상담방</h2>
            <p className="truncate text-xs text-slate-300">{contact?.title ?? 'AS 티켓 기반 상담'}</p>
          </div>
        </div>
        <button
          type="button"
          aria-label="상담방 닫기"
          onClick={closeChat}
          className="grid h-9 w-9 place-items-center rounded-md border border-white/15 text-white transition hover:bg-white/10 focus:outline-none focus:ring-4 focus:ring-white/20"
        >
          <X size={17} />
        </button>
      </div>

      {contact ? (
        <>
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
            <div className="truncate font-bold text-slate-900">{contact.symptom ?? 'AS 상담'}</div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span>티켓 {shortId(contact.asTicketId)}</span>
              <span>{socketStatusLabel(socketStatus)}</span>
            </div>
          </div>
          <VisitReservationPanel
            reservation={contact.visitReservation ?? null}
            scheduledAt={visitScheduledAt}
            address={visitAddress}
            error={visitError}
            disabled={!contact.canSendMessage}
            pending={visitReservationMutation.isPending}
            canSubmit={canRequestVisit}
            onScheduledAtChange={(value) => {
              setVisitScheduledAt(value);
              setVisitError(null);
            }}
            onAddressChange={(value) => {
              setVisitAddress(value);
              setVisitError(null);
            }}
            onSubmit={submitVisitReservation}
          />
          <div className="relative flex-1 overflow-hidden bg-slate-50">
            <div
              ref={messagesRef}
              data-testid="support-chat-messages"
              className="h-full overflow-y-auto p-4"
              onScroll={(event) => {
                const nearBottom = isNearBottom(event.currentTarget);
                wasAtBottomRef.current = nearBottom;
                if (nearBottom) {
                  setNewMarkerMessageId(null);
                }
              }}
            >
              <div className="space-y-3">
                {messages.map((item) => (
                  <div key={item.id}>
                    {newMarkerMessageId === item.id ? <NewMessageMarker /> : null}
                    <SupportChatBubble message={item} />
                  </div>
                ))}
              </div>
            </div>
            {newMarkerMessageId ? (
              <button
                type="button"
                aria-label="새 메시지로 이동"
                onClick={() => {
                  scrollMessagesToBottom(messagesRef.current);
                  wasAtBottomRef.current = true;
                  setNewMarkerMessageId(null);
                }}
                className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-[#ce7237] px-4 py-2 text-xs font-bold text-white shadow-lg"
              >
                새 메시지로 이동
              </button>
            ) : null}
          </div>
          <form onSubmit={submit} className="border-t border-slate-200 bg-white p-3">
            {contact.canSendMessage ? (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    className="h-11 min-w-0 flex-1 rounded-md border border-slate-300 px-3 text-sm focus:border-[#ce7237] focus:outline-none focus:ring-4 focus:ring-[#ce7237]/20"
                    placeholder="메시지를 입력하세요"
                    value={message}
                    maxLength={2000}
                    onChange={(event) => {
                      setMessage(event.target.value);
                      setSendError(null);
                    }}
                  />
                  <button
                    disabled={!canSend}
                    className="grid h-11 w-11 place-items-center rounded-md bg-[#ce7237] text-white transition hover:bg-[#b85f2c] disabled:cursor-not-allowed disabled:bg-slate-400"
                    aria-label="전송"
                  >
                    <Send size={18} />
                  </button>
                </div>
                {sendError ? <p role="alert" className="text-xs font-bold text-rose-700">{sendError}</p> : null}
              </div>
            ) : (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                종료된 AS 티켓 상담방입니다.
              </div>
            )}
          </form>
        </>
      ) : currentQuery.isError || detailQuery.isError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-slate-50 p-6 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-lg bg-white text-rose-700 shadow-sm">
            <LifeBuoy size={24} />
          </div>
          <div>
            <h3 className="text-base font-black text-slate-950">상담방 조회 실패</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">잠시 후 다시 시도해 주세요.</p>
          </div>
        </div>
      ) : currentQuery.isLoading ? (
        <div className="flex flex-1 items-center justify-center bg-slate-50 p-6 text-sm font-bold text-slate-600">
          상담방을 불러오는 중입니다.
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-slate-50 p-6 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-lg bg-white text-[#ce7237] shadow-sm">
            <LifeBuoy size={24} />
          </div>
          <div>
            <h3 className="text-base font-black text-slate-950">AS 티켓이 필요합니다.</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              상담방은 AS 접수 후 자동으로 생성됩니다. PC Agent 로그와 증상을 접수하면 담당자와 대화할 수 있습니다.
            </p>
          </div>
          <Link to={activeChat?.supportNewPath ?? '/support/new'} className="rounded-md bg-[#ce7237] px-4 py-3 text-sm font-bold text-white hover:bg-[#b85f2c]">
            AS 접수로 이동
          </Link>
        </div>
      )}
    </section>
  );
}

function VisitReservationPanel({
  reservation,
  scheduledAt,
  address,
  error,
  disabled,
  pending,
  canSubmit,
  onScheduledAtChange,
  onAddressChange,
  onSubmit
}: {
  reservation: VisitSupportReservation | null;
  scheduledAt: string;
  address: string;
  error: string | null;
  disabled: boolean;
  pending: boolean;
  canSubmit: boolean;
  onScheduledAtChange: (value: string) => void;
  onAddressChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const actionLabel = reservation ? '변경 요청' : '예약 요청';
  return (
    <form onSubmit={onSubmit} className="border-b border-slate-200 bg-white px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <div className="text-xs font-black text-slate-900">방문 예약</div>
          <div className="mt-1 text-[11px] font-bold text-[#ce7237]">{visitStatusLabel(reservation?.status)}</div>
        </div>
        {reservation?.scheduledAt ? (
          <div className="text-right text-xs font-bold text-slate-700">{formatVisitTime(reservation.scheduledAt)}</div>
        ) : null}
      </div>
      <div className="grid gap-2">
        <label className="grid gap-1 text-[11px] font-bold text-slate-600">
          방문 예약 시각
          <input
            type="datetime-local"
            value={scheduledAt}
            disabled={disabled}
            onChange={(event) => onScheduledAtChange(event.target.value)}
            className="h-10 rounded-md border border-slate-300 px-3 text-sm font-normal text-slate-900 disabled:bg-slate-100"
          />
        </label>
        <label className="grid gap-1 text-[11px] font-bold text-slate-600">
          방문 주소
          <input
            value={address}
            disabled={disabled}
            onChange={(event) => onAddressChange(event.target.value)}
            className="h-10 rounded-md border border-slate-300 px-3 text-sm font-normal text-slate-900 disabled:bg-slate-100"
          />
        </label>
        <button
          type="submit"
          disabled={disabled || !canSubmit}
          className="h-10 rounded-md bg-[#ce7237] px-3 text-xs font-black text-white disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {pending ? '요청 중' : actionLabel}
        </button>
        {error ? <p role="alert" className="text-xs font-bold text-rose-700">{error}</p> : null}
      </div>
    </form>
  );
}

function SupportChatBubble({ message }: { message: SupportChatMessage }) {
  const isUser = message.role === 'USER';
  const isSystem = message.role === 'SYSTEM';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[78%] rounded-md px-3 py-2 text-sm leading-6 shadow-sm ${
        isUser
          ? 'bg-[#ce7237] text-white'
          : isSystem
            ? 'border border-slate-200 bg-white text-slate-600'
            : 'border border-slate-200 bg-white text-slate-900'
      }`}>
        <div className="mb-1 text-[11px] font-bold opacity-75">
          {isSystem ? '시스템' : isUser ? '나' : message.senderName ?? '상담원'}
        </div>
        <SupportChatMessageContent className="whitespace-pre-wrap break-words" content={message.content} />
      </div>
    </div>
  );
}

function NewMessageMarker() {
  return (
    <div className="my-3 flex items-center gap-3" aria-label="새 메시지">
      <div className="h-px flex-1 bg-[#ce7237]/30" />
      <span className="rounded-full bg-[#ce7237]/10 px-3 py-1 text-[11px] font-black text-[#ce7237]">새 메시지</span>
      <div className="h-px flex-1 bg-[#ce7237]/30" />
    </div>
  );
}

function shouldHideSupportChat(pathname: string) {
  return pathname === '/login'
    || pathname === '/signup'
    || pathname.startsWith('/admin')
    || pathname === '/support/new';
}

function cachedUserRole(user: unknown) {
  if (!user || typeof user !== 'object') {
    return null;
  }
  const role = (user as { role?: unknown }).role;
  return role === 'USER' || role === 'ADMIN' ? role : null;
}

function authScopeKey(user: unknown) {
  if (!user || typeof user !== 'object') {
    return 'anonymous';
  }
  const record = user as { id?: unknown; role?: unknown };
  const id = typeof record.id === 'string' && record.id ? record.id : 'unknown';
  const role = typeof record.role === 'string' && record.role ? record.role : 'unknown';
  return `${role}:${id}`;
}

function supportTicketIdFromPath(pathname: string) {
  const match = pathname.match(/^\/support\/([^/]+)$/);
  if (!match || match[1] === 'new' || match[1] === 'ai-chat') {
    return null;
  }
  return match[1];
}

function shortId(id: string) {
  return id.length <= 12 ? id : `${id.slice(0, 8)}...${id.slice(-4)}`;
}

function socketStatusLabel(status: SocketStatus) {
  switch (status) {
    case 'connected':
      return '실시간 연결';
    case 'connecting':
    case 'reconnecting':
      return '재연결 중';
    case 'disconnected':
      return '연결 끊김';
    case 'polling':
    default:
      return '자동 새로고침';
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : '메시지를 전송하지 못했습니다.';
}

function visitStatusLabel(status?: string | null) {
  switch (status) {
    case 'REQUESTED':
    case 'RESCHEDULE_REQUESTED':
      return '관리자 확인 대기';
    case 'SCHEDULED':
      return '예약 확정';
    case 'CANCELLED':
      return '예약 취소됨';
    case 'VISIT_IN_PROGRESS':
      return '방문 진행 중';
    case 'COMPLETED':
      return '방문 완료';
    default:
      return '예약 없음';
  }
}

function toSeoulOffsetDateTime(value: string) {
  const normalized = value.length === 16 ? `${value}:00` : value;
  return `${normalized}+09:00`;
}

function toDatetimeLocalValue(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 16);
  }
  return seoulDateTimeText(date).replace(' ', 'T');
}

function formatVisitTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.replace('T', ' ').slice(0, 16);
  }
  return seoulDateTimeText(date);
}

function seoulDateTimeText(date: Date) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

function pollingInterval(detail?: SupportChatSessionDto) {
  const value = detail?.pollingIntervalMs;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : DEFAULT_POLL_MS;
}

function patchMessageEvent(existing: SupportChatSessionDto | undefined, event: SupportChatMessageEvent) {
  if (!existing) return existing;
  const canonical: SupportChatMessage = {
    id: event.messageId,
    clientMessageId: event.clientMessageId,
    role: event.senderRole,
    content: event.content,
    senderId: event.senderId,
    senderName: event.senderName,
    createdAt: event.createdAt,
    pending: false,
    failed: false
  };
  const duplicateIndex = existing.messages.findIndex((item) =>
    item.id === event.messageId || Boolean(event.clientMessageId && item.clientMessageId === event.clientMessageId)
  );
  const messages = duplicateIndex >= 0
    ? existing.messages.map((item, index) => index === duplicateIndex ? canonical : item)
    : [...existing.messages, canonical];
  const summary = roomSummaryToContact(event.room);
  return {
    ...existing,
    contact: existing.contact
      ? { ...existing.contact, ...summary, visitReservation: existing.contact.visitReservation }
      : summary,
    messages
  };
}

function appendOptimisticMessage(
  queryClient: ReturnType<typeof useQueryClient>,
  authScope: string,
  sessionId: string,
  routeTicketId: string | null,
  clientMessageId: string,
  content: string,
  role: 'USER' | 'ADMIN'
) {
  const optimistic: SupportChatMessage = {
    id: `optimistic:${clientMessageId}`,
    clientMessageId,
    role,
    content,
    createdAt: new Date().toISOString(),
    pending: true
  };
  const append = (existing?: SupportChatSessionDto) => existing
    ? { ...existing, messages: [...existing.messages, optimistic] }
    : existing;
  queryClient.setQueryData<SupportChatSessionDto | undefined>(['support-chat', authScope, sessionId], append);
  queryClient.setQueryData<SupportChatSessionDto | undefined>(
    ['support-chat', authScope, 'current', routeTicketId ?? 'latest'],
    append
  );
}

function markMessageFailed(
  queryClient: ReturnType<typeof useQueryClient>,
  authScope: string,
  clientMessageId: string
) {
  queryClient.setQueriesData<SupportChatSessionDto | undefined>(
    { queryKey: ['support-chat', authScope] },
    (existing) => existing
      ? {
          ...existing,
          messages: existing.messages.map((item) => item.clientMessageId === clientMessageId
            ? { ...item, pending: false, failed: true }
            : item)
        }
      : existing
  );
}

function shouldApplyDetail(incoming: SupportChatSessionDto, existing?: SupportChatSessionDto) {
  const incomingTime = detailTime(incoming);
  const existingTime = existing ? detailTime(existing) : null;
  return incomingTime === null || existingTime === null || incomingTime >= existingTime;
}

function detailTime(detail: SupportChatSessionDto) {
  const lastMessage = detail.messages.length > 0 ? detail.messages[detail.messages.length - 1] : null;
  const value = detail.contact?.lastMessageAt ?? lastMessage?.createdAt ?? null;
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

function isNearBottom(element: HTMLElement | null) {
  if (!element) return true;
  return element.scrollHeight - element.clientHeight - element.scrollTop < 24;
}

function scrollMessagesToBottom(element: HTMLElement | null) {
  if (element) {
    element.scrollTop = element.scrollHeight;
  }
}

function firstMessageAfter(messages: SupportChatMessage[], previousLastMessageId: string | null) {
  const previousIndex = previousLastMessageId
    ? messages.findIndex((message) => message.id === previousLastMessageId)
    : -1;
  if (previousIndex >= 0 && previousIndex < messages.length - 1) {
    return messages[previousIndex + 1].id;
  }
  return messages.length > 0 ? messages[messages.length - 1].id : null;
}

function isSupportChatMobile() {
  return typeof window !== 'undefined' && window.matchMedia(SUPPORT_CHAT_MOBILE_QUERY).matches;
}

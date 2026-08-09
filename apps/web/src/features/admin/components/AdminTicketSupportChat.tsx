import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, MonitorUp, Send } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Panel, StateMessage } from '../../../components/ui';
import {
  getAdminSupportChatSession,
  getAdminSupportChatSessions,
  openSupportChatSocket,
  roomSummaryToContact,
  type SupportChatMessageEvent,
  type SupportChatSocket
} from '../../support/supportChatApi';
import type { SupportChatMessage, SupportChatSessionDto, SupportChatSessionListDto } from '../../support/types';
import { AdminChatBubble, connectionClass, socketStatusLabel, type SocketStatus } from '../pages/AdminSupportChatSessionsPage';

const DEFAULT_POLL_MS = 5000;
const REMOTE_SUPPORT_GUIDE_MESSAGE = [
  'Chrome 원격 지원을 준비하겠습니다.',
  '1. 아래 페이지를 열고 「지원 받기」에서 Chrome Remote Desktop을 설치해 주세요.',
  '2. 「코드 생성」을 누른 뒤 표시되는 일회용 코드를 AS 요청 상세 화면에 등록해 주세요.',
  '3. 관리자가 코드를 입력하면 표시되는 관리자 이메일을 확인하고 「공유」를 눌러 주세요.',
  '지원 코드는 한 번만 사용할 수 있으며, 공유를 승인하기 전에는 연결되지 않습니다.',
  'https://remotedesktop.google.com/support'
].join('\n');

type RemoteSupportAction = {
  status?: string | null;
  canRequest: boolean;
  isPending: boolean;
  onRequest: () => Promise<void>;
};

// AS 티켓 상세에 박는 상담방 채팅(메시지 + 입력만). 방문 예약·상담방 삭제 같은 관리 기능은
// /admin/support-chat-sessions가 담당하고, 여기서는 이 티켓의 대화 확인·답변 전송만 한다.
// 실시간 방식은 상담방 관리 페이지와 동일: WebSocket 수신 + 재연결 사다리 + 폴링 폴백.
export function AdminTicketSupportChat({
  ticketId,
  remoteSupport,
  remoteSupportPanel
}: {
  ticketId: string;
  remoteSupport?: RemoteSupportAction;
  remoteSupportPanel?: ReactNode;
}) {
  const queryClient = useQueryClient();
  const socketRef = useRef<SupportChatSocket | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const wasAtBottomRef = useRef(true);
  const forceScrollToBottomRef = useRef(false);
  const [message, setMessage] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [socketStatus, setSocketStatus] = useState<SocketStatus>('polling');
  const [remoteGuideExpanded, setRemoteGuideExpanded] = useState(false);

  // 티켓→상담방 조회 API가 없어 목록에서 asTicketId로 찾는다. 방이 아직 없으면 목록만
  // 폴링해 생기는 즉시 붙고, 찾은 뒤에는 상세 폴링/WS가 갱신을 담당한다.
  const listQuery = useQuery({
    queryKey: ['admin-ticket-support-chat', 'sessions'],
    queryFn: getAdminSupportChatSessions,
    enabled: Boolean(ticketId),
    refetchInterval: (query) => {
      const list = query.state.data as SupportChatSessionListDto | undefined;
      return list && findSession(list, ticketId) ? false : pollingInterval(list);
    },
    retry: false
  });
  const session = findSession(listQuery.data, ticketId);
  const sessionId = session?.id ?? null;

  const detailQuery = useQuery({
    queryKey: ['admin-ticket-support-chat', 'session', sessionId],
    queryFn: () => getAdminSupportChatSession(sessionId as string, true),
    enabled: Boolean(sessionId),
    refetchInterval: (query) => sessionId && socketStatus !== 'connected'
      ? pollingInterval(query.state.data as SupportChatSessionDto | undefined)
      : false,
    retry: false
  });

  useEffect(() => {
    socketRef.current?.close();
    socketRef.current = null;
    setSocketStatus('polling');
    if (!sessionId) {
      return undefined;
    }
    let disposed = false;
    const connect = async () => {
      if (disposed) return;
      setSocketStatus('connecting');
      try {
        const socket = await openSupportChatSocket({
          mode: 'admin',
          sessionId,
          onOpen: () => {
            if (disposed) return;
            setSocketStatus('connected');
            void queryClient.invalidateQueries({ queryKey: ['admin-ticket-support-chat', 'session', sessionId] });
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
              markTicketMessageFailed(queryClient, sessionId, error.clientMessageId);
            }
          },
          onMessage: (event) => {
            wasAtBottomRef.current = isNearBottom(messagesRef.current);
            queryClient.setQueryData<SupportChatSessionDto | undefined>(
              ['admin-ticket-support-chat', 'session', sessionId],
              (existing) => patchTicketMessageEvent(existing, event)
            );
          },
          onRoom: (event) => {
            if (event.refreshRequired) {
              void queryClient.invalidateQueries({ queryKey: ['admin-ticket-support-chat', 'session', sessionId] });
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
  }, [sessionId, queryClient]);

  const remoteInviteMutation = useMutation({
    mutationFn: async () => {
      if (!remoteSupport || !sessionId) return null;
      await remoteSupport.onRequest();
      const clientMessageId = crypto.randomUUID();
      appendTicketOptimisticMessage(queryClient, sessionId, clientMessageId, REMOTE_SUPPORT_GUIDE_MESSAGE);
      socketRef.current?.sendMessage(REMOTE_SUPPORT_GUIDE_MESSAGE, clientMessageId);
      return clientMessageId;
    },
    onSuccess: (clientMessageId) => {
      if (!clientMessageId) return;
      forceScrollToBottomRef.current = true;
      setSendError(null);
    },
    onError: (error) => {
      setSendError(errorMessage(error));
    }
  });

  const contact = detailQuery.data?.contact ?? session ?? null;
  const messages: SupportChatMessage[] = detailQuery.data?.messages ?? [];
  const canSend = Boolean(sessionId && contact?.canSendMessage && message.trim() && socketStatus === 'connected');

  // 단순화한 스크롤: 방금 전송했거나 바닥 근처였을 때만 바닥으로 붙인다(새 메시지 마커 없음).
  useEffect(() => {
    if (!messagesRef.current) return;
    const shouldScroll = forceScrollToBottomRef.current || wasAtBottomRef.current;
    forceScrollToBottomRef.current = false;
    if (!shouldScroll) return;
    const frame = window.requestAnimationFrame(() => {
      scrollMessagesToBottom(messagesRef.current);
      wasAtBottomRef.current = true;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, sessionId]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSend || !sessionId) return;
    const outgoing = message.trim();
    try {
      const clientMessageId = crypto.randomUUID();
      appendTicketOptimisticMessage(queryClient, sessionId, clientMessageId, outgoing);
      socketRef.current?.sendMessage(outgoing, clientMessageId);
      forceScrollToBottomRef.current = true;
      setMessage('');
      setSendError(null);
    } catch (error) {
      setSendError(errorMessage(error));
    }
  }

  return (
    <div data-testid="admin-ticket-support-chat">
      <Panel
        title="상담방"
        subtitle="이 AS 티켓의 사용자 상담방입니다. 방문 예약과 상담방 삭제는 상담방 관리에서 처리합니다."
        className="shadow-sm"
        action={(
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Link className="shrink-0 text-sm font-bold text-brand-blue hover:underline" to="/admin/support-chat-sessions">상담방 관리로 이동</Link>
          </div>
        )}
      >
        {listQuery.isLoading ? <StateMessage type="info" title="상담방 확인 중" body="이 티켓의 상담방을 찾고 있습니다." /> : null}
        {listQuery.isError ? <StateMessage type="warn" title="상담방 조회 실패" body="상담방 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." /> : null}
        {!listQuery.isLoading && !listQuery.isError && !session ? (
          <StateMessage type="info" title="상담방 없음" body="이 티켓에 연결된 상담방이 아직 없습니다. 사용자가 상담을 시작하면 여기에 표시됩니다." />
        ) : null}
        {sessionId && detailQuery.isLoading ? <StateMessage type="info" title="대화 로딩 중" body="상담 메시지를 불러오고 있습니다." /> : null}
        {sessionId && detailQuery.isError ? <StateMessage type="warn" title="대화 조회 실패" body="상담방 상세를 불러오지 못했습니다." /> : null}
        {sessionId && detailQuery.data ? (
          <>
            <div className="mb-2 flex items-center justify-end">
              <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${connectionClass(socketStatus)}`}>
                {socketStatusLabel(socketStatus)}
              </span>
            </div>
            <div className="h-[380px] overflow-hidden rounded-lg border border-slate-200 bg-slate-50 sm:h-[420px] xl:h-[500px]">
              <div
                ref={messagesRef}
                data-testid="admin-ticket-support-chat-messages"
                className="h-full overflow-y-auto p-4 sm:p-5"
                onScroll={(event) => {
                  wasAtBottomRef.current = isNearBottom(event.currentTarget);
                }}
              >
                {messages.length === 0 ? (
                  <StateMessage type="info" title="메시지 없음" body="아직 메시지가 없습니다. 상담방이 활성화되면 채팅이 표시됩니다." />
                ) : (
                  <div className="space-y-3">
                    {messages.map((item) => <AdminChatBubble key={item.id} message={item} />)}
                  </div>
                )}
              </div>
            </div>
            <form onSubmit={submit} className="mt-4">
              {contact?.canSendMessage === false ? (
                <StateMessage type="info" title="종료된 상담방" body="종료된 AS 티켓 상담방에는 답변을 보낼 수 없습니다." />
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      className="h-12 min-w-0 flex-1 rounded-md border border-slate-300 px-4 text-base font-semibold focus:border-brand-blue focus:outline-none focus:ring-4 focus:ring-blue-100"
                      placeholder="관리자 답변을 입력하세요"
                      value={message}
                      maxLength={2000}
                      onChange={(event) => {
                        setMessage(event.target.value);
                        setSendError(null);
                      }}
                    />
                    <button
                      type="submit"
                      disabled={!canSend}
                      className="inline-flex h-12 min-w-28 shrink-0 items-center justify-center gap-1.5 rounded-md bg-brand-blue px-4 text-sm font-black text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                    >
                      <Send size={14} />
                      답변 전송
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-1 text-xs leading-5">
                    <span className={`font-bold ${sendError ? 'text-rose-700' : 'text-slate-500'}`} role={sendError ? 'alert' : undefined}>
                      {sendError ?? 'Enter 키로 즉시 전송합니다. 전송 후 입력창은 자동으로 비워집니다.'}
                    </span>
                    <span className="text-slate-500">문자 수 {message.length} / 2000</span>
                  </div>
                </div>
              )}
            </form>
          </>
        ) : null}
        {remoteSupport ? (
          <div className="mt-4">
            <button
              type="button"
              aria-expanded={remoteGuideExpanded}
              aria-controls="admin-ticket-remote-guide"
              onClick={() => setRemoteGuideExpanded((current) => !current)}
              className="flex w-full items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-left text-brand-blue transition hover:bg-blue-100 focus:outline-none focus:ring-4 focus:ring-blue-100"
            >
              <MonitorUp aria-hidden="true" className="shrink-0" size={20} />
              <span className="min-w-0 flex-1 text-sm font-black">
                {remoteGuideExpanded ? 'Chrome 원격 지원 안내 닫기' : 'Chrome 원격 지원 안내 보기'}
              </span>
              <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 transition-transform ${remoteGuideExpanded ? 'rotate-180' : ''}`} />
            </button>
            {remoteGuideExpanded ? (
              <div id="admin-ticket-remote-guide" className="mt-2 rounded-lg border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-4 shadow-sm">
                <p className="text-sm font-semibold leading-6 text-slate-700">
                  {remoteSupportStatusDescription(remoteSupport.status, remoteSupport.canRequest)}
                </p>
                {remoteSupport.status !== 'COMPLETED' ? (
                  <div className="mt-3 rounded-lg border border-blue-100 bg-white/90 p-3">
                    <p className="text-xs font-black text-slate-950">연결 방법</p>
                    <ol className="mt-2 space-y-2 text-xs font-semibold leading-5 text-slate-700">
                      <li><strong className="text-brand-blue">1. 사용자</strong> 안내 링크를 열고 「지원 받기 → 코드 생성」을 선택합니다.</li>
                      <li><strong className="text-brand-blue">2. 사용자</strong> 발급된 일회용 코드를 자신의 AS 상세 화면에 등록합니다.</li>
                      <li><strong className="text-brand-blue">3. 관리자</strong> 코드 등록 완료 후 아래 원격 지원 영역에서 코드를 복사해 「지원 제공」에 입력합니다.</li>
                      <li><strong className="text-brand-blue">4. 사용자</strong> 표시된 관리자 이메일을 확인하고 「공유」를 눌러야 실제 연결이 시작됩니다.</li>
                    </ol>
                    <p className="mt-2 text-[11px] font-bold leading-5 text-rose-700">일회용 코드는 한 번만 사용할 수 있으며, 사용자가 공유를 승인하기 전에는 PC 화면이 보이지 않습니다.</p>
                  </div>
                ) : null}
                {remoteSupport.status === 'CODE_READY' || remoteSupport.status === 'IN_PROGRESS' || remoteSupport.status === 'COMPLETED' ? (
                  <a
                    className="mt-3 inline-flex w-full items-center justify-center rounded-md border border-brand-blue bg-white px-4 py-2.5 text-sm font-black text-brand-blue hover:bg-blue-50"
                    href="#admin-ticket-remote-support"
                  >
                    {remoteSupportActionLabel(remoteSupport.status)}
                  </a>
                ) : (
                  <button
                    type="button"
                    disabled={!remoteSupport.canRequest || !sessionId || contact?.canSendMessage === false || remoteSupport.isPending || remoteInviteMutation.isPending}
                    onClick={() => remoteInviteMutation.mutate()}
                    className="mt-3 inline-flex w-full items-center justify-center rounded-md bg-brand-blue px-4 py-2.5 text-sm font-black text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                  >
                    {remoteInviteMutation.isPending || remoteSupport.isPending
                      ? '원격 지원 준비 중...'
                      : remoteSupport.status === 'WAITING_FOR_CODE'
                        ? 'Chrome 원격지원 안내 다시 보내기'
                        : 'Chrome 원격지원 안내 보내기'}
                  </button>
                )}
                {remoteInviteMutation.isSuccess ? (
                  <p className="mt-2 text-xs font-bold text-emerald-700">원격지원 승인과 사용자 안내 전송을 완료했습니다.</p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {remoteSupportPanel ? <div className="mt-4 border-t border-slate-200 pt-4">{remoteSupportPanel}</div> : null}
      </Panel>
    </div>
  );
}

function remoteSupportActionLabel(status?: string | null) {
  if (status === 'CODE_READY') return '등록된 지원 코드 확인';
  if (status === 'IN_PROGRESS') return '원격 지원 진행 상태 보기';
  return '완료된 원격 지원 보기';
}

function remoteSupportStatusDescription(status: string | null | undefined, canRequest: boolean) {
  if (status === 'WAITING_FOR_CODE') return '사용자가 일회용 지원 코드를 등록하기를 기다리고 있습니다. 필요하면 안내를 다시 보낼 수 있습니다.';
  if (status === 'CODE_READY') return '사용자가 일회용 코드를 등록했습니다. 기존 원격 지원 패널에서 코드를 확인해 연결하세요.';
  if (status === 'IN_PROGRESS') return 'Chrome Remote Desktop 원격 지원이 진행 중입니다.';
  if (status === 'COMPLETED') return '원격 지원이 완료되어 코드 조회와 재시작이 차단되었습니다.';
  if (!canRequest) return '완료됐거나 지원 범위를 벗어난 티켓에서는 원격 지원을 시작할 수 없습니다.';
  return '기존 승인 절차로 티켓을 원격 지원으로 전환하고 사용자에게 일회용 코드 등록 안내를 바로 보냅니다.';
}

function findSession(list: SupportChatSessionListDto | undefined, ticketId: string) {
  return list?.items.find((item) => item.asTicketId === ticketId) ?? null;
}

function patchTicketMessageEvent(existing: SupportChatSessionDto | undefined, event: SupportChatMessageEvent) {
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

function appendTicketOptimisticMessage(
  queryClient: ReturnType<typeof useQueryClient>,
  sessionId: string,
  clientMessageId: string,
  content: string
) {
  const optimistic: SupportChatMessage = {
    id: `optimistic:${clientMessageId}`,
    clientMessageId,
    role: 'ADMIN',
    content,
    createdAt: new Date().toISOString(),
    pending: true
  };
  queryClient.setQueryData<SupportChatSessionDto | undefined>(
    ['admin-ticket-support-chat', 'session', sessionId],
    (existing) => existing ? { ...existing, messages: [...existing.messages, optimistic] } : existing
  );
}

function markTicketMessageFailed(
  queryClient: ReturnType<typeof useQueryClient>,
  sessionId: string,
  clientMessageId: string
) {
  queryClient.setQueryData<SupportChatSessionDto | undefined>(
    ['admin-ticket-support-chat', 'session', sessionId],
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

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : '요청을 처리하지 못했습니다.';
}

function pollingInterval(detail?: { pollingIntervalMs?: number }) {
  const value = detail?.pollingIntervalMs;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : DEFAULT_POLL_MS;
}

function shouldApplyDetail(incoming: SupportChatSessionDto, existing?: SupportChatSessionDto) {
  const incomingTime = detailTime(incoming);
  const existingTime = existing ? detailTime(existing) : null;
  return incomingTime === null || existingTime === null || incomingTime >= existingTime;
}

function detailTime(detail: SupportChatSessionDto) {
  const lastMessage = detail.messages.length > 0 ? detail.messages[detail.messages.length - 1] : null;
  const value = detail.contact?.lastMessageAt ?? lastMessage?.createdAt ?? null;
  return timestamp(value);
}

function timestamp(value?: string | null) {
  if (!value) return 0;
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
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

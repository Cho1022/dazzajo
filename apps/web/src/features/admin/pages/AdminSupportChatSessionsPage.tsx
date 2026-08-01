import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CheckCircle2, Send } from 'lucide-react';
import { AdminShell, DataTable, Panel, StateMessage } from '../../../components/ui';
import { AUTH_CHANGED_EVENT, getCachedAuthUser } from '../../../lib/api';
import { formatSeoulDateTime } from '../../../lib/dateTime';
import { deleteAdminSupportChatSession, deleteAdminSupportChatVisitReservation, getAdminSupportChatSession, getAdminSupportChatSessions, openAdminSupportChatQueueSocket, openSupportChatSocket, roomSummaryToContact, putAdminSupportChatVisitReservation, type SupportChatMessageEvent, type SupportChatSocket } from '../../support/supportChatApi';
import { SupportChatMessageContent } from '../../support/SupportChatMessageContent';
import { KoreanStatusBadge } from '../adminDisplay';
import type { SupportChatContact, SupportChatMessage, SupportChatSessionDto, SupportChatSessionListDto, VisitSupportReservation } from '../../support/types';

const DEFAULT_POLL_MS = 5000;
export type SocketStatus = 'polling' | 'connecting' | 'reconnecting' | 'connected' | 'disconnected';

export function AdminSupportChatSessionsPage() {
  const queryClient = useQueryClient();
  const detailSocketRef = useRef<SupportChatSocket | null>(null);
  const queueSocketRef = useRef<SupportChatSocket | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const wasAtBottomRef = useRef(true);
  const forceScrollToBottomRef = useRef(false);
  const previousLastMessageIdRef = useRef<string | null>(null);
  const [authScope, setAuthScope] = useState(() => authScopeKey(getCachedAuthUser()));
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedSessionMarkRead, setSelectedSessionMarkRead] = useState(false);
  const [message, setMessage] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [visitScheduledAt, setVisitScheduledAt] = useState('');
  const [visitTechnicianNote, setVisitTechnicianNote] = useState('');
  const [visitError, setVisitError] = useState<string | null>(null);
  const [socketStatus, setSocketStatus] = useState<SocketStatus>('polling');
  const [queueSocketStatus, setQueueSocketStatus] = useState<SocketStatus>('polling');
  const [newMarkerMessageId, setNewMarkerMessageId] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['admin-support-chat-sessions', authScope],
    queryFn: getAdminSupportChatSessions,
    refetchInterval: (query) => queueSocketStatus === 'connected'
      ? false
      : pollingInterval(query.state.data as SupportChatSessionListDto | undefined),
    retry: false
  });
  const rooms = listQuery.data?.items ?? [];

  useEffect(() => {
    if (!selectedSessionId && rooms[0]?.id) {
      setSelectedSessionMarkRead(false);
      setSelectedSessionId(rooms[0].id);
    }
  }, [rooms, selectedSessionId]);

  const detailQuery = useQuery({
    queryKey: ['admin-support-chat-session', authScope, selectedSessionId, selectedSessionMarkRead],
    queryFn: () => getAdminSupportChatSession(selectedSessionId as string, selectedSessionMarkRead),
    enabled: Boolean(selectedSessionId),
    refetchInterval: (query) => selectedSessionId && socketStatus !== 'connected'
      ? pollingInterval(query.state.data as SupportChatSessionDto | undefined)
      : false,
    retry: false
  });

  useEffect(() => {
    const handleAuthChanged = () => {
      setAuthScope(authScopeKey(getCachedAuthUser()));
      detailSocketRef.current?.close();
      detailSocketRef.current = null;
      queueSocketRef.current?.close();
      queueSocketRef.current = null;
      setSocketStatus('polling');
      setQueueSocketStatus('polling');
      setSelectedSessionId(null);
      setSelectedSessionMarkRead(false);
      setMessage('');
      setSendError(null);
      setDeleteError(null);
      setVisitScheduledAt('');
      setVisitTechnicianNote('');
      setVisitError(null);
      setNewMarkerMessageId(null);
      queryClient.removeQueries({ queryKey: ['admin-support-chat-sessions'] });
      queryClient.removeQueries({ queryKey: ['admin-support-chat-session'] });
    };
    window.addEventListener(AUTH_CHANGED_EVENT, handleAuthChanged);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, handleAuthChanged);
  }, [queryClient]);

  useEffect(() => {
    queueSocketRef.current?.close();
    queueSocketRef.current = null;
    setQueueSocketStatus('polling');
    if (authScope === 'anonymous') {
      return undefined;
    }
    let disposed = false;
    const connect = async () => {
      if (disposed) return;
      setQueueSocketStatus('connecting');
      try {
        const socket = await openAdminSupportChatQueueSocket({
          onOpen: () => {
            if (disposed) return;
            setQueueSocketStatus('connected');
            void queryClient.invalidateQueries({ queryKey: ['admin-support-chat-sessions', authScope] });
          },
          onClose: () => {
            if (disposed) return;
            setQueueSocketStatus('reconnecting');
          },
          onError: () => {
            if (disposed) return;
            setQueueSocketStatus('reconnecting');
          },
          onSocketError: (error) => {
            if (error.message) {
              setSendError(error.message);
            }
          },
          onUpdated: (contact) => {
            queryClient.setQueryData<SupportChatSessionListDto | undefined>(
              ['admin-support-chat-sessions', authScope],
              (existing) => patchAdminList(existing, contact)
            );
          },
          onRemoved: (id) => {
            queryClient.setQueryData<SupportChatSessionListDto | undefined>(
              ['admin-support-chat-sessions', authScope],
              (existing) => removeAdminListItem(existing, id)
            );
          }
        });
        if (disposed) {
          socket?.close();
          return;
        }
        queueSocketRef.current = socket;
        if (!socket) {
          setQueueSocketStatus('polling');
        }
      } catch (error) {
        if (disposed) return;
        setQueueSocketStatus('disconnected');
      }
    };

    connect();
    return () => {
      disposed = true;
      queueSocketRef.current?.close();
      queueSocketRef.current = null;
      setQueueSocketStatus('polling');
    };
  }, [authScope, queryClient]);

  useEffect(() => {
    detailSocketRef.current?.close();
    detailSocketRef.current = null;
    setSocketStatus('polling');
    if (!selectedSessionId) {
      return undefined;
    }
    let disposed = false;
    const connect = async () => {
      if (disposed) return;
      setSocketStatus('connecting');
      try {
        const socket = await openSupportChatSocket({
          mode: 'admin',
          sessionId: selectedSessionId,
          onOpen: () => {
            if (disposed) return;
            setSocketStatus('connected');
            void queryClient.invalidateQueries({
              queryKey: ['admin-support-chat-session', authScope, selectedSessionId]
            });
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
              markAdminMessageFailed(queryClient, authScope, error.clientMessageId);
            }
          },
          onMessage: (event) => {
            wasAtBottomRef.current = isNearBottom(messagesRef.current);
            cacheAdminMessageEvent(queryClient, authScope, event);
          },
          onRoom: (event) => {
            if (event.room) {
              queryClient.setQueryData<SupportChatSessionListDto | undefined>(
                ['admin-support-chat-sessions', authScope],
                (existing) => patchAdminList(existing, roomSummaryToContact(event.room!))
              );
            }
            if (event.refreshRequired) {
              void queryClient.invalidateQueries({
                queryKey: ['admin-support-chat-session', authScope, selectedSessionId]
              });
            }
          }
        });
        if (disposed) {
          socket?.close();
          return;
        }
        detailSocketRef.current = socket;
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
      detailSocketRef.current?.close();
      detailSocketRef.current = null;
      setSocketStatus('polling');
    };
  }, [authScope, selectedSessionId, queryClient]);

  const scheduleVisitMutation = useMutation({
    mutationFn: () => putAdminSupportChatVisitReservation(selectedSessionId as string, {
      scheduledAt: toSeoulOffsetDateTime(visitScheduledAt),
      technicianNote: visitTechnicianNote.trim()
    }),
    onSuccess: (detail) => {
      setVisitError(null);
      cacheDetail(queryClient, authScope, detail);
      void listQuery.refetch();
    },
    onError: (error) => {
      setVisitError(errorMessage(error));
    }
  });

  const cancelVisitMutation = useMutation({
    mutationFn: () => deleteAdminSupportChatVisitReservation(selectedSessionId as string),
    onSuccess: (detail) => {
      setVisitError(null);
      cacheDetail(queryClient, authScope, detail);
      void listQuery.refetch();
    },
    onError: (error) => {
      setVisitError(errorMessage(error));
    }
  });

  const deleteSessionMutation = useMutation({
    mutationFn: () => deleteAdminSupportChatSession(selectedSessionId as string),
    onSuccess: (detail) => {
      setDeleteError(null);
      setSendError(null);
      const contact = detail.contact;
      if (contact?.id) {
        queryClient.setQueriesData<SupportChatSessionDto | undefined>(
          { queryKey: ['admin-support-chat-session', authScope, contact.id] },
          () => detail
        );
        queryClient.setQueryData<SupportChatSessionListDto | undefined>(
          ['admin-support-chat-sessions', authScope],
          (existing) => removeAdminListItem(existing, contact.id)
        );
      }
    },
    onError: (error) => {
      setDeleteError(errorMessage(error));
    }
  });

  const selectedRoom = detailQuery.data?.contact ?? rooms.find((room) => room.id === selectedSessionId) ?? null;
  const messages = detailQuery.data?.messages ?? [];
  const canSend = Boolean(selectedSessionId && selectedRoom?.canSendMessage && message.trim() && socketStatus === 'connected');
  const canScheduleVisit = Boolean(selectedSessionId && selectedRoom?.canSendMessage && visitScheduledAt && !scheduleVisitMutation.isPending);
  const canCancelVisit = Boolean(selectedSessionId && selectedRoom?.canSendMessage && selectedRoom?.visitReservation && selectedRoom.visitReservation.status !== 'CANCELLED' && !cancelVisitMutation.isPending);
  const canDeleteSession = Boolean(selectedSessionId && selectedRoom?.status === 'ACTIVE' && !deleteSessionMutation.isPending);

  useEffect(() => {
    const reservation = selectedRoom?.visitReservation;
    setVisitScheduledAt(toDatetimeLocalValue(reservation?.scheduledAt));
    setVisitTechnicianNote(reservation?.technicianNote ?? '');
    setVisitError(null);
  }, [selectedRoom?.id, selectedRoom?.visitReservation?.id, selectedRoom?.visitReservation?.scheduledAt, selectedRoom?.visitReservation?.technicianNote]);

  const roomRows = rooms.map((room) => ({
    선택: (
      <button
        type="button"
        onClick={() => {
          setSelectedSessionMarkRead(true);
          setSelectedSessionId(room.id);
          setDeleteError(null);
        }}
        className={`h-8 min-w-14 rounded-md px-3 text-[11px] font-black transition ${
          room.id === selectedSessionId ? 'bg-brand-blue text-white' : 'border border-slate-300 text-slate-700 hover:border-brand-blue hover:text-brand-blue'
        }`}
        aria-label={`${userLabel(room)} 상담방 선택`}
      >
        선택
      </button>
    ),
    사용자: <span className="block min-w-0 truncate font-black text-slate-900">{userLabel(room)}</span>,
    티켓: <Link to={`/admin/as-tickets/${room.asTicketId}`} className="font-black text-brand-blue hover:underline">{shortId(room.asTicketId)}</Link>,
    상태: <KoreanStatusBadge status={room.ticketStatus ?? room.status} />,
    안읽음: room.adminUnreadCount ?? 0,
    예약: <span className="font-black">{visitListLabel(room.visitReservation ?? null)}</span>,
    증상: <span className="line-clamp-2 block max-w-[20ch] sm:max-w-[28ch] lg:max-w-[36ch]">{room.symptom ?? '-'}</span>,
    최근메시지: <span className="line-clamp-2 block max-w-[26ch]">{room.lastMessagePreview ?? '-'}</span>,
    최근시각: formatDateTime(room.lastMessageAt ?? undefined)
  }));
  const exportRows = rooms.map((room) => ({
    id: room.id,
    asTicketId: room.asTicketId,
    user: userLabel(room),
    ticketStatus: room.ticketStatus ?? room.status,
    adminUnreadCount: room.adminUnreadCount ?? 0,
    visitReservation: visitListLabel(room.visitReservation ?? null),
    symptom: room.symptom ?? '',
    lastMessageAt: formatDateTime(room.lastMessageAt ?? undefined)
  }));

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSend || !selectedSessionId) return;
    const outgoing = message.trim();
    try {
      const clientMessageId = crypto.randomUUID();
      appendAdminOptimisticMessage(queryClient, authScope, selectedSessionId, clientMessageId, outgoing);
      detailSocketRef.current?.sendMessage(outgoing, clientMessageId);
      forceScrollToBottomRef.current = true;
      setMessage('');
      setSendError(null);
    } catch (error) {
      setSendError(errorMessage(error));
    }
  }

  function submitVisitReservation(event: FormEvent) {
    event.preventDefault();
    if (!canScheduleVisit) return;
    setVisitError(null);
    scheduleVisitMutation.mutate();
  }

  function cancelVisitReservation() {
    if (!canCancelVisit) return;
    setVisitError(null);
    cancelVisitMutation.mutate();
  }

  function deleteSession() {
    if (!canDeleteSession) return;
    if (!window.confirm('상담방을 삭제하면 기존 티켓이 취소되고 사용자는 새 AS를 접수할 수 있습니다. 계속할까요?')) {
      return;
    }
    setDeleteError(null);
    deleteSessionMutation.mutate();
  }

  useEffect(() => {
    if (!messagesRef.current) return;
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
  }, [messages, selectedSessionId]);

  return (
    <AdminShell title="상담방 관리" exportRows={exportRows} exportFileName="admin-support-chat-sessions.csv">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_460px]">
        <Panel title="상담방 목록" subtitle="AS 티켓이 생성된 사용자 상담방을 확인하고 응답할 수 있습니다.">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="inline-flex items-center gap-2 rounded-md bg-slate-100 px-2.5 py-1.5 text-slate-700">
              <span className="font-black">목록</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-black ${connectionClass(queueSocketStatus)}`}>{socketStatusLabel(queueSocketStatus)}</span>
              <span className="text-slate-500">총 {rooms.length}건</span>
            </div>
            <div className="text-slate-500">
              갱신 간격: <span className="font-black text-slate-700">{pollingLabel(listQuery.data)}</span>
            </div>
          </div>
          {listQuery.isLoading ? <StateMessage type="info" title="상담방 로딩 중" body="사용자 상담방 목록을 불러오고 있습니다." /> : null}
          {listQuery.isError ? <StateMessage type="warn" title="상담방 조회 실패" body="관리자 상담방 목록을 불러오지 못했습니다." /> : null}
          {!listQuery.isLoading && !listQuery.isError && roomRows.length === 0 ? (
            <StateMessage type="info" title="상담방 없음" body="아직 관리할 사용자 상담방이 없습니다." />
          ) : null}
          {!listQuery.isLoading && !listQuery.isError && roomRows.length > 0 ? (
            <DataTable columns={['선택', '사용자', '티켓', '상태', '안읽음', '예약', '증상', '최근메시지', '최근시각']} rows={roomRows} />
          ) : null}
        </Panel>

        <Panel title="대화 내용" subtitle={selectedRoom ? `${userLabel(selectedRoom)} · ${shortId(selectedRoom.asTicketId)}` : '상담방을 선택하세요.'}>
          {!selectedSessionId ? (
            <StateMessage type="info" title="선택된 상담방 없음" body="왼쪽 목록에서 상담방을 선택하면 대화 내용이 표시됩니다." />
          ) : null}
          {detailQuery.isLoading ? <StateMessage type="info" title="대화 로딩 중" body="상담 메시지를 불러오고 있습니다." /> : null}
          {detailQuery.isError ? <StateMessage type="warn" title="대화 조회 실패" body="상담방 상세를 불러오지 못했습니다." /> : null}
          {detailQuery.data ? (
            <>
              <div className="mb-4 rounded-lg border border-slate-200 bg-white p-3 text-sm">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-black text-slate-900">{selectedRoom?.symptom ?? 'AS 상담'}</div>
                    <div className="mt-0.5 text-[11px] text-slate-500">상담방 ID: {selectedRoom?.id ?? '-'}</div>
                  </div>
                  <button
                    type="button"
                    disabled={!canDeleteSession}
                    onClick={deleteSession}
                    className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-rose-300 px-3 text-[11px] font-black text-rose-800 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-transparent disabled:text-slate-400"
                  >
                    <CheckCircle2 size={14} />
                    {deleteSessionMutation.isPending ? '삭제 중' : '상담방 삭제'}
                  </button>
                </div>
                <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
                  <MetaItem label="티켓">{shortId(selectedRoom?.asTicketId ?? '-')}</MetaItem>
                  <MetaItem label="상태">
                    <span className="inline-flex flex-wrap gap-1">
                      <KoreanStatusBadge status={selectedRoom?.status ?? 'UNKNOWN'} />
                      <KoreanStatusBadge status={selectedRoom?.ticketStatus ?? 'UNKNOWN'} />
                    </span>
                  </MetaItem>
                  <MetaItem label="안읽음">{selectedRoom?.adminUnreadCount ?? 0}</MetaItem>
                  <MetaItem label="연결 상태">{socketStatusLabel(socketStatus)}</MetaItem>
                  <MetaItem label="마지막 업데이트">{selectedRoom?.lastMessageAt ? formatDateTime(selectedRoom.lastMessageAt) : '-'}</MetaItem>
                  <MetaItem label="예약 정보">{visitListLabel(selectedRoom?.visitReservation ?? null)}</MetaItem>
                </div>
              </div>
              {selectedRoom?.status === 'ARCHIVED' ? (
                <StateMessage type="warn" title="상담방 삭제됨" body="이 상담방은 관리자에 의해 삭제되어 목록에서 제외되었습니다. 사용자는 새 AS 접수를 진행할 수 있습니다." />
              ) : null}
              {deleteError ? (
                <StateMessage type="warn" title="상담방 삭제 실패" body={deleteError} />
              ) : null}
              <AdminVisitReservationPanel
                reservation={selectedRoom?.visitReservation ?? null}
                scheduledAt={visitScheduledAt}
                technicianNote={visitTechnicianNote}
                error={visitError}
                disabled={selectedRoom?.canSendMessage === false}
                schedulePending={scheduleVisitMutation.isPending}
                cancelPending={cancelVisitMutation.isPending}
                canSchedule={canScheduleVisit}
                canCancel={canCancelVisit}
                onScheduledAtChange={(value) => {
                  setVisitScheduledAt(value);
                  setVisitError(null);
                }}
                onTechnicianNoteChange={(value) => {
                  setVisitTechnicianNote(value);
                  setVisitError(null);
                }}
                onSubmit={submitVisitReservation}
                onCancel={cancelVisitReservation}
              />
              <div className="relative h-[340px] overflow-hidden rounded-md border border-slate-200 bg-slate-50 sm:h-[380px] lg:h-[440px]">
                <div
                  ref={messagesRef}
                  data-testid="admin-support-chat-messages"
                  className="h-full overflow-y-auto p-4"
                  onScroll={(event) => {
                    const nearBottom = isNearBottom(event.currentTarget);
                    wasAtBottomRef.current = nearBottom;
                    if (nearBottom) {
                      setNewMarkerMessageId(null);
                    }
                  }}
                >
                  {messages.length === 0 ? (
                    <StateMessage type="info" title="메시지 없음" body="아직 메시지가 없습니다. 상담방이 활성화되면 채팅이 표시됩니다." />
                  ) : (
                    <div className="space-y-3">
                      {messages.map((item) => (
                        <div key={item.id}>
                          {newMarkerMessageId === item.id ? <NewMessageMarker /> : null}
                          <AdminChatBubble message={item} />
                        </div>
                      ))}
                    </div>
                  )}
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
                    className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-brand-blue px-4 py-2 text-xs font-bold text-white shadow-lg"
                  >
                    새 메시지로 이동
                  </button>
                ) : null}
              </div>
              <form onSubmit={submit} className="mt-4">
                {selectedRoom?.canSendMessage === false ? (
                  <StateMessage type="info" title="종료된 상담방" body="종료된 AS 티켓 상담방에는 답변을 보낼 수 없습니다." />
                ) : (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <input
                        className="h-11 min-w-0 flex-1 rounded-md border border-slate-300 px-3 text-sm focus:border-brand-blue focus:outline-none focus:ring-4 focus:ring-blue-100"
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
                        className="inline-flex h-11 min-w-28 shrink-0 items-center justify-center gap-1 rounded-md bg-brand-blue px-4 text-sm font-black text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                      >
                        <Send size={14} />
                        답변 전송
                      </button>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
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
        </Panel>
      </div>
    </AdminShell>
  );
}

export function AdminChatBubble({ message }: { message: SupportChatMessage }) {
  const isAdmin = message.role === 'ADMIN';
  const isSystem = message.role === 'SYSTEM';
  return (
    <div className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[88%] rounded-lg border px-4 py-3 text-[15px] font-semibold leading-6 shadow-sm ${
        isAdmin
          ? 'bg-brand-blue text-white'
          : isSystem
            ? 'border-slate-200 bg-white text-slate-600'
            : 'border-slate-200 bg-white text-slate-900'
      }`}>
        <div className="mb-1.5 flex items-center justify-between gap-3 text-xs font-bold opacity-80">
          <span>{messageLabel(message)}</span>
          <time className="font-normal opacity-75" dateTime={message.createdAt ?? undefined}>
            {formatDateTime(message.createdAt)}
          </time>
        </div>
        <SupportChatMessageContent className="whitespace-pre-wrap break-words" content={message.content} />
      </div>
    </div>
  );
}

function NewMessageMarker() {
  return (
    <div className="my-3 flex items-center gap-3" aria-label="새 메시지">
      <div className="h-px flex-1 bg-blue-200" />
      <span className="rounded-full bg-blue-50 px-3 py-1 text-[11px] font-black text-brand-blue">새 메시지</span>
      <div className="h-px flex-1 bg-blue-200" />
    </div>
  );
}

function AdminVisitReservationPanel({
  reservation,
  scheduledAt,
  technicianNote,
  error,
  disabled,
  schedulePending,
  cancelPending,
  canSchedule,
  canCancel,
  onScheduledAtChange,
  onTechnicianNoteChange,
  onSubmit,
  onCancel
}: {
  reservation: VisitSupportReservation | null;
  scheduledAt: string;
  technicianNote: string;
  error: string | null;
  disabled: boolean;
  schedulePending: boolean;
  cancelPending: boolean;
  canSchedule: boolean;
  canCancel: boolean;
  onScheduledAtChange: (value: string) => void;
  onTechnicianNoteChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
}) {
  return (
    <form onSubmit={onSubmit} className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-black text-slate-900">방문 예약</div>
          <div className="mt-1 text-xs font-bold text-brand-blue">{adminVisitStatusLabel(reservation?.status)}</div>
        </div>
        {reservation?.scheduledAt ? <div className="text-right text-xs text-slate-700">{formatVisitTime(reservation.scheduledAt)}</div> : null}
      </div>
      <div className="grid gap-2">
        <label className="grid gap-1 text-xs font-bold text-slate-600">
          방문 예약 시각
          <input
            type="datetime-local"
            value={scheduledAt}
            disabled={disabled}
            onChange={(event) => onScheduledAtChange(event.target.value)}
            className="h-10 rounded-md border border-slate-300 px-3 text-sm font-normal text-slate-900 focus:border-brand-blue focus:outline-none focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100"
          />
        </label>
        <label className="grid gap-1 text-xs font-bold text-slate-600">
          기사 메모
          <input
            value={technicianNote}
            disabled={disabled}
            onChange={(event) => onTechnicianNoteChange(event.target.value)}
            className="h-10 rounded-md border border-slate-300 px-3 text-sm font-normal text-slate-900 focus:border-brand-blue focus:outline-none focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100"
          />
        </label>
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={disabled || !canSchedule}
            className="h-10 flex-1 rounded-md bg-brand-blue px-3 text-xs font-black text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {schedulePending ? '저장 중' : '예약 확정'}
          </button>
          <button
            type="button"
            disabled={disabled || !canCancel}
            onClick={onCancel}
            className="h-10 rounded-md border border-rose-200 px-3 text-xs font-black text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
          >
            {cancelPending ? '취소 중' : '예약 취소'}
          </button>
        </div>
        {error ? <p role="alert" className="text-xs font-bold text-rose-700">{error}</p> : null}
      </div>
    </form>
  );
}

function cacheDetail(queryClient: ReturnType<typeof useQueryClient>, authScope: string, detail: SupportChatSessionDto) {
  if (detail.contact?.id) {
    queryClient.setQueriesData<SupportChatSessionDto | undefined>(
      { queryKey: ['admin-support-chat-session', authScope, detail.contact.id] },
      (existing) => shouldApplyDetail(detail, existing) ? detail : existing
    );
    queryClient.setQueryData<SupportChatSessionListDto | undefined>(
      ['admin-support-chat-sessions', authScope],
      (existing) => patchAdminList(existing, detail.contact as SupportChatContact)
    );
  }
}

function cacheAdminMessageEvent(
  queryClient: ReturnType<typeof useQueryClient>,
  authScope: string,
  event: SupportChatMessageEvent
) {
  queryClient.setQueriesData<SupportChatSessionDto | undefined>(
    { queryKey: ['admin-support-chat-session', authScope, event.roomId] },
    (existing) => patchAdminMessageEvent(existing, event)
  );
  queryClient.setQueryData<SupportChatSessionListDto | undefined>(
    ['admin-support-chat-sessions', authScope],
    (existing) => patchAdminList(existing, roomSummaryToContact(event.room))
  );
}

function patchAdminMessageEvent(existing: SupportChatSessionDto | undefined, event: SupportChatMessageEvent) {
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

function appendAdminOptimisticMessage(
  queryClient: ReturnType<typeof useQueryClient>,
  authScope: string,
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
  queryClient.setQueriesData<SupportChatSessionDto | undefined>(
    { queryKey: ['admin-support-chat-session', authScope, sessionId] },
    (existing) => existing ? { ...existing, messages: [...existing.messages, optimistic] } : existing
  );
}

function markAdminMessageFailed(
  queryClient: ReturnType<typeof useQueryClient>,
  authScope: string,
  clientMessageId: string
) {
  queryClient.setQueriesData<SupportChatSessionDto | undefined>(
    { queryKey: ['admin-support-chat-session', authScope] },
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

function patchAdminList(existing: SupportChatSessionListDto | undefined, contact: SupportChatContact) {
  if (!existing) return existing;
  const items = existing.items.some((item) => item.id === contact.id)
    ? existing.items.map((item) => item.id === contact.id ? { ...item, ...contact } : item)
    : [contact, ...existing.items];
  return {
    ...existing,
    items: items.sort((left, right) => timestamp(right.lastMessageAt) - timestamp(left.lastMessageAt))
  };
}

function removeAdminListItem(existing: SupportChatSessionListDto | undefined, id: string) {
  if (!existing) return existing;
  return {
    ...existing,
    items: existing.items.filter((item) => item.id !== id)
  };
}

function messageLabel(message: SupportChatMessage) {
  if (message.role === 'SYSTEM') return '시스템';
  if (message.role === 'ADMIN') return message.senderName ?? '관리자';
  return message.senderName ?? '사용자';
}

function userLabel(room: SupportChatContact) {
  return room.user?.email ?? room.user?.name ?? room.user?.id ?? '-';
}

function MetaItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50 p-2">
      <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 text-sm text-slate-800">{children}</div>
    </div>
  );
}

function shortId(id: string) {
  return id.length <= 12 ? id : `${id.slice(0, 8)}...${id.slice(-4)}`;
}

function formatDateTime(value?: string) {
  return formatSeoulDateTime(value);
}

function pollingLabel(list: SupportChatSessionListDto | undefined) {
  const polling = pollingInterval(list);
  return `${polling}ms`;
}

export function socketStatusLabel(status: SocketStatus) {
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

export function connectionClass(status: SocketStatus) {
  switch (status) {
    case 'connected':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'connecting':
    case 'reconnecting':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'disconnected':
      return 'bg-rose-50 text-rose-700 border-rose-200';
    case 'polling':
    default:
      return 'bg-slate-200 text-slate-700 border-slate-300';
  }
}

function visitListLabel(reservation?: VisitSupportReservation | null) {
  if (!reservation) return '-';
  const time = reservation.scheduledAt ? ` ${formatVisitTime(reservation.scheduledAt)}` : '';
  return `${adminVisitStatusLabel(reservation.status)}${time}`;
}

function adminVisitStatusLabel(status?: string | null) {
  switch (status) {
    case 'REQUESTED':
    case 'RESCHEDULE_REQUESTED':
      return '확인 대기';
    case 'SCHEDULED':
      return '예약 확정됨';
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

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : '요청을 처리하지 못했습니다.';
}

function pollingInterval(detail?: { pollingIntervalMs?: number }) {
  const value = detail?.pollingIntervalMs;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : DEFAULT_POLL_MS;
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

function firstMessageAfter(messages: SupportChatMessage[], previousLastMessageId: string | null) {
  const previousIndex = previousLastMessageId
    ? messages.findIndex((message) => message.id === previousLastMessageId)
    : -1;
  if (previousIndex >= 0 && previousIndex < messages.length - 1) {
    return messages[previousIndex + 1].id;
  }
  return messages.length > 0 ? messages[messages.length - 1].id : null;
}

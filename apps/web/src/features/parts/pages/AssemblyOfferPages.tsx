import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowUpDown,
  BadgeCheck,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  CreditCard,
  MapPin,
  ShieldCheck,
  Star,
  Truck,
  UserRoundCheck,
  Wrench
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MutationToast } from '../../../components/feedback/MutationToast';
import { Panel, Screen, StateMessage, StatusBadge } from '../../../components/ui';
import { ApiError } from '../../../lib/api';
import {
  cancelAssemblyRequest,
  getAssemblyRequest,
  listAssemblyRequests,
  selectAssemblyOffer,
  type AssemblyOffer,
  type AssemblyRequest,
  type AssemblyRequestStatus,
  type AssemblyRequestSummary
} from '../assemblyApi';
import { resolveProfileImageSrc } from '../profileImageFile';

const STATUS_LABELS: Record<AssemblyRequestStatus, string> = {
  REQUESTED: '기사 제안 대기',
  OFFERED: '기사 제안 도착',
  MATCHED: '기사 선택 완료',
  CONFIRMED: '조립 일정 확정',
  ASSEMBLING: '조립 중',
  SHIPPED: '배송 중',
  COMPLETED: '완료',
  CANCELLED: '취소'
};

const LIVE_OFFER_STATUSES = new Set<AssemblyRequestStatus>(['REQUESTED', 'OFFERED']);
const OFFER_LIST_REFETCH_INTERVAL_MS = 3000;
type OfferSortKey = 'newest' | 'priceAsc' | 'leadTimeAsc' | 'ratingDesc';
const OFFER_SORT_OPTIONS: Array<{ value: OfferSortKey; label: string }> = [
  { value: 'newest', label: '최신순' },
  { value: 'priceAsc', label: '낮은 가격순' },
  { value: 'leadTimeAsc', label: '빠른 일정순' },
  { value: 'ratingDesc', label: '평점 높은순' }
];

export function CheckoutOffersPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { requestId } = useParams();
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const [offerSort, setOfferSort] = useState<OfferSortKey>('newest');
  const [newOfferNotice, setNewOfferNotice] = useState('');
  const [selectionError, setSelectionError] = useState('');
  const previousAvailableCount = useRef<number | null>(null);
  const requestQueryKey = ['assembly-request', requestId] as const;
  const requestQuery = useQuery({
    queryKey: requestQueryKey,
    queryFn: () => getAssemblyRequest(requestId!),
    enabled: Boolean(requestId),
    refetchInterval: (query) => {
      const status = (query.state.data as AssemblyRequest | undefined)?.status;
      return isLiveOfferStatus(status) ? OFFER_LIST_REFETCH_INTERVAL_MS : false;
    },
    refetchIntervalInBackground: true,
    refetchOnReconnect: 'always',
    refetchOnWindowFocus: 'always'
  });
  const selectMutation = useMutation({
    mutationFn: (offerId: string) => selectAssemblyOffer(requestId!, offerId),
    onMutate: () => setSelectionError(''),
    onSuccess: async (request) => {
      queryClient.setQueryData(['assembly-request', request.id], request);
      await queryClient.invalidateQueries({ queryKey: ['assembly-requests'] });
      navigate(`/checkout/payment/${request.id}`);
    },
    onError: async (error) => {
      setSelectedOfferId(null);
      if (isSelectionConflict(error)) {
        setSelectionError('다른 변경이 먼저 반영되었습니다. 최신 제안 상태를 다시 불러왔습니다.');
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: requestQueryKey }),
          queryClient.invalidateQueries({ queryKey: ['assembly-requests'] })
        ]);
        return;
      }
      setSelectionError(selectionErrorMessage(error));
    }
  });

  useEffect(() => {
    const availableCount = requestQuery.data?.offers.filter((offer) => offer.status === 'AVAILABLE').length;
    if (availableCount == null) return;
    if (previousAvailableCount.current != null && availableCount > previousAvailableCount.current) {
      setNewOfferNotice(`새 기사 제안 ${availableCount - previousAvailableCount.current}건이 도착했습니다.`);
    }
    previousAvailableCount.current = availableCount;
  }, [requestQuery.data?.offers]);

  useEffect(() => {
    if (!selectedOfferId || !requestQuery.data) return;
    const selectedOffer = requestQuery.data.offers.find((offer) => offer.id === selectedOfferId);
    if (requestQuery.data.status !== 'OFFERED' || selectedOffer?.status !== 'AVAILABLE') {
      setSelectedOfferId(null);
    }
  }, [requestQuery.data, selectedOfferId]);

  if (!requestId) return <MissingAssemblyRequest />;
  if (requestQuery.isLoading) return <AssemblyLoading />;
  if (requestQuery.isError || !requestQuery.data) return <AssemblyError />;

  const request = requestQuery.data;
  const persistedSelectedId = request.selectedOfferId ?? null;
  const effectiveSelectedId = selectedOfferId ?? persistedSelectedId;
  const selectedOffer = request.offers.find((offer) => offer.id === effectiveSelectedId) ?? null;
  const activeOffers = request.offers.filter((offer) => ['AVAILABLE', 'SELECTED'].includes(offer.status));
  const internalOfferCount = activeOffers.filter((offer) => offer.providerType !== 'EXTERNAL').length;
  const externalOfferCount = activeOffers.filter((offer) => offer.providerType === 'EXTERNAL').length;
  const sortedOffers = sortAssemblyOffers(request.offers, offerSort);
  const externalOffers = sortedOffers.filter((offer) => offer.providerType === 'EXTERNAL');
  const internalOffers = sortedOffers.filter((offer) => offer.providerType === 'INTERNAL');

  return (
    <Screen>
      <MutationToast message={selectionError} onClose={() => setSelectionError('')} />
      <header className="mb-5">
        <div>
          <Link to="/my/assembly-requests" className="inline-flex items-center gap-2 text-sm font-black text-brand-blue hover:underline">
            <ArrowLeft size={16} /> 내 조립 요청
          </Link>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-black tracking-tight text-commerce-ink">기사 제안 {activeOffers.length}건</h1>
            <StatusBadge status={request.status} />
          </div>
          <p className="mt-2 max-w-2xl break-keep text-sm leading-6 text-slate-600">등록 기사와 플랫폼의 작업 조건, 보증 기간과 서버가 계산한 최종 결제 예정액을 비교해 한 건을 선택하세요.</p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs font-black"><span className="rounded bg-blue-50 px-2 py-1 text-blue-800">등록 기사 {externalOfferCount}건</span><span className="rounded bg-slate-100 px-2 py-1 text-commerce-ink">플랫폼 제안 {internalOfferCount}건</span></div>
        </div>
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-w-0 space-y-3" aria-label="기사 제안 목록">
          {request.offers.length > 1 ? (
            <div className="flex justify-end">
              <OfferSortDropdown value={offerSort} onChange={setOfferSort} />
            </div>
          ) : null}
          {newOfferNotice ? <StateMessage type="success" title="새 제안 도착" body={newOfferNotice} /> : null}
          {request.offers.length === 0 ? (
            <StateMessage type="info" title="기사 제안을 준비하고 있습니다" body="지역과 서비스 조건에 맞는 기사 제안이 등록되면 이 화면에서 바로 비교할 수 있습니다." />
          ) : (
            <>
              <OfferSection
                id="external-offer-section"
                title="등록 기사 제안"
                description="승인된 조립 기사가 직접 제안한 공임과 작업 조건입니다."
                emptyMessage="아직 등록 기사가 제출한 제안이 없습니다."
                offers={externalOffers}
                request={request}
                effectiveSelectedId={effectiveSelectedId}
                selectionPending={selectMutation.isPending}
                pendingOfferId={selectMutation.isPending ? selectMutation.variables ?? null : null}
                onSelect={setSelectedOfferId}
              />
              <OfferSection
                id="internal-offer-section"
                title="플랫폼 즉시 제안"
                description="플랫폼이 제공하는 기존 자동 제안입니다."
                emptyMessage="현재 이용 가능한 플랫폼 즉시 제안이 없습니다."
                offers={internalOffers}
                request={request}
                effectiveSelectedId={effectiveSelectedId}
                selectionPending={selectMutation.isPending}
                pendingOfferId={selectMutation.isPending ? selectMutation.variables ?? null : null}
                onSelect={setSelectedOfferId}
              />
            </>
          )}
        </section>

        <aside className="min-w-0 xl:sticky xl:top-5 xl:self-start">
          <section className="overflow-hidden rounded-lg border border-commerce-line bg-white shadow-product">
            <div className="border-b border-commerce-line bg-[#de6c2d] px-5 py-4 text-white">
              <div className="flex items-center gap-2 text-sm font-black"><UserRoundCheck size={18} /> 선택 제안</div>
              <p className="mt-1 text-xs font-bold text-white/65">최종 제안가를 확인한 뒤 포인트 결제로 이동합니다.</p>
            </div>
            <div className="space-y-4 p-5">
              <SummaryRow label="조립 요청번호" value={request.requestNo} valueClassName="min-w-0 break-all text-right text-xs" />
              <SummaryRow label={request.serviceType === 'FULL_SERVICE' ? '부품 스냅샷 금액' : '부품'} value={request.serviceType === 'FULL_SERVICE' ? `${request.estimatedPartsPrice.toLocaleString()}원` : '사용자 준비'} />
              <SummaryRow label="조립 지역" value={request.region} />
              <SummaryRow label="희망 일정" value={request.preferredDate} />
              <div className="border-t border-commerce-line pt-4">
                {selectedOffer ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      {selectedOffer.providerType === 'EXTERNAL' ? <TechnicianAvatar offer={selectedOffer} compact /> : <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-commerce-ink text-white"><Wrench size={17} /></div>}
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-500">선택 제안</div>
                        <div className="mt-1 truncate text-lg font-black text-commerce-ink">{offerDisplayName(selectedOffer)}</div>
                      </div>
                    </div>
                    <SummaryRow label="배송 조건" value="작업 확정 후 별도 안내" valueClassName="text-right text-xs" />
                    <SummaryRow label="최종 결제 예정액" value={`${selectedOffer.finalPrice.toLocaleString()}원`} strong />
                  </div>
                ) : <EmptySelection />}
              </div>
              {request.status === 'OFFERED' ? (
                <button
                  type="button"
                  onClick={() => selectedOffer && selectMutation.mutate(selectedOffer.id)}
                  disabled={!selectedOffer || selectMutation.isPending}
                  className="flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-[#de6c2d] px-4 py-3 text-sm font-black text-white hover:bg-[#c75f27] disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <BadgeCheck size={17} /> {selectMutation.isPending ? '제안 선택 중...' : '선택한 제안 승인'}
                </button>
              ) : (
                <Link to={`/checkout/payment/${request.id}`} className="flex min-h-12 items-center justify-center gap-2 rounded-md bg-[#de6c2d] px-4 text-sm font-black text-white hover:bg-[#c75f27]">
                  <CreditCard size={17} /> 결제 상태 확인
                </Link>
              )}
            </div>
          </section>
        </aside>
      </div>
    </Screen>
  );
}

function OfferSortDropdown({ value, onChange }: { value: OfferSortKey; onChange: (value: OfferSortKey) => void }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedOption = OFFER_SORT_OPTIONS.find((option) => option.value === value) ?? OFFER_SORT_OPTIONS[0];

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative z-20 w-full sm:w-auto">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-11 w-full items-center justify-between gap-4 rounded-md border border-commerce-line bg-white px-3.5 text-sm font-black text-commerce-ink shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#de6c2d]/25 sm:w-52"
      >
        <span className="inline-flex items-center gap-2 text-xs text-slate-500">
          <ArrowUpDown size={14} />
          정렬
        </span>
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span className="truncate">{selectedOption.label}</span>
          <ChevronDown size={16} className={`shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label="기사 제안 정렬"
          className="absolute right-0 top-[calc(100%+8px)] w-full overflow-hidden rounded-md border border-commerce-line bg-white p-1 shadow-product sm:w-52"
        >
          {OFFER_SORT_OPTIONS.map((option) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`flex min-h-10 w-full items-center justify-between gap-3 rounded px-3 text-left text-sm font-black transition ${
                  selected ? 'bg-[#fff4ed] text-[#de6c2d]' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span>{option.label}</span>
                {selected ? <Check size={15} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function CheckoutCompletePage() {
  const { requestId } = useParams();
  const requestQuery = useQuery({ queryKey: ['assembly-request', requestId], queryFn: () => getAssemblyRequest(requestId!), enabled: Boolean(requestId) });
  if (!requestId) return <MissingAssemblyRequest />;
  if (requestQuery.isLoading) return <AssemblyLoading />;
  if (requestQuery.isError || !requestQuery.data) return <AssemblyError />;
  const request = requestQuery.data;
  const selectedOffer = selectedOfferOf(request);
  if (!selectedOffer) return <StateWrap title="선택한 기사 제안이 없습니다" body="기사 제안을 선택한 뒤 진행 상태를 확인해 주세요." action={`/checkout/offers/${request.id}`} actionLabel="기사 제안 보기" />;
  if (request.payment?.status !== 'PAID') return <StateWrap title="결제 검증이 완료되지 않았습니다" body="결제 페이지에서 결제를 완료한 뒤 다시 확인해 주세요." action={`/checkout/payment/${request.id}`} actionLabel="결제 페이지로 이동" />;

  return (
    <Screen>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <RequestProgress request={request} offer={selectedOffer} />
        <aside className="min-w-0 xl:sticky xl:top-5 xl:self-start">
          <section className="rounded-lg border border-commerce-line bg-white p-5 shadow-product">
            <h2 className="text-lg font-black text-commerce-ink">다음 행동</h2>
            <p className="mt-2 break-keep text-sm leading-6 text-slate-600">관리자가 결제와 일정을 확인하면 조립 상태가 순서대로 갱신됩니다.</p>
            <div className="mt-5 space-y-2">
              <Link to={`/my/assembly-requests/${request.id}`} className="flex min-h-11 items-center justify-center rounded-md bg-commerce-ink px-4 text-sm font-black text-white">조립 요청 상세</Link>
              <Link to="/my/assembly-requests" className="flex min-h-11 items-center justify-center rounded-md border border-commerce-line px-4 text-sm font-black text-commerce-ink">내 조립 요청</Link>
              <Link to="/self-quote" className="flex min-h-11 items-center justify-center rounded-md border border-commerce-line px-4 text-sm font-black text-commerce-ink">셀프 견적으로 돌아가기</Link>
            </div>
          </section>
        </aside>
      </div>
    </Screen>
  );
}

export function AssemblyRequestHistoryPage() {
  const requestsQuery = useQuery({
    queryKey: ['assembly-requests'],
    queryFn: () => listAssemblyRequests(),
    refetchInterval: 5000
  });
  return (
    <Screen>
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div><h1 className="text-3xl font-black text-commerce-ink">내 조립 요청</h1><p className="mt-2 text-sm font-bold text-slate-500">기사 제안, 결제와 조립 진행 상태를 다시 확인할 수 있습니다.</p></div>
        <Link to="/checkout" className="inline-flex min-h-11 items-center justify-center rounded-md bg-commerce-ink px-5 text-sm font-black text-white">새 조립 요청</Link>
      </div>
      {requestsQuery.isLoading ? <AssemblyLoading /> : requestsQuery.isError ? <AssemblyError /> : requestsQuery.data?.items.length ? (
        <div className="space-y-3">{requestsQuery.data.items.map((request) => <AssemblyHistoryCard key={request.id} request={request} />)}</div>
      ) : <StateMessage type="info" title="조립 요청 이력이 없습니다" body="셀프 견적을 완성한 뒤 기사 제안을 요청해 보세요." />}
    </Screen>
  );
}

export function AssemblyRequestDetailPage() {
  const queryClient = useQueryClient();
  const { requestId } = useParams();
  const [cancelReason, setCancelReason] = useState('');
  const requestQuery = useQuery({
    queryKey: ['assembly-request', requestId],
    queryFn: () => getAssemblyRequest(requestId!),
    enabled: Boolean(requestId),
    refetchInterval: (query) => {
      const status = (query.state.data as AssemblyRequest | undefined)?.status;
      return status === 'REQUESTED' || status === 'OFFERED' ? 5000 : false;
    }
  });
  const cancelMutation = useMutation({
    mutationFn: () => cancelAssemblyRequest(requestId!, cancelReason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assembly-request', requestId] });
      queryClient.invalidateQueries({ queryKey: ['assembly-requests'] });
    }
  });
  if (!requestId) return <MissingAssemblyRequest />;
  if (requestQuery.isLoading) return <AssemblyLoading />;
  if (requestQuery.isError || !requestQuery.data) return <AssemblyError />;
  const request = requestQuery.data;
  const offer = selectedOfferOf(request);
  const availableOffers = request.offers.filter((candidate) => candidate.status === 'AVAILABLE');

  return (
    <Screen>
      <div className="mb-4"><Link to="/my/assembly-requests" className="inline-flex items-center gap-2 text-sm font-black text-brand-blue"><ArrowLeft size={16} /> 목록으로</Link></div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          {offer ? <RequestProgress request={request} offer={offer} /> : availableOffers.length ? (
            <Panel title={request.requestNo} subtitle={STATUS_LABELS[request.status]}>
              <StateMessage type="success" title={`기사 제안 ${availableOffers.length}건 도착`} body="도착한 기사별 가격과 일정을 비교하고 원하는 제안을 선택할 수 있습니다." />
              <Link to={`/checkout/offers/${request.id}`} className="mt-4 flex min-h-12 items-center justify-center gap-2 rounded-md bg-commerce-ink px-4 text-sm font-black text-white">
                <UserRoundCheck size={17} /> 기사 제안 비교·선택
              </Link>
            </Panel>
          ) : <Panel title={request.requestNo} subtitle={STATUS_LABELS[request.status]}><StateMessage type="info" title="기사 제안 대기 중" body="조건에 맞는 기사 제안이 등록되면 이 화면에서 자동으로 알려드립니다." /></Panel>}
          <Panel title="요청 부품 snapshot" subtitle="요청 이후 가격이나 현재 견적이 바뀌어도 이 구성은 유지됩니다.">
            <div className="divide-y divide-commerce-line">{request.items.map((item) => <div key={`${item.partId}-${item.category}`} className="flex items-center justify-between gap-4 py-3 text-sm"><div><span className="font-black text-commerce-ink">{item.name}</span><span className="ml-2 font-bold text-slate-500">{item.quantity}개</span></div><span className="shrink-0 font-black">{item.lineTotal.toLocaleString()}원</span></div>)}</div>
          </Panel>
        </div>
        <aside className="space-y-4 xl:sticky xl:top-5 xl:self-start">
          <Panel title="요청 관리">
            <SummaryRow label="현재 상태" value={STATUS_LABELS[request.status]} />
            <div className="mt-3"><SummaryRow label="결제 상태" value={request.payment?.status ?? '미생성'} /></div>
            {availableOffers.length ? (
              <Link to={`/checkout/offers/${request.id}`} className="mt-4 flex min-h-11 items-center justify-center rounded-md bg-brand-blue px-4 text-sm font-black text-white">
                도착한 제안 {availableOffers.length}건 확인
              </Link>
            ) : null}
            {request.canCancel ? (
              <div className="mt-5 border-t border-commerce-line pt-4">
                <label className="text-xs font-black text-slate-600">취소 사유<input value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} maxLength={1000} className="mt-2 h-10 w-full rounded border border-commerce-line px-3 text-sm" /></label>
                <button type="button" disabled={!cancelReason.trim() || cancelMutation.isPending} onClick={() => cancelMutation.mutate()} className="mt-2 min-h-10 w-full rounded border border-red-200 bg-red-50 px-3 text-sm font-black text-red-700 disabled:opacity-50">요청 취소</button>
              </div>
            ) : null}
            {cancelMutation.isError ? <MutationError error={cancelMutation.error} /> : null}
          </Panel>
        </aside>
      </div>
    </Screen>
  );
}

type OfferSectionProps = {
  id: string;
  title: string;
  description: string;
  emptyMessage: string;
  offers: AssemblyOffer[];
  request: AssemblyRequest;
  effectiveSelectedId: string | null;
  selectionPending: boolean;
  pendingOfferId: string | null;
  onSelect: (offerId: string) => void;
};

function OfferSection({ id, title, description, emptyMessage, offers, request, effectiveSelectedId, selectionPending, pendingOfferId, onSelect }: OfferSectionProps) {
  return (
    <section data-testid={id} aria-labelledby={`${id}-title`} className="space-y-3 rounded-lg border border-commerce-line bg-slate-50/60 p-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={`${id}-title`} className="text-xl font-black text-commerce-ink">{title}</h2>
          <span className="rounded-full bg-white px-2.5 py-1 text-xs font-black text-slate-600">{offers.length}건</span>
        </div>
        <p className="mt-1 break-keep text-sm leading-6 text-slate-600">{description}</p>
      </div>
      {offers.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-300 bg-white p-4 text-sm font-bold text-slate-500">{emptyMessage}</div>
      ) : offers.map((offer) => (
        <AssemblyOfferCard
          key={offer.id}
          offer={offer}
          serviceType={request.serviceType}
          estimatedPartsPrice={request.estimatedPartsPrice}
          selected={offer.id === effectiveSelectedId}
          selectable={request.status === 'OFFERED' && offer.status === 'AVAILABLE' && !selectionPending}
          pending={selectionPending && pendingOfferId === offer.id}
          onSelect={() => onSelect(offer.id)}
        />
      ))}
    </section>
  );
}

function AssemblyOfferCard({ offer, serviceType, estimatedPartsPrice, selected, selectable, pending, onSelect }: { offer: AssemblyOffer; serviceType: AssemblyRequest['serviceType']; estimatedPartsPrice: number; selected: boolean; selectable: boolean; pending: boolean; onSelect: () => void }) {
  const specialty = offer.specialties.join(' · ');
  const external = offer.providerType === 'EXTERNAL';
  const message = offerMessage(offer);
  return (
    <article className={`rounded-lg border bg-white p-5 shadow-sm transition ${selected ? 'border-[#de6c2d] ring-2 ring-[#f8d7c4]' : offer.status === 'WITHDRAWN' || offer.status === 'EXPIRED' ? 'border-slate-200 opacity-55' : 'border-commerce-line'}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {external ? <TechnicianAvatar offer={offer} /> : <div className="grid h-14 w-14 shrink-0 place-items-center rounded-md bg-commerce-ink text-white"><Wrench size={22} /></div>}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-black text-commerce-ink">{offerDisplayName(offer)}</h3>
              <span className={`rounded px-2 py-1 text-[11px] font-black ${external ? 'bg-blue-50 text-blue-800' : 'bg-slate-100 text-commerce-ink'}`}>{external ? '등록 기사' : '플랫폼 자동 제안'}</span>
              {external && offer.verified ? <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-1 text-[11px] font-black text-emerald-800"><BadgeCheck size={12} /> 검증 완료</span> : null}
              <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-1 text-[11px] font-black text-emerald-800"><ShieldCheck size={12} /> 표준 AS 적용</span>
              <OfferStatusBadge status={offer.status} />
            </div>
            {external ? <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold text-slate-500"><span className="inline-flex items-center gap-1 text-amber-600"><Star size={13} fill="currentColor" /> {Number(offer.rating).toFixed(1)}</span><span>완료 {offer.completedJobs}건</span><span>평균 응답 {offer.responseMinutes}분</span>{specialty ? <span>{specialty}</span> : null}</div> : null}
          </div>
        </div>
        <button type="button" onClick={onSelect} disabled={!selectable} aria-pressed={selected} className={`min-h-10 shrink-0 rounded-md px-4 text-sm font-black transition ${selected ? 'bg-[#de6c2d] text-white' : 'border border-[#de6c2d] bg-white text-[#de6c2d] hover:bg-[#fff4ed] disabled:border-commerce-line disabled:text-slate-400 disabled:hover:bg-white disabled:cursor-not-allowed'}`}>{pending ? '선택 중...' : selected ? '선택됨' : external ? '이 기사 선택' : '이 제안 선택'}</button>
      </div>
      <div className="mt-5 grid gap-3 border-t border-commerce-line pt-4 sm:grid-cols-2 lg:grid-cols-5"><OfferMetric label={serviceType === 'FULL_SERVICE' ? '부품 스냅샷 금액' : '부품'} value={serviceType === 'FULL_SERVICE' ? `${estimatedPartsPrice.toLocaleString()}원` : '사용자 준비'} /><OfferMetric label="조립 공임" value={`${offer.assemblyFee.toLocaleString()}원`} /><OfferMetric label="완료 예상" value={`${offer.leadTimeDays}일`} /><OfferMetric label="보증 기간" value={warrantyLabel(offer.warrantyDays)} /><OfferMetric label="최종 결제 예정액" value={`${offer.finalPrice.toLocaleString()}원`} accent /></div>
      <div className="mt-4 rounded-md bg-slate-50 p-3">
        <div className="text-[11px] font-bold text-slate-500">제안 메시지</div>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm font-bold leading-6 text-commerce-ink [overflow-wrap:anywhere]">{message ?? '별도 제안 메시지가 없습니다.'}</p>
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs font-bold text-emerald-700"><BadgeCheck size={14} /> {offer.stockStatus}</div>
    </article>
  );
}

function TechnicianAvatar({ offer, compact = false }: { offer: Pick<AssemblyOffer, 'initials' | 'profileImageUrl' | 'technicianName'>; compact?: boolean }) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = resolveProfileImageSrc(offer.profileImageUrl);
  useEffect(() => setImageFailed(false), [imageUrl]);
  const sizeClass = compact ? 'h-10 w-10 text-xs' : 'h-14 w-14 text-sm';
  return (
    <div className={`grid ${sizeClass} shrink-0 place-items-center overflow-hidden rounded-md bg-[#de6c2d] font-black text-white`}>
      {imageUrl && !imageFailed ? (
        <img
          src={imageUrl}
          alt={`${offer.technicianName} 기사 프로필`}
          className="h-full w-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : offer.initials}
    </div>
  );
}

function RequestProgress({ request, offer }: { request: AssemblyRequest; offer: AssemblyOffer }) {
  const selectedName = offerDisplayName(offer);
  const selectedDescription = offer.providerType === 'EXTERNAL'
    ? `${selectedName} 제안이 선택된 요청입니다.`
    : '플랫폼 즉시 제안이 선택된 요청입니다.';
  return (
    <section className="overflow-hidden rounded-lg border border-emerald-200 bg-white shadow-product">
      <div className="border-b border-emerald-100 bg-emerald-50 px-5 py-5"><div className="inline-flex items-center gap-2 rounded bg-white px-3 py-1 text-xs font-black text-emerald-800"><CheckCircle2 size={15} /> {STATUS_LABELS[request.status]}</div><h1 className="mt-3 text-3xl font-black text-commerce-ink">조립 요청 진행 상태</h1><p className="mt-2 text-sm leading-6 text-emerald-950">{selectedDescription}</p></div>
      <div className="p-5">
        <div className="grid gap-3 border-b border-commerce-line pb-5 sm:grid-cols-3"><Metric label="조립 요청번호" value={request.requestNo} /><Metric label="선택 제안" value={selectedName} /><Metric label="최종 결제 예정액" value={`${offer.finalPrice.toLocaleString()}원`} accent /></div>
        <h2 className="mt-6 text-lg font-black text-commerce-ink">진행 상태</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-4"><TimelineStep icon={<CheckCircle2 size={17} />} label="요청·매칭" done={!['REQUESTED', 'OFFERED'].includes(request.status)} /><TimelineStep icon={<CreditCard size={17} />} label="포인트 결제" done={['PAID', 'REFUNDED'].includes(request.payment?.status ?? '')} /><TimelineStep icon={<Wrench size={17} />} label="조립" done={['SHIPPED', 'COMPLETED'].includes(request.status)} active={['CONFIRMED', 'ASSEMBLING'].includes(request.status)} /><TimelineStep icon={<Truck size={17} />} label="배송·완료" done={request.status === 'COMPLETED'} active={request.status === 'SHIPPED'} /></div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2"><InfoLine icon={<MapPin size={17} />} label="조립 지역" value={request.region} /><InfoLine icon={<CalendarDays size={17} />} label="희망 일정" value={request.preferredDate} /><InfoLine icon={<Clock3 size={17} />} label="예상 소요" value={`${offer.leadTimeDays}일`} /><InfoLine icon={<ShieldCheck size={17} />} label="AS 정책" value="Dazzajo 표준 AS 적용" /><InfoLine icon={<ShieldCheck size={17} />} label="보증 기간" value={warrantyLabel(offer.warrantyDays)} /></div>
      </div>
    </section>
  );
}

function AssemblyHistoryCard({ request }: { request: AssemblyRequestSummary }) {
  const hasAvailableOffer = request.status === 'OFFERED' && (request.availableOfferCount ?? 1) > 0;
  const destination = hasAvailableOffer ? `/checkout/offers/${request.id}` : `/my/assembly-requests/${request.id}`;

  return (
    <Link to={destination} className="grid gap-4 rounded-lg border border-commerce-line bg-white p-5 shadow-sm transition hover:border-brand-blue md:grid-cols-[minmax(0,1fr)_auto]">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-black text-commerce-ink">{request.requestNo}</h2>
          <StatusBadge status={request.status} />
          {request.paymentStatus ? <span className="rounded bg-slate-100 px-2 py-1 text-[11px] font-black text-commerce-ink">결제 {request.paymentStatus}</span> : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold text-slate-500">
          <span>{request.region}</span>
          <span>{request.preferredDate}</span>
          <span>{request.technicianName ?? '기사 배정 전'}</span>
          <span>부품 {request.itemCount}개</span>
        </div>
        {hasAvailableOffer ? (
          <span className="mt-3 inline-flex min-h-9 items-center rounded-md bg-blue-50 px-3 text-xs font-black text-brand-blue">
            {request.availableOfferCount == null ? '기사 제안 비교·선택' : `기사 제안 ${request.availableOfferCount}건 비교·선택`}
          </span>
        ) : null}
      </div>
      <div className="text-left md:text-right">
        <div className="text-xs font-bold text-slate-500">{request.finalPrice ? '최종 제안가' : '견적 예상가'}</div>
        <div className="mt-1 text-lg font-black text-commerce-sale">{(request.finalPrice ?? request.estimatedPartsPrice).toLocaleString()}원</div>
      </div>
    </Link>
  );
}

function selectedOfferOf(request: AssemblyRequest) { return request.offers.find((offer) => offer.id === request.selectedOfferId || offer.status === 'SELECTED') ?? null; }
function isLiveOfferStatus(status?: AssemblyRequestStatus) { return Boolean(status && LIVE_OFFER_STATUSES.has(status)); }
function sortAssemblyOffers(offers: AssemblyOffer[], sortKey: OfferSortKey) {
  return [...offers].sort((left, right) => {
    const statusResult = offerStatusRank(left) - offerStatusRank(right);
    if (statusResult !== 0) return statusResult;
    if (sortKey === 'priceAsc') {
      const priceResult = left.finalPrice - right.finalPrice;
      if (priceResult !== 0) return priceResult;
    }
    if (sortKey === 'leadTimeAsc') {
      const leadTimeResult = left.leadTimeDays - right.leadTimeDays;
      if (leadTimeResult !== 0) return leadTimeResult;
    }
    if (sortKey === 'ratingDesc') {
      const ratingResult = Number(right.rating) - Number(left.rating);
      if (ratingResult !== 0) return ratingResult;
      const completedResult = right.completedJobs - left.completedJobs;
      if (completedResult !== 0) return completedResult;
    }
    return offerCreatedTime(right) - offerCreatedTime(left) || left.id.localeCompare(right.id);
  });
}
function offerStatusRank(offer: AssemblyOffer) { return offer.status === 'SELECTED' ? 0 : offer.status === 'AVAILABLE' ? 1 : 2; }
function offerCreatedTime(offer: AssemblyOffer) {
  const time = offer.createdAt ? new Date(offer.createdAt).getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
}
function offerDisplayName(offer: AssemblyOffer) { return offer.providerType === 'EXTERNAL' ? offer.technicianName : '플랫폼 즉시 제안'; }
function offerMessage(offer: AssemblyOffer) {
  const message = offer.message ?? offer.note;
  return message?.trim() ? message.trim() : null;
}
function warrantyLabel(warrantyDays?: number | null) {
  if (warrantyDays == null) return '보증 정보 없음';
  return warrantyDays === 0 ? '보증 없음' : `${warrantyDays}일 보증`;
}
function OfferStatusBadge({ status }: { status: AssemblyOffer['status'] }) {
  const labels: Record<AssemblyOffer['status'], string> = {
    AVAILABLE: '선택 가능',
    SELECTED: '선택 완료',
    WITHDRAWN: '철회됨',
    EXPIRED: '마감됨'
  };
  const tone = status === 'SELECTED'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : status === 'AVAILABLE'
      ? 'border-blue-200 bg-blue-50 text-blue-700'
      : 'border-slate-200 bg-slate-100 text-slate-600';
  return <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-bold ${tone}`}>{labels[status]}</span>;
}
function isSelectionConflict(error: unknown) {
  return error instanceof ApiError && (error.status === 409 || error.code === 'CONFLICT_STATE');
}
function selectionErrorMessage(error: unknown) {
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
    return '제안을 선택할 권한이 없거나 로그인이 만료되었습니다.';
  }
  return '제안을 선택하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}
function EmptySelection() { return <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm font-bold text-slate-500">비교할 기사 제안을 선택하세요.</div>; }
function MissingAssemblyRequest() { return <StateWrap title="조립 요청 정보가 없습니다" body="현재 견적으로 조립 요청서를 먼저 작성해 주세요." action="/checkout" actionLabel="조립 요청서 작성" />; }
function AssemblyLoading() { return <Screen><div className="rounded-lg border border-commerce-line bg-white p-8 text-sm font-bold text-slate-500">조립 요청 정보를 불러오는 중입니다.</div></Screen>; }
function AssemblyError() { return <Screen><StateMessage type="warn" title="조립 요청 조회 실패" body="요청 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." /></Screen>; }
function StateWrap({ title, body, action, actionLabel }: { title: string; body: string; action: string; actionLabel: string }) { return <Screen><section className="rounded-lg border border-dashed border-commerce-line bg-white p-8 text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-lg bg-slate-100 text-slate-500"><Wrench size={24} /></div><h1 className="mt-4 text-2xl font-black text-commerce-ink">{title}</h1><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">{body}</p><Link to={action} className="mt-5 inline-flex min-h-11 items-center justify-center rounded-md bg-commerce-ink px-5 text-sm font-black text-white">{actionLabel}</Link></section></Screen>; }
function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) { return <div><div className="text-xs font-bold text-slate-500">{label}</div><div className={`mt-1 font-black ${accent ? 'text-commerce-sale' : 'text-commerce-ink'}`}>{value}</div></div>; }
function OfferMetric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) { return <div><div className="text-[11px] font-bold text-slate-500">{label}</div><div className={`mt-1 text-sm font-black ${accent ? 'text-commerce-sale' : 'text-commerce-ink'}`}>{value}</div></div>; }
function SummaryRow({ label, value, strong = false, valueClassName = '' }: { label: string; value: string; strong?: boolean; valueClassName?: string }) { return <div className="flex items-center justify-between gap-4 text-sm"><span className="shrink-0 font-bold text-slate-500">{label}</span><span className={`${strong ? 'text-lg font-black text-commerce-sale' : 'font-black text-commerce-ink'} ${valueClassName}`}>{value}</span></div>; }
function TimelineStep({ icon, label, done = false, active = false }: { icon: React.ReactNode; label: string; done?: boolean; active?: boolean }) {
  const style = done
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : active
      ? 'border-blue-200 bg-blue-50 text-blue-800'
      : 'border-slate-200 bg-slate-50 text-commerce-ink';

  return (
    <div className={`flex min-h-20 items-center gap-3 rounded-md border p-3 ${style}`}>
      <span>{icon}</span>
      <span className="text-sm font-black">{label}</span>
    </div>
  );
}
function InfoLine({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="flex items-center gap-3 border-b border-commerce-line py-3"><span className="text-brand-blue">{icon}</span><div><div className="text-[11px] font-bold text-slate-500">{label}</div><div className="mt-0.5 text-sm font-black text-commerce-ink">{value}</div></div></div>; }
function MutationError({ error }: { error: unknown }) { return <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700">{error instanceof Error ? error.message : '요청을 처리하지 못했습니다.'}</div>; }

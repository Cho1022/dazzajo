import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, CalendarDays, CreditCard, ShieldCheck, UserRoundCheck, Wrench } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Panel, Screen, StateMessage } from '../../../components/ui';
import { getAssemblyRequest, type AssemblyRequest } from '../../parts/assemblyApi';
import { getPointWallet } from '../paymentApi';
import type { PaymentAttemptStatus } from '../paymentTypes';
import { openTossPointPaymentWindow } from '../tossPointPaymentWindow';

const PAYMENT_ATTEMPT_LABELS: Record<PaymentAttemptStatus, string> = {
  READY: '결제 준비',
  PROCESSING: '결제 처리 중',
  VERIFYING: '서버 검증 중',
  SUCCEEDED: '결제 완료',
  FAILED: '결제 실패',
  CANCELLED: '사용자 취소',
  EXPIRED: '유효시간 만료'
};

export function CheckoutPaymentPage() {
  const { requestId } = useParams();
  const [tossPaymentError, setTossPaymentError] = useState<unknown>(null);
  const requestQuery = useQuery({
    queryKey: ['assembly-request', requestId],
    queryFn: () => getAssemblyRequest(requestId!),
    enabled: Boolean(requestId),
    refetchInterval: (query) => {
      const status = query.state.data?.payment?.latestAttempt?.status;
      return status && ['READY', 'PROCESSING', 'VERIFYING'].includes(status) ? 2_000 : false;
    }
  });
  const pointWalletQuery = useQuery({
    queryKey: ['point-wallet'],
    queryFn: getPointWallet
  });
  const tossWindowMutation = useMutation({
    mutationFn: async () => {
      const paymentRequest = requestQuery.data;
      const amount = paymentRequest?.payment?.amount;
      if (!paymentRequest || !amount) throw new Error('결제 금액을 확인할 수 없습니다.');

      await openTossPointPaymentWindow({
        amount,
        orderId: requestId!,
        orderName: paymentOrderName(paymentRequest),
        onPaymentRequestError: setTossPaymentError
      });
    }
  });

  if (!requestId) return <MissingPaymentRequest />;
  if (requestQuery.isLoading) return <PaymentLoading />;
  if (requestQuery.isError || !requestQuery.data) return <PaymentLoadError />;
  const request = requestQuery.data;
  const offer = selectedOfferOf(request);
  if (!offer || !request.payment) return <PaymentState title="결제할 기사 제안이 없습니다" body="기사 제안을 먼저 선택해 주세요." action={`/checkout/offers/${request.id}`} actionLabel="기사 제안 보기" />;

  const balance = pointWalletQuery.data?.balance ?? 0;
  const insufficientPoints = pointWalletQuery.isSuccess && balance < request.payment.amount;
  const orderName = paymentOrderName(request);

  return (
    <Screen mainClassName="mx-auto flex min-h-[calc(100vh-160px)] w-full max-w-[1550px] items-start px-4 py-6 sm:px-6 lg:items-center lg:px-8 xl:px-0">
      <div className="mx-auto max-w-4xl lg:-translate-y-20">
        <Link to={`/checkout/offers/${request.id}`} className="inline-flex items-center gap-2 text-sm font-black text-brand-blue hover:underline"><ArrowLeft size={16} /> 기사 제안으로 돌아가기</Link>
        <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Panel title="포인트 결제 정보" subtitle="토스 결제창에서 금액을 확인하고 테스트 인증을 마치면 보유 포인트로 결제합니다.">
            <div className="space-y-4">
              <InfoLine icon={<UserRoundCheck size={17} />} label="선택 제안" value={offer.providerType === 'EXTERNAL' ? offer.technicianName : '플랫폼 즉시 제안'} />
              <InfoLine icon={<CalendarDays size={17} />} label="완료 예상" value={`${offer.leadTimeDays}일`} />
              <InfoLine icon={<ShieldCheck size={17} />} label="AS 정책" value="표준 AS 적용" />
              <div className="rounded-md border border-[#f4c8b2] bg-[#fff5ef] p-4 text-sm font-bold leading-6 text-[#7a3215]">
                <div className="flex items-center justify-between gap-4">
                  <span>보유 포인트</span>
                  <strong className="text-base font-black text-[#de6c2d]">{pointWalletQuery.data ? `${balance.toLocaleString()}P` : '조회 중'}</strong>
                </div>
                <p className="mt-2 border-t border-[#f4c8b2] pt-2 text-xs leading-5 text-[#9a431d]">토스 테스트 인증 후 실제 카드·계좌 승인 API는 호출하지 않고 포인트만 차감됩니다.</p>
              </div>
              {insufficientPoints ? <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs font-black text-red-700">포인트가 {(request.payment.amount - balance).toLocaleString()}P 부족합니다.</div> : null}
            </div>
          </Panel>
          <section className="rounded-lg border border-commerce-line bg-white p-5 shadow-product">
            <div role="note" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-800">
              테스트 환경이에요. 실제로 결제되지 않아요.
            </div>
            <div className="mt-4 text-[11px] font-bold text-slate-500">상품명</div>
            <div title={orderName} className="mt-1 break-keep text-sm font-black leading-5 text-commerce-ink">{orderName}</div>
            <div className="mt-4 border-t border-commerce-line pt-4 text-sm font-black text-slate-500">최종 결제 금액</div>
            <div className="mt-2 text-3xl font-black text-[#de6c2d]">{request.payment.amount.toLocaleString()}원</div>
            <div className="mt-5 space-y-3 border-t border-commerce-line pt-4">
              <SummaryRow label={request.serviceType === 'FULL_SERVICE' ? '부품 스냅샷 금액' : '부품'} value={request.serviceType === 'FULL_SERVICE' ? `${request.estimatedPartsPrice.toLocaleString()}원` : '사용자 준비'} />
              <SummaryRow label="조립 공임" value={`${offer.assemblyFee.toLocaleString()}원`} />
            </div>
            <p className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-xs font-bold leading-5 text-slate-600">배송 조건은 작업 확정 후 별도로 안내됩니다.</p>
            {request.payment.status === 'PAID' ? (
              <Link to={`/checkout/complete/${request.id}`} className="mt-5 flex min-h-12 items-center justify-center rounded-md bg-emerald-600 px-4 text-sm font-black text-white">결제 완료 내역 보기</Link>
            ) : (
              <button
                type="button"
                disabled={tossWindowMutation.isPending || pointWalletQuery.isLoading || pointWalletQuery.isError || insufficientPoints}
                onClick={() => {
                  setTossPaymentError(null);
                  tossWindowMutation.reset();
                  tossWindowMutation.mutate();
                }}
                className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-[#de6c2d] px-4 text-sm font-black text-white hover:bg-[#c45c22] disabled:bg-slate-300 disabled:hover:bg-slate-300"
              >
                <CreditCard size={17} />
                {tossWindowMutation.isPending ? '토스 결제창 준비 중...' : '결제하기'}
              </button>
            )}
            {request.payment.latestAttempt && request.payment.latestAttempt.status !== 'SUCCEEDED' ? (
              <div className={`mt-3 rounded-md border p-3 text-xs font-bold ${['FAILED', 'CANCELLED', 'EXPIRED'].includes(request.payment.latestAttempt.status) ? 'border-red-200 bg-red-50 text-red-700' : 'border-blue-100 bg-blue-50 text-brand-blue'}`}>
                결제 상태: {PAYMENT_ATTEMPT_LABELS[request.payment.latestAttempt.status]}
                {request.payment.latestAttempt.failureMessage ? ` · ${request.payment.latestAttempt.failureMessage}` : ''}
              </div>
            ) : null}
            {tossWindowMutation.isError ? <MutationError error={tossWindowMutation.error} /> : null}
            {tossPaymentError ? <MutationError error={tossPaymentError} /> : null}
            {pointWalletQuery.isError ? <MutationError error={pointWalletQuery.error} /> : null}
          </section>
        </div>
      </div>
    </Screen>
  );
}

function paymentOrderName(request: AssemblyRequest) {
  const firstItemName = request.items[0]?.name;
  if (!firstItemName) return `PC 조립 요청 ${request.requestNo}`;

  const remainingItemCount = Math.max(request.items.length - 1, 0);
  return remainingItemCount > 0
    ? `${firstItemName} 외 ${remainingItemCount}개 부품 조립`
    : `${firstItemName} 조립`;
}

function selectedOfferOf(request: AssemblyRequest) {
  return request.offers.find((offer) => offer.id === request.selectedOfferId || offer.status === 'SELECTED') ?? null;
}

function InfoLine({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="flex items-center gap-3 border-b border-commerce-line py-3"><span className="text-[#de6c2d]">{icon}</span><div><div className="text-[11px] font-bold text-slate-500">{label}</div><div className="mt-0.5 text-sm font-black text-commerce-ink">{value}</div></div></div>;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-4 text-sm"><span className="font-bold text-slate-500">{label}</span><span className="font-black text-commerce-ink">{value}</span></div>;
}

function MutationError({ error }: { error: unknown }) {
  return <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700">{errorMessage(error)}</div>;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '요청을 처리하지 못했습니다.';
}

function MissingPaymentRequest() {
  return <PaymentState title="조립 요청 정보가 없습니다" body="현재 견적으로 조립 요청서를 먼저 작성해 주세요." action="/checkout" actionLabel="조립 요청서 작성" />;
}

function PaymentLoading() {
  return <Screen><div className="rounded-lg border border-commerce-line bg-white p-8 text-sm font-bold text-slate-500">결제 정보를 불러오는 중입니다.</div></Screen>;
}

function PaymentLoadError() {
  return <Screen><StateMessage type="warn" title="결제 정보 조회 실패" body="결제 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." /></Screen>;
}

function PaymentState({ title, body, action, actionLabel }: { title: string; body: string; action: string; actionLabel: string }) {
  return <Screen><section className="rounded-lg border border-dashed border-commerce-line bg-white p-8 text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-lg bg-slate-100 text-slate-500"><Wrench size={24} /></div><h1 className="mt-4 text-2xl font-black text-commerce-ink">{title}</h1><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">{body}</p><Link to={action} className="mt-5 inline-flex min-h-11 items-center justify-center rounded-md bg-commerce-ink px-5 text-sm font-black text-white">{actionLabel}</Link></section></Screen>;
}

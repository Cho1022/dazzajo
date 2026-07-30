import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BadgeCheck, BriefcaseBusiness, CheckCircle2, Clock3, ImagePlus, MapPin, Save, ShieldCheck, Store, Wrench, XCircle } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MutationToast } from '../../components/feedback/MutationToast';
import { Panel, Screen, StateMessage, StatusBadge } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { PROFILE_IMAGE_ACCEPT, PROFILE_IMAGE_HELP_TEXT, profileImagePayloadValue, resolveProfileImageSrc } from '../parts/profileImageFile';
import {
  applyAsTechnician,
  createTechnicianOffer,
  getTechnicianProfile,
  getTechnicianRequest,
  listTechnicianRequests,
  uploadTechnicianProfileImage,
  updateTechnicianOffer,
  updateTechnicianProfile,
  withdrawTechnicianOffer,
  type AssemblyServiceType,
  type CreateTechnicianOfferInput,
  type Technician,
  type TechnicianApplicationPayload,
  type TechnicianOwnOffer,
  type TechnicianRequest,
  type TechnicianRequestSummary
} from '../parts/assemblyApi';

const REGIONS = ['서울', '경기', '인천', '대전', '대구', '부산', '광주'];

export function TechnicianApplyPage() {
  const profileQuery = useQuery({ queryKey: ['technician-profile'], queryFn: getTechnicianProfile, retry: false });
  if (profileQuery.isLoading) return <TechnicianLoading />;
  if (profileQuery.data && profileQuery.data.verificationStatus !== 'REJECTED') {
    return <TechnicianStatusPage profile={profileQuery.data} />;
  }
  return (
    <Screen>
      <TechnicianHeader />
      <div className="mx-auto max-w-3xl">
        <Panel title={profileQuery.data ? '외부 기사 재신청' : '외부 기사로 참여'} subtitle="기본 활동 정보와 Dazzajo 표준 AS 동의를 확인합니다.">
          {profileQuery.data?.rejectionReason ? <StateMessage type="warn" title="이전 신청 보완 필요" body={profileQuery.data.rejectionReason} /> : null}
          <TechnicianProfileForm profile={profileQuery.data ?? null} mode="apply" />
        </Panel>
      </div>
    </Screen>
  );
}

export function TechnicianDashboardPage() {
  return <TechnicianRequestListPage scope="OPEN" />;
}

export function TechnicianJobsPage() {
  return <TechnicianRequestListPage scope="SELECTED" />;
}

function TechnicianRequestListPage({ scope }: { scope: 'OPEN' | 'SELECTED' }) {
  const profileQuery = useQuery({ queryKey: ['technician-profile'], queryFn: getTechnicianProfile, retry: false });
  const requestsQuery = useQuery({
    queryKey: ['technician-requests', scope],
    queryFn: () => listTechnicianRequests(scope),
    enabled: profileQuery.data?.verificationStatus === 'APPROVED' && (scope === 'SELECTED' || profileQuery.data.status === 'ACTIVE'),
    refetchInterval: scope === 'OPEN' ? 10_000 : false
  });
  if (profileQuery.isLoading) return <TechnicianLoading />;
  if (profileQuery.isError || !profileQuery.data) return <TechnicianMissingProfile />;
  if (profileQuery.data.verificationStatus !== 'APPROVED' || (scope === 'OPEN' && profileQuery.data.status !== 'ACTIVE')) {
    return <TechnicianStatusPage profile={profileQuery.data} />;
  }
  return (
    <Screen>
      <TechnicianHeader profile={profileQuery.data} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel title={scope === 'OPEN' ? '조건 매칭 요청함' : '선택된 작업'} subtitle={scope === 'OPEN' ? '지원 지역과 서비스 방식이 맞는 익명 요청만 표시합니다.' : '사용자가 내 제안을 선택한 작업입니다.'}>
          {requestsQuery.isLoading ? <TechnicianInlineLoading /> : requestsQuery.isError ? <StateMessage type="warn" title="요청함 조회 실패" body="기사 요청 정보를 불러오지 못했습니다." /> : requestsQuery.data?.items.length ? (
            <div className="space-y-3">{requestsQuery.data.items.map((request) => <TechnicianRequestCard key={request.id} request={request} />)}</div>
          ) : <StateMessage type="info" title={scope === 'OPEN' ? '입찰 가능한 요청이 없습니다' : '선택된 작업이 없습니다'} body={scope === 'OPEN' ? '새 요청이 들어오면 이 화면에 표시됩니다.' : '사용자가 제안을 선택하면 이곳에서 확인할 수 있습니다.'} />}
        </Panel>
        <aside className="xl:sticky xl:top-5 xl:self-start">
          <Panel title="기사 프로필" subtitle={profileQuery.data.businessName ?? '개인 기사'}>
            <div className="space-y-3 text-sm"><ProfileLine label="활동명" value={profileQuery.data.displayName} /><ProfileLine label="지원 지역" value={profileQuery.data.serviceRegions.join(', ')} /><ProfileLine label="기본 조립비" value={`${profileQuery.data.assemblyFee.toLocaleString()}원`} /><ProfileLine label="표준 AS" value="동의 완료" /></div>
            <details className="mt-4 border-t border-commerce-line pt-4"><summary className="cursor-pointer text-sm font-black text-brand-blue">프로필 수정</summary><TechnicianProfileForm profile={profileQuery.data} mode="update" /></details>
          </Panel>
        </aside>
      </div>
    </Screen>
  );
}

export function TechnicianRequestDetailPage() {
  const { requestId } = useParams();
  const queryClient = useQueryClient();
  const requestQueryKey = ['technician-request', requestId] as const;
  const profileQuery = useQuery({ queryKey: ['technician-profile'], queryFn: getTechnicianProfile, retry: false });
  const requestQuery = useQuery({
    queryKey: requestQueryKey,
    queryFn: () => getTechnicianRequest(requestId!),
    enabled: Boolean(requestId && profileQuery.data?.verificationStatus === 'APPROVED'),
    refetchInterval: 5000
  });
  if (profileQuery.isLoading || requestQuery.isLoading) return <TechnicianLoading />;
  if (!profileQuery.data || profileQuery.data.verificationStatus !== 'APPROVED') return profileQuery.data ? <TechnicianStatusPage profile={profileQuery.data} /> : <TechnicianMissingProfile />;
  if (requestQuery.isError || !requestQuery.data) return <Screen><TechnicianHeader profile={profileQuery.data} /><StateMessage type="warn" title="요청을 열 수 없습니다" body="조건이 맞지 않거나 이미 마감된 요청입니다." /></Screen>;
  const request = requestQuery.data;
  const refresh = async (updated?: TechnicianRequest | TechnicianOwnOffer) => {
    if (updated) {
      queryClient.setQueryData<TechnicianRequest>(requestQueryKey, (current) => {
        if (isTechnicianRequest(updated)) return updated;
        return current ? { ...current, ownOffer: updated } : current;
      });
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: requestQueryKey }),
      queryClient.invalidateQueries({ queryKey: ['technician-requests'] })
    ]);
  };
  return (
    <Screen>
      <TechnicianHeader profile={profileQuery.data} />
      <Link to={request.ownOffer?.status === 'SELECTED' ? '/technician/jobs' : '/technician'} className="mb-4 inline-flex items-center gap-2 text-sm font-black text-brand-blue"><ArrowLeft size={16} /> 요청함으로</Link>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-5">
          <Panel title={request.requestNo} subtitle="사용자 개인정보 없이 조립 조건과 부품 snapshot만 표시합니다.">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label="지역" value={request.region} /><Metric label="희망 일정" value={request.preferredDate} /><Metric label="서비스" value={request.serviceType === 'FULL_SERVICE' ? '구매+조립' : '조립만'} /><Metric label={request.serviceType === 'FULL_SERVICE' ? '부품 스냅샷 금액' : '부품'} value={request.serviceType === 'FULL_SERVICE' ? `${request.estimatedPartsPrice.toLocaleString()}원` : '사용자 준비'} /></div>
          </Panel>
          <Panel title={`부품 ${request.itemCount}개`} subtitle="이 구성을 기준으로 재고와 가격을 확인하세요.">
            <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-3">분류</th><th className="p-3">부품</th><th className="p-3">수량</th><th className="p-3 text-right">snapshot 가격</th></tr></thead><tbody>{request.items.map((item) => <tr key={item.partId} className="border-t border-slate-100"><td className="p-3 font-black">{item.category}</td><td className="p-3"><div className="font-bold text-commerce-ink">{item.name}</div><div className="text-xs text-slate-500">{item.manufacturer}</div></td><td className="p-3">{item.quantity}</td><td className="p-3 text-right font-black">{item.lineTotal.toLocaleString()}원</td></tr>)}</tbody></table></div>
          </Panel>
          {request.contact ? <Panel title="선택 작업 연락정보" subtitle="가상 결제가 완료되어 선택 기사에게만 공개된 정보입니다."><div className="grid gap-3 sm:grid-cols-2"><ProfileLine label="수령인" value={request.contact.name || '미입력'} /><ProfileLine label="연락처" value={request.contact.phone || '미입력'} /><ProfileLine label="주소" value={[request.contact.postalCode, request.contact.addressLine1, request.contact.addressLine2].filter(Boolean).join(' ') || '미입력'} /><ProfileLine label="요청사항" value={request.note || '-'} /></div></Panel> : null}
        </div>
        <aside className="xl:sticky xl:top-5 xl:self-start"><Panel title={request.ownOffer ? '내 제안' : '견적서 제출'} subtitle={request.ownOffer?.status === 'SELECTED' ? '사용자가 선택한 제안은 수정할 수 없습니다.' : '최종 결제 예정액은 서버가 계산합니다.'}><TechnicianOfferForm request={request} profile={profileQuery.data} onChanged={refresh} /></Panel></aside>
      </div>
    </Screen>
  );
}

function TechnicianProfileForm({ profile, mode }: { profile: Technician | null; mode: 'apply' | 'update' }) {
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [profileImageUrl, setProfileImageUrl] = useState(profile?.profileImageUrl ?? '');
  const [profileImageUploading, setProfileImageUploading] = useState(false);
  const [businessName, setBusinessName] = useState(profile?.businessName ?? '');
  const [contactPhone, setContactPhone] = useState(profile?.contactPhone ?? '');
  const [regions, setRegions] = useState<string[]>(profile?.serviceRegions ?? ['서울']);
  const [serviceTypes, setServiceTypes] = useState<AssemblyServiceType[]>(profile?.serviceTypes ?? ['FULL_SERVICE']);
  const [specialties, setSpecialties] = useState((profile?.specialties ?? []).join(', '));
  const [assemblyFee, setAssemblyFee] = useState(String(profile?.assemblyFee ?? 70000));
  const [deliveryFee, setDeliveryFee] = useState(String(profile?.deliveryFee ?? 10000));
  const [leadTimeDays, setLeadTimeDays] = useState(String(profile?.leadTimeDays ?? 2));
  const [asAccepted, setAsAccepted] = useState(profile?.standardAsAccepted ?? false);
  const mutation = useMutation({
    mutationFn: (payload: TechnicianApplicationPayload) => mode === 'apply' ? applyAsTechnician(payload) : updateTechnicianProfile(payload),
    onSuccess: () => { if (mode === 'update') void queryClient.invalidateQueries({ queryKey: ['technician-profile'] }); }
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate({
      displayName,
      profileImageUrl: profileImagePayloadValue(profileImageUrl),
      businessName,
      contactPhone,
      serviceRegions: regions,
      serviceTypes,
      specialties: specialties.split(',').map((item) => item.trim()).filter(Boolean),
      assemblyFee: Number(assemblyFee),
      deliveryFee: Number(deliveryFee),
      leadTimeDays: Number(leadTimeDays),
      standardAsAccepted: asAccepted
    });
  };
  if (mutation.isSuccess && mode === 'apply') return <StateMessage type="success" title="기사 신청이 접수되었습니다" body="관리자 승인 후 조건 매칭 요청함을 사용할 수 있습니다." />;
  return (
    <form onSubmit={submit} className="mt-4 space-y-4">
      <ProfileImageFileField
        displayName={displayName}
        initials={displayName.slice(0, 1) || '기'}
        value={profileImageUrl}
        onChange={setProfileImageUrl}
        onUploadingChange={setProfileImageUploading}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="기사 활동명" value={displayName} onChange={setDisplayName} required />
        <Field label="상호명 (선택)" value={businessName} onChange={setBusinessName} />
        <Field label="연락처" value={contactPhone} onChange={setContactPhone} required />
        <Field label="예상 소요일" value={leadTimeDays} onChange={setLeadTimeDays} type="number" required />
        <Field label="기본 조립비" value={assemblyFee} onChange={setAssemblyFee} type="number" required />
        <Field label="기본 배송비" value={deliveryFee} onChange={setDeliveryFee} type="number" required />
      </div>
      <CheckboxGroup label="지원 지역" values={REGIONS} selected={regions} onChange={setRegions} />
      <CheckboxGroup label="서비스 방식" values={['FULL_SERVICE', 'ASSEMBLY_ONLY']} selected={serviceTypes} onChange={(values) => setServiceTypes(values as AssemblyServiceType[])} labels={{ FULL_SERVICE: '구매+조립', ASSEMBLY_ONLY: '조립만' }} />
      <Field label="전문 분야" value={specialties} onChange={setSpecialties} placeholder="게이밍 PC, 저소음 조립" />
      <label className="flex items-start gap-3 rounded-md border border-commerce-line bg-slate-50 p-3 text-sm font-bold">
        <input type="checkbox" checked={asAccepted} onChange={(event) => setAsAccepted(event.target.checked)} className="mt-1 accent-[#de6c2d]" />
        <span>Dazzajo 표준 AS 정책에 동의합니다.</span>
      </label>
      {mutation.isError ? <StateMessage type="warn" title="저장 실패" body={mutation.error instanceof Error ? mutation.error.message : '기사 정보를 저장하지 못했습니다.'} /> : null}
      <button disabled={mutation.isPending || profileImageUploading || !asAccepted} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-[#de6c2d] px-5 text-sm font-black text-white hover:bg-[#c45c22] disabled:bg-slate-300 disabled:hover:bg-slate-300">
        <Save size={16} /> {profileImageUploading ? '이미지 업로드 중...' : mutation.isPending ? '저장 중...' : mode === 'apply' ? '기사 신청 제출' : '프로필 저장'}
      </button>
    </form>
  );
}

function ProfileImageFileField({ displayName, initials, value, onChange, onUploadingChange }: { displayName: string; initials: string; value: string; onChange: (value: string) => void; onUploadingChange: (value: boolean) => void }) {
  const [imageFailed, setImageFailed] = useState(false);
  const [error, setError] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const imageUrl = resolveProfileImageSrc(value);
  const hasImage = Boolean(value.trim());
  const setUploading = (next: boolean) => {
    setIsUploading(next);
    onUploadingChange(next);
  };
  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      setError('');
      setUploading(true);
      const uploaded = await uploadTechnicianProfileImage(file);
      setImageFailed(false);
      onChange(uploaded.profileImageUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '이미지 파일을 업로드하지 못했습니다.');
    } finally {
      setUploading(false);
      input.value = '';
    }
  };
  return (
    <div className="flex flex-col gap-3 rounded-md border border-commerce-line bg-slate-50 p-3 sm:flex-row sm:items-center">
      <ProfileImagePreview imageUrl={imageUrl} imageFailed={imageFailed} onImageFailed={() => setImageFailed(true)} initials={initials} displayName={displayName || '기사'} />
      <div className="min-w-0 flex-1">
        <label className="text-sm font-black text-commerce-ink">프로필 이미지</label>
        <input
          type="file"
          accept={PROFILE_IMAGE_ACCEPT}
          disabled={isUploading}
          onChange={handleFileChange}
          className="mt-2 block w-full text-xs font-bold text-slate-600 file:mr-3 file:h-9 file:rounded-md file:border-0 file:bg-[#de6c2d] file:px-3 file:text-xs file:font-black file:text-white hover:file:bg-[#c45c22]"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500"><ImagePlus size={13} /> {isUploading ? '이미지 업로드 중...' : PROFILE_IMAGE_HELP_TEXT}</span>
          {hasImage ? <button type="button" disabled={isUploading} onClick={() => { setImageFailed(false); setError(''); onChange(''); }} className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[11px] font-black text-slate-600 disabled:text-slate-400"><XCircle size={13} /> 이미지 제거</button> : null}
        </div>
        {error ? <p className="mt-1 text-[11px] font-black text-red-600">{error}</p> : null}
      </div>
    </div>
  );
}

function ProfileImagePreview({ imageUrl, imageFailed, onImageFailed, initials, displayName }: { imageUrl: string; imageFailed: boolean; onImageFailed: () => void; initials: string; displayName: string }) {
  return (
    <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-md bg-[#de6c2d] text-lg font-black text-white">
      {imageUrl && !imageFailed ? (
        <img src={imageUrl} alt={`${displayName} 기사 프로필 미리보기`} className="h-full w-full object-cover" onError={onImageFailed} />
      ) : initials}
    </div>
  );
}

type TechnicianOfferFormValues = {
  assemblyFee: string;
  leadTimeDays: string;
  stockStatus: string;
  warrantyDays: string;
  message: string;
};

type TechnicianOfferFormErrors = Partial<Record<keyof TechnicianOfferFormValues, string>>;

function TechnicianOfferForm({ request, profile, onChanged }: { request: TechnicianRequest; profile: Technician; onChanged: (updated?: TechnicianRequest | TechnicianOwnOffer) => Promise<void> }) {
  const offer = request.ownOffer ?? null;
  const [values, setValues] = useState<TechnicianOfferFormValues>(() => technicianOfferFormValues(request, profile));
  const [errors, setErrors] = useState<TechnicianOfferFormErrors>({});
  const [toastMessage, setToastMessage] = useState('');
  const [dirty, setDirty] = useState(false);
  const formIdentityRef = useRef(`${request.id}:${offer?.id ?? 'new'}`);
  const mutationGuard = useRef(false);
  const requestOpen = request.status === 'REQUESTED' || request.status === 'OFFERED';
  const offerAvailable = !offer || offer.status === 'AVAILABLE';
  const canMutate = requestOpen && offerAvailable;
  const formIdentity = `${request.id}:${offer?.id ?? 'new'}`;
  const offerLocked = Boolean(offer && offer.status !== 'AVAILABLE');

  useEffect(() => {
    const identityChanged = formIdentityRef.current !== formIdentity;
    if (identityChanged || !dirty || offerLocked) {
      setValues(technicianOfferFormValues(request, profile));
      setErrors({});
      if (identityChanged || offerLocked) setDirty(false);
    }
    formIdentityRef.current = formIdentity;
  }, [dirty, formIdentity, offerLocked, profile, request]);

  const handleMutationError = async (error: unknown, action: 'create' | 'update' | 'withdraw') => {
    if (isConflictError(error)) {
      setDirty(false);
      setToastMessage('다른 변경이 먼저 반영되었습니다. 최신 제안 상태를 다시 불러왔습니다.');
      await onChanged();
      return;
    }
    setToastMessage(technicianOfferErrorMessage(error, action));
  };

  const saveMutation = useMutation<TechnicianRequest | TechnicianOwnOffer, unknown, CreateTechnicianOfferInput>({
    mutationFn: (payload) => offer
      ? updateTechnicianOffer(offer.id, payload)
      : createTechnicianOffer(request.id, payload),
    onSuccess: async (updated) => {
      await onChanged(updated);
      setDirty(false);
      setErrors({});
    },
    onError: (error) => handleMutationError(error, offer ? 'update' : 'create'),
    onSettled: () => { mutationGuard.current = false; }
  });
  const withdrawMutation = useMutation<TechnicianOwnOffer, unknown, void>({
    mutationFn: () => withdrawTechnicianOffer(offer!.id, '기사 요청으로 제안 철회'),
    onSuccess: async (updated) => {
      await onChanged(updated);
      setDirty(false);
    },
    onError: (error) => handleMutationError(error, 'withdraw'),
    onSettled: () => { mutationGuard.current = false; }
  });
  const isMutating = saveMutation.isPending || withdrawMutation.isPending;
  const fieldsDisabled = !canMutate || isMutating;

  const updateValue = (key: keyof TechnicianOfferFormValues, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setDirty(true);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canMutate || mutationGuard.current) return;
    const validated = validateTechnicianOffer(values);
    setErrors(validated.errors);
    if (!validated.payload) return;
    mutationGuard.current = true;
    setToastMessage('');
    saveMutation.mutate(validated.payload);
  };
  const withdraw = () => {
    if (!offer || !canMutate || mutationGuard.current || !window.confirm('이 제안을 철회할까요?')) return;
    mutationGuard.current = true;
    setToastMessage('');
    withdrawMutation.mutate();
  };

  return (
    <form onSubmit={submit} noValidate className="mt-4 space-y-4">
      <MutationToast message={toastMessage} onClose={() => setToastMessage('')} />
      {offer ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <OfferStatusBadge status={offer.status} />
          <span className="text-xs font-black text-slate-500">서버 최종 결제 예정액 {offer.finalPrice.toLocaleString()}원</span>
        </div>
      ) : null}
      <div className="rounded-md bg-slate-50 p-3 text-xs font-bold leading-5 text-slate-600">
        {request.serviceType === 'FULL_SERVICE'
          ? `부품 스냅샷 금액은 ${request.estimatedPartsPrice.toLocaleString()}원입니다.`
          : '부품은 사용자가 준비하는 요청입니다.'}
        <span className="mt-1 block">최종 결제 예정액은 서버의 요청 유형과 부품 스냅샷을 기준으로 계산됩니다.</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <OfferField
          label="조립 공임"
          value={values.assemblyFee}
          onChange={(value) => updateValue('assemblyFee', value)}
          type="number"
          min={0}
          step={1}
          required
          disabled={fieldsDisabled}
          error={errors.assemblyFee}
          hint="원 단위로 입력합니다."
        />
        <OfferField
          label="예상 작업 기간"
          value={values.leadTimeDays}
          onChange={(value) => updateValue('leadTimeDays', value)}
          type="number"
          min={1}
          step={1}
          required
          disabled={fieldsDisabled}
          error={errors.leadTimeDays}
          hint="단위: 일"
        />
        <OfferField
          label="보증 기간"
          value={values.warrantyDays}
          onChange={(value) => updateValue('warrantyDays', value)}
          type="number"
          min={0}
          max={365}
          step={1}
          required
          disabled={fieldsDisabled}
          error={errors.warrantyDays}
          hint="0일은 보증 없음을 의미합니다."
        />
        <OfferField
          label="재고 확인 문구"
          value={values.stockStatus}
          onChange={(value) => updateValue('stockStatus', value)}
          maxLength={255}
          required
          disabled={fieldsDisabled}
          error={errors.stockStatus}
        />
      </div>
      <label className="block text-xs font-black text-slate-600">
        제안 메시지
        <textarea
          value={values.message}
          onChange={(event) => updateValue('message', event.target.value)}
          maxLength={500}
          disabled={fieldsDisabled}
          rows={6}
          className="mt-1.5 w-full resize-y rounded-md border border-commerce-line bg-white px-3 py-2 text-sm font-bold leading-6 text-commerce-ink outline-none focus:border-brand-blue disabled:bg-slate-100"
        />
        <span className="mt-1 flex items-start justify-between gap-3 text-[11px] font-bold">
          <span className={errors.message ? 'text-red-600' : 'text-slate-500'}>{errors.message ?? '사용자에게 공개되는 메시지입니다.'}</span>
          <span className="shrink-0 text-slate-500">{values.message.length}/500</span>
        </span>
      </label>
      {request.paymentStatus === 'PENDING' && offer?.status === 'SELECTED' ? <StateMessage type="info" title="사용자 결제 대기" body="결제가 완료되면 연락정보가 표시됩니다." /> : null}
      {offer?.status === 'SELECTED' ? <StateMessage type="success" title="선택된 제안" body="사용자가 선택한 제안은 수정하거나 철회할 수 없습니다." /> : null}
      {offer?.status === 'WITHDRAWN' ? <StateMessage type="info" title="철회된 제안" body="철회한 제안은 다시 등록하거나 수정할 수 없습니다." /> : null}
      {offer?.status === 'EXPIRED' ? <StateMessage type="info" title="만료된 제안" body="요청이 마감되어 제안을 수정하거나 철회할 수 없습니다." /> : null}
      {!offer && !requestOpen ? <StateMessage type="info" title="제안 접수 마감" body="현재 요청 상태에서는 새 제안을 등록할 수 없습니다." /> : null}
      {canMutate ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="submit"
            disabled={isMutating}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md bg-brand-blue px-4 text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <Save size={16} /> {saveMutation.isPending ? offer ? '제안 저장 중...' : '제안 등록 중...' : offer ? '제안 수정' : '제안 제출'}
          </button>
          {offer ? (
            <button
              type="button"
              onClick={withdraw}
              disabled={isMutating}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-red-200 px-4 text-sm font-black text-red-700 disabled:cursor-not-allowed disabled:text-slate-400"
            >
              <XCircle size={16} /> {withdrawMutation.isPending ? '철회 중...' : '철회'}
            </button>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

function technicianOfferFormValues(request: TechnicianRequest, profile: Technician): TechnicianOfferFormValues {
  const offer = request.ownOffer;
  return {
    assemblyFee: String(offer?.assemblyFee ?? profile.assemblyFee),
    leadTimeDays: String(offer?.leadTimeDays ?? profile.leadTimeDays),
    stockStatus: offer?.stockStatus ?? '주요 부품 재고 확인',
    warrantyDays: String(offer?.warrantyDays ?? 0),
    message: offer?.message ?? offer?.note ?? ''
  };
}

function validateTechnicianOffer(values: TechnicianOfferFormValues): { errors: TechnicianOfferFormErrors; payload?: CreateTechnicianOfferInput } {
  const errors: TechnicianOfferFormErrors = {};
  const assemblyFee = Number(values.assemblyFee);
  const leadTimeDays = Number(values.leadTimeDays);
  const warrantyDays = Number(values.warrantyDays);
  const stockStatus = values.stockStatus.trim();
  const message = values.message.trim();

  if (!values.assemblyFee.trim() || !Number.isSafeInteger(assemblyFee) || assemblyFee < 0) {
    errors.assemblyFee = '조립 공임은 0 이상의 정수로 입력해 주세요.';
  }
  if (!values.leadTimeDays.trim() || !Number.isSafeInteger(leadTimeDays) || leadTimeDays < 1) {
    errors.leadTimeDays = '예상 작업 기간은 1일 이상의 정수로 입력해 주세요.';
  }
  if (!values.warrantyDays.trim() || !Number.isSafeInteger(warrantyDays) || warrantyDays < 0 || warrantyDays > 365) {
    errors.warrantyDays = '보증 기간은 0~365일 범위의 정수로 입력해 주세요.';
  }
  if (!stockStatus || stockStatus.length > 255) {
    errors.stockStatus = '재고 확인 문구는 1~255자로 입력해 주세요.';
  }
  if (message.length > 500) {
    errors.message = '제안 메시지는 500자 이하로 입력해 주세요.';
  }
  if (Object.keys(errors).length > 0) return { errors };
  return {
    errors,
    payload: {
      assemblyFee,
      leadTimeDays,
      stockStatus,
      warrantyDays,
      message: message || null
    }
  };
}

function isTechnicianRequest(value: TechnicianRequest | TechnicianOwnOffer): value is TechnicianRequest {
  return 'items' in value;
}

function isConflictError(error: unknown) {
  return error instanceof ApiError && (error.status === 409 || error.code === 'CONFLICT_STATE');
}

function technicianOfferErrorMessage(error: unknown, action: 'create' | 'update' | 'withdraw') {
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
    return '제안을 관리할 권한이 없거나 로그인이 만료되었습니다.';
  }
  if (error instanceof ApiError && (error.status === 400 || error.code === 'VALIDATION_ERROR')) {
    return error.message || '입력값을 확인해 주세요.';
  }
  if (action === 'create') return '제안을 등록하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  if (action === 'update') return '제안을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  return '제안을 철회하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

function OfferStatusBadge({ status }: { status: TechnicianOwnOffer['status'] }) {
  const labels: Record<TechnicianOwnOffer['status'], string> = {
    AVAILABLE: '수정 가능',
    SELECTED: '선택 완료',
    WITHDRAWN: '철회됨',
    EXPIRED: '만료됨'
  };
  const tone = status === 'AVAILABLE'
    ? 'border-blue-200 bg-blue-50 text-blue-700'
    : status === 'SELECTED'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : 'border-slate-200 bg-slate-100 text-slate-600';
  return <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-bold ${tone}`}>{labels[status]}</span>;
}

function TechnicianRequestCard({ request }: { request: TechnicianRequestSummary }) {
  return <Link to={`/technician/requests/${request.id}`} className="grid gap-3 rounded-md border border-commerce-line bg-white p-4 transition hover:border-brand-blue sm:grid-cols-[minmax(0,1fr)_auto]"><div><div className="flex flex-wrap items-center gap-2"><span className="font-black text-commerce-ink">{request.requestNo}</span><StatusBadge status={request.ownOfferStatus ?? request.status} /></div><div className="mt-2 flex flex-wrap gap-3 text-xs font-bold text-slate-500"><span className="inline-flex items-center gap-1"><MapPin size={13} />{request.region}</span><span className="inline-flex items-center gap-1"><Clock3 size={13} />{request.preferredDate}</span><span>부품 {request.itemCount}개</span></div></div><div className="sm:text-right"><div className="text-xs font-bold text-slate-500">예상 부품가</div><div className="mt-1 font-black text-commerce-sale">{request.estimatedPartsPrice.toLocaleString()}원</div></div></Link>;
}

function TechnicianStatusPage({ profile }: { profile: Technician }) {
  const rejected = profile.verificationStatus === 'REJECTED';
  const suspended = profile.verificationStatus === 'APPROVED' && profile.status === 'SUSPENDED';
  return <Screen><TechnicianHeader profile={profile} /><div className="mx-auto max-w-2xl"><StateMessage type={rejected ? 'warn' : 'info'} title={rejected ? '기사 신청 보완이 필요합니다' : suspended ? '기사 활동이 일시 중지되었습니다' : '기사 신청 검토 중'} body={rejected ? profile.rejectionReason ?? '신청 정보를 보완해 다시 제출해 주세요.' : suspended ? '새 입찰은 중지되지만 기존에 선택된 작업은 계속 확인할 수 있습니다.' : '관리자 승인 후 조건 매칭 요청함을 사용할 수 있습니다.'} />{rejected ? <Link to="/technician/apply" className="mt-4 inline-flex min-h-11 items-center rounded-md bg-commerce-ink px-5 text-sm font-black text-white">신청 정보 보완</Link> : suspended ? <Link to="/technician/jobs" className="mt-4 inline-flex min-h-11 items-center rounded-md bg-commerce-ink px-5 text-sm font-black text-white">선택된 작업 확인</Link> : null}</div></Screen>;
}

function TechnicianHeader({ profile }: { profile?: Technician }) {
  return (
    <header className="mb-5 flex flex-col gap-3 border-b border-commerce-line pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="flex items-center gap-2 text-xs font-black text-[#de6c2d]">
          <Wrench size={15} /> 외부 파트너 기사
        </div>
        <h1 className="mt-2 text-3xl font-black text-commerce-ink">기사 포털</h1>
        <p className="mt-2 text-sm text-slate-600">조건에 맞는 조립 요청에 견적서를 제출합니다.</p>
      </div>
      <nav className="flex flex-wrap gap-2">
        <PortalLink to="/technician" icon={<Store size={15} />} label="요청함" />
        <PortalLink to="/technician/jobs" icon={<BriefcaseBusiness size={15} />} label="선택된 작업" />
        {profile ? (
          <span className="inline-flex min-h-10 items-center gap-2 rounded-md bg-emerald-50 px-3 text-xs font-black text-emerald-700">
            <BadgeCheck size={15} /> {profile.displayName}
          </span>
        ) : null}
      </nav>
    </header>
  );
}

function TechnicianMissingProfile() { return <Screen><TechnicianHeader /><div className="mx-auto max-w-2xl"><StateMessage type="info" title="기사 프로필이 없습니다" body="외부 기사 신청 후 관리자의 승인을 받아야 요청함을 사용할 수 있습니다." /><Link to="/technician/apply" className="mt-4 inline-flex min-h-11 items-center rounded-md bg-commerce-ink px-5 text-sm font-black text-white">기사로 참여</Link></div></Screen>; }
function TechnicianLoading() { return <Screen><TechnicianHeader /><TechnicianInlineLoading /></Screen>; }
function TechnicianInlineLoading() { return <div className="rounded-md border border-commerce-line bg-white p-8 text-center text-sm font-bold text-slate-500">기사 정보를 불러오는 중입니다.</div>; }
function PortalLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) { return <Link to={to} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-commerce-line bg-white px-3 text-xs font-black text-commerce-ink hover:border-brand-blue">{icon}{label}</Link>; }
function ProfileLine({ label, value }: { label: string; value: string }) { return <div className="rounded-md bg-slate-50 px-3 py-2"><div className="text-[11px] font-bold text-slate-500">{label}</div><div className="mt-1 break-words font-black text-commerce-ink">{value || '-'}</div></div>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-md border border-commerce-line bg-slate-50 p-3"><div className="text-[11px] font-bold text-slate-500">{label}</div><div className="mt-1 font-black text-commerce-ink">{value}</div></div>; }
function Field({ label, value, onChange, type = 'text', placeholder, required = false, disabled = false }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string; required?: boolean; disabled?: boolean }) { return <label className="block text-xs font-black text-slate-600">{label}<input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required={required} disabled={disabled} className="mt-1.5 h-11 w-full rounded-md border border-commerce-line bg-white px-3 text-sm font-bold text-commerce-ink outline-none focus:border-brand-blue disabled:bg-slate-100" /></label>; }
function OfferField({ label, value, onChange, type = 'text', required = false, disabled = false, min, max, step, maxLength, error, hint }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean; disabled?: boolean; min?: number; max?: number; step?: number; maxLength?: number; error?: string; hint?: string }) {
  return (
    <label className="block text-xs font-black text-slate-600">
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        disabled={disabled}
        min={min}
        max={max}
        step={step}
        maxLength={maxLength}
        aria-invalid={Boolean(error)}
        className="mt-1.5 h-11 w-full rounded-md border border-commerce-line bg-white px-3 text-sm font-bold text-commerce-ink outline-none focus:border-brand-blue disabled:bg-slate-100"
      />
      {error || hint ? <span className={`mt-1 block text-[11px] font-bold ${error ? 'text-red-600' : 'text-slate-500'}`}>{error ?? hint}</span> : null}
    </label>
  );
}
function CheckboxGroup({ label, values, selected, onChange, labels = {} }: { label: string; values: string[]; selected: string[]; onChange: (values: string[]) => void; labels?: Record<string, string> }) { return <fieldset><legend className="text-xs font-black text-slate-600">{label}</legend><div className="mt-2 flex flex-wrap gap-2">{values.map((value) => <label key={value} className={`cursor-pointer rounded-md border px-3 py-2 text-xs font-black transition ${selected.includes(value) ? 'border-[#de6c2d] bg-[#fff5ef] text-[#7a3215]' : 'border-commerce-line text-slate-600 hover:border-[#f4c8b2]'}`}><input type="checkbox" checked={selected.includes(value)} onChange={() => onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value])} className="sr-only" />{labels[value] ?? value}</label>)}</div></fieldset>; }

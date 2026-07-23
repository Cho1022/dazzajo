import { api } from '../../lib/api';
import type {
  PaymentAttempt,
  PaymentAttemptStatus,
  PaymentCheckoutMethod,
  PaymentStatus,
  PaymentSummary
} from '../payment/paymentTypes';
import { validateProfileImageFile } from './profileImageFile';

export type AssemblyServiceType = 'FULL_SERVICE' | 'ASSEMBLY_ONLY';
export type AssemblyDeliveryMethod = 'DELIVERY' | 'PICKUP';
export type AssemblyRequestStatus = 'REQUESTED' | 'OFFERED' | 'MATCHED' | 'CONFIRMED' | 'ASSEMBLING' | 'SHIPPED' | 'COMPLETED' | 'CANCELLED';
export type AssemblyOfferStatus = 'AVAILABLE' | 'SELECTED' | 'WITHDRAWN' | 'EXPIRED';
export type AssemblyPaymentStatus = PaymentStatus;
export type AssemblyPaymentAttemptStatus = PaymentAttemptStatus;
export type AssemblyCheckoutMethod = PaymentCheckoutMethod;
export type AssemblyPaymentAttempt = PaymentAttempt;

export type AssemblyRequestItem = {
  partId: string;
  category: string;
  name: string;
  manufacturer?: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  externalOffer?: {
    title?: string | null;
    imageUrl?: string | null;
    supplierName?: string | null;
    offerUrl?: string | null;
    lowPrice?: number | null;
    source?: string | null;
  } | null;
};

export type AssemblyOffer = {
  id: string;
  technicianId: string;
  technicianName: string;
  initials: string;
  profileImageUrl?: string | null;
  rating: number;
  completedJobs: number;
  responseMinutes: number;
  specialties: string[];
  standardAsAccepted: boolean;
  providerType: 'INTERNAL' | 'EXTERNAL';
  verified: boolean;
  status: AssemblyOfferStatus;
  confirmedPartsPrice: number;
  assemblyFee: number;
  deliveryFee: number;
  finalPrice: number;
  leadTimeDays: number;
  stockStatus: string;
  warrantyDays: number | null;
  message: string | null;
  note?: string | null;
  adminNote?: string | null;
  submittedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type AssemblyPayment = PaymentSummary;

export type AssemblyStatusHistory = {
  fromStatus?: string | null;
  toStatus: AssemblyRequestStatus;
  note?: string | null;
  createdAt?: string | null;
};

export type AssemblyRequest = {
  id: string;
  requestNo: string;
  status: AssemblyRequestStatus;
  serviceType: AssemblyServiceType;
  region: string;
  preferredDate: string;
  deliveryMethod: AssemblyDeliveryMethod;
  note?: string | null;
  contact?: AssemblyContact | null;
  asPolicyAccepted: boolean;
  estimatedPartsPrice: number;
  itemCount: number;
  selectedOfferId?: string | null;
  cancellationReason?: string | null;
  canCancel: boolean;
  items: AssemblyRequestItem[];
  offers: AssemblyOffer[];
  payment?: AssemblyPayment | null;
  statusHistory: AssemblyStatusHistory[];
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type AssemblyContact = {
  name?: string | null;
  phone?: string | null;
  postalCode?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
};

export type AssemblyRequestSummary = Pick<AssemblyRequest,
  'id' | 'requestNo' | 'status' | 'serviceType' | 'region' | 'preferredDate' | 'deliveryMethod' | 'estimatedPartsPrice' | 'itemCount' | 'createdAt' | 'updatedAt'
> & {
  finalPrice?: number | null;
  technicianName?: string | null;
  paymentStatus?: AssemblyPaymentStatus | null;
  availableOfferCount?: number;
  userEmail?: string | null;
  userName?: string | null;
};

export type AssemblyRequestPage = {
  items: AssemblyRequestSummary[];
  page: number;
  size: number;
  total: number;
};

export type CreateAssemblyRequestPayload = {
  serviceType: AssemblyServiceType;
  region: string;
  preferredDate: string;
  deliveryMethod: AssemblyDeliveryMethod;
  note?: string;
  asPolicyAccepted: boolean;
  contactName?: string;
  contactPhone?: string;
  postalCode?: string;
  addressLine1?: string;
  addressLine2?: string;
};

export function createAssemblyRequest(payload: CreateAssemblyRequestPayload, idempotencyKey: string) {
  return api<AssemblyRequest>('/api/assembly-requests', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(payload)
  });
}

export function listAssemblyRequests(page = 0, size = 20) {
  return api<AssemblyRequestPage>(`/api/assembly-requests?page=${page}&size=${size}`);
}

export function getAssemblyRequest(requestId: string) {
  return api<AssemblyRequest>(`/api/assembly-requests/${requestId}`);
}

export function selectAssemblyOffer(requestId: string, offerId: string) {
  return api<AssemblyRequest>(`/api/assembly-requests/${requestId}/offers/${offerId}/select`, { method: 'POST' });
}

export function cancelAssemblyRequest(requestId: string, reason: string) {
  return api<AssemblyRequest>(`/api/assembly-requests/${requestId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason })
  });
}

export type Technician = {
  id: string;
  displayName: string;
  initials: string;
  profileImageUrl?: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  providerType: 'INTERNAL' | 'EXTERNAL';
  verificationStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  businessName?: string | null;
  contactPhone?: string | null;
  rejectionReason?: string | null;
  approvedAt?: string | null;
  serviceRegions: string[];
  serviceTypes: AssemblyServiceType[];
  specialties: string[];
  rating: number;
  completedJobs: number;
  avgResponseMinutes: number;
  assemblyFee: number;
  deliveryFee: number;
  leadTimeDays: number;
  partsPriceAdjustment: number;
  sortPriority: number;
  standardAsAccepted: boolean;
  seeded: boolean;
  deletedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type TechnicianPage = { items: Technician[]; page: number; size: number; total: number };

export type ProfileImageUploadResponse = {
  profileImageUrl: string;
  fileName: string;
  fileSize: number;
  contentType: string;
};

export type TechnicianPayload = Pick<Technician,
  'displayName' | 'status' | 'serviceRegions' | 'serviceTypes' | 'specialties' | 'rating'
  | 'completedJobs' | 'avgResponseMinutes' | 'assemblyFee' | 'deliveryFee' | 'leadTimeDays'
  | 'partsPriceAdjustment' | 'sortPriority' | 'standardAsAccepted'
> & {
  initials: string;
  profileImageUrl?: string | null;
};

export function listAdminTechnicians(params: { q?: string; status?: string; region?: string; providerType?: string; verificationStatus?: string; includeDeleted?: boolean } = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') search.set(key, String(value));
  });
  return api<TechnicianPage>(`/api/admin/technicians?${search.toString()}`);
}

export function createAdminTechnician(payload: TechnicianPayload) {
  return api<Technician>('/api/admin/technicians', { method: 'POST', body: JSON.stringify(payload) });
}

export function updateAdminTechnician(id: string, payload: TechnicianPayload) {
  return api<Technician>(`/api/admin/technicians/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

export function deleteAdminTechnician(id: string) {
  return api<{ id: string; deleted: boolean }>(`/api/admin/technicians/${id}`, { method: 'DELETE' });
}

export function restoreAdminTechnician(id: string) {
  return api<Technician>(`/api/admin/technicians/${id}/restore`, { method: 'POST' });
}

export function approveAdminTechnician(id: string) {
  return api<Technician>(`/api/admin/technicians/${id}/approve`, { method: 'POST' });
}

export function rejectAdminTechnician(id: string, reason: string) {
  return api<Technician>(`/api/admin/technicians/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason })
  });
}

export function uploadTechnicianProfileImage(file: File) {
  return uploadProfileImage('/api/technician/profile-image', file);
}

export function uploadAdminTechnicianProfileImage(file: File) {
  return uploadProfileImage('/api/admin/technicians/profile-image', file);
}

function uploadProfileImage(path: string, file: File) {
  validateProfileImageFile(file);
  const body = new FormData();
  body.append('file', file);
  return api<ProfileImageUploadResponse>(path, { method: 'POST', body });
}

export type TechnicianApplicationPayload = {
  displayName: string;
  initials?: string;
  profileImageUrl?: string;
  businessName?: string;
  contactPhone: string;
  serviceRegions: string[];
  serviceTypes: AssemblyServiceType[];
  specialties: string[];
  assemblyFee: number;
  deliveryFee: number;
  leadTimeDays: number;
  standardAsAccepted: boolean;
};

export type TechnicianOwnOffer = {
  id: string;
  status: AssemblyOfferStatus;
  confirmedPartsPrice: number;
  assemblyFee: number;
  deliveryFee: number;
  finalPrice: number;
  leadTimeDays: number;
  stockStatus: string;
  note?: string | null;
  submittedAt?: string | null;
  updatedAt?: string | null;
};

export type TechnicianRequestSummary = {
  id: string;
  requestNo: string;
  status: AssemblyRequestStatus;
  serviceType: AssemblyServiceType;
  region: string;
  preferredDate: string;
  deliveryMethod: AssemblyDeliveryMethod;
  estimatedPartsPrice: number;
  itemCount: number;
  ownOfferId?: string | null;
  ownOfferStatus?: AssemblyOfferStatus | null;
  paymentStatus?: AssemblyPaymentStatus | null;
  createdAt?: string | null;
};

export type TechnicianRequest = TechnicianRequestSummary & {
  items: AssemblyRequestItem[];
  ownOffer?: TechnicianOwnOffer | null;
  contact?: AssemblyContact | null;
  note?: string | null;
};

export type TechnicianRequestPage = { items: TechnicianRequestSummary[]; page: number; size: number; total: number };

export type TechnicianOfferPayload = {
  confirmedPartsPrice: number;
  assemblyFee: number;
  deliveryFee: number;
  leadTimeDays: number;
  stockStatus: string;
  note?: string;
};

export function applyAsTechnician(payload: TechnicianApplicationPayload) {
  return api<Technician>('/api/technician/applications', { method: 'POST', body: JSON.stringify(payload) });
}

export function getTechnicianProfile() {
  return api<Technician | undefined>('/api/technician/profile').then((profile) => profile ?? null);
}

export function updateTechnicianProfile(payload: TechnicianApplicationPayload) {
  return api<Technician>('/api/technician/profile', { method: 'PATCH', body: JSON.stringify(payload) });
}

export function listTechnicianRequests(scope: 'OPEN' | 'SELECTED', page = 0, size = 20) {
  return api<TechnicianRequestPage>(`/api/technician/assembly-requests?scope=${scope}&page=${page}&size=${size}`);
}

export function getTechnicianRequest(id: string) {
  return api<TechnicianRequest>(`/api/technician/assembly-requests/${id}`);
}

export function createTechnicianOffer(requestId: string, payload: TechnicianOfferPayload) {
  return api<TechnicianRequest>(`/api/technician/assembly-requests/${requestId}/offers`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function updateTechnicianOffer(offerId: string, payload: TechnicianOfferPayload) {
  return api<TechnicianOwnOffer>(`/api/technician/offers/${offerId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

export function withdrawTechnicianOffer(offerId: string, reason: string) {
  return api<TechnicianOwnOffer>(`/api/technician/offers/${offerId}/withdraw`, {
    method: 'POST',
    body: JSON.stringify({ reason })
  });
}

export function listAdminAssemblyRequests(params: { q?: string; status?: string; region?: string; page?: number; size?: number } = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') search.set(key, String(value));
  });
  return api<AssemblyRequestPage>(`/api/admin/assembly-requests?${search.toString()}`);
}

export function getAdminAssemblyRequest(id: string) {
  return api<AssemblyRequest>(`/api/admin/assembly-requests/${id}`);
}

export function updateAdminAssemblyRequestStatus(id: string, status: AssemblyRequestStatus, note?: string) {
  return api<AssemblyRequest>(`/api/admin/assembly-requests/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, note })
  });
}

export function updateAdminAssemblyOffer(requestId: string, offerId: string, payload: Partial<Pick<AssemblyOffer, 'confirmedPartsPrice' | 'assemblyFee' | 'deliveryFee' | 'leadTimeDays' | 'stockStatus' | 'adminNote'>>) {
  return api<AssemblyRequest>(`/api/admin/assembly-requests/${requestId}/offers/${offerId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

export function createAdminAssemblyOffer(requestId: string, technicianId: string) {
  return api<AssemblyRequest>(`/api/admin/assembly-requests/${requestId}/offers`, {
    method: 'POST',
    body: JSON.stringify({ technicianId })
  });
}

export function withdrawAdminAssemblyOffer(requestId: string, offerId: string, reason: string) {
  return api<AssemblyRequest>(`/api/admin/assembly-requests/${requestId}/offers/${offerId}/withdraw`, {
    method: 'POST',
    body: JSON.stringify({ reason })
  });
}

package com.buildgraph.prototype.assembly;

import com.buildgraph.prototype.build.BuildGraphService;
import com.buildgraph.prototype.common.ApiException;
import com.buildgraph.prototype.common.DbValueMapper;
import com.buildgraph.prototype.common.MockData;
import com.buildgraph.prototype.quote.QuoteDraftQueryService;
import com.buildgraph.prototype.user.CurrentUserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AssemblyBrokerageService {
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();
    private static final int PROFILE_IMAGE_TEXT_MAX = 2_000;
    private static final Set<String> REGIONS = Set.of("서울", "경기", "인천", "대전", "대구", "부산", "광주");
    private static final Set<String> SERVICE_TYPES = Set.of("FULL_SERVICE", "ASSEMBLY_ONLY");
    private static final Set<String> DELIVERY_METHODS = Set.of("DELIVERY", "PICKUP");
    private static final Set<String> TECHNICIAN_STATUSES = Set.of("ACTIVE", "INACTIVE", "SUSPENDED");
    private static final Set<String> PROVIDER_TYPES = Set.of("INTERNAL", "EXTERNAL");
    private static final Set<String> VERIFICATION_STATUSES = Set.of("PENDING", "APPROVED", "REJECTED");
    private static final Set<String> USER_CANCEL_STATUSES = Set.of("REQUESTED", "OFFERED", "MATCHED", "CONFIRMED");
    private static final Set<String> TERMINAL_STATUSES = Set.of("COMPLETED", "CANCELLED");

    private final JdbcTemplate jdbcTemplate;
    private final CurrentUserService currentUserService;
    private final QuoteDraftQueryService quoteDraftQueryService;
    private final BuildGraphService buildGraphService;
    private final BuildGraphPointService buildGraphPointService;

    public AssemblyBrokerageService(
            JdbcTemplate jdbcTemplate,
            CurrentUserService currentUserService,
            QuoteDraftQueryService quoteDraftQueryService,
            BuildGraphService buildGraphService,
            BuildGraphPointService buildGraphPointService
    ) {
        this.jdbcTemplate = jdbcTemplate;
        this.currentUserService = currentUserService;
        this.quoteDraftQueryService = quoteDraftQueryService;
        this.buildGraphService = buildGraphService;
        this.buildGraphPointService = buildGraphPointService;
    }

    public void requireAdminForProfileImageUpload(String authorization) {
        currentUserService.requireAdmin(authorization);
    }

    @Transactional
    public Map<String, Object> create(String authorization, String idempotencyKey, Map<String, Object> request) {
        CurrentUserService.CurrentUser user = currentUserService.requireUser(authorization);
        String key = requiredText(idempotencyKey, "Idempotency-Key가 필요합니다.");
        if (key.length() > 120) {
            throw validation("Idempotency-Key는 120자 이하여야 합니다.");
        }

        String serviceType = allowed(request.get("serviceType"), SERVICE_TYPES, "지원하지 않는 서비스 방식입니다.");
        String region = allowed(request.get("region"), REGIONS, "지원하지 않는 조립 지역입니다.");
        LocalDate preferredDate = date(request.get("preferredDate"));
        if (preferredDate.isBefore(LocalDate.now())) {
            throw validation("희망 일정은 오늘 이후여야 합니다.");
        }
        String deliveryMethod = allowed(request.get("deliveryMethod"), DELIVERY_METHODS, "지원하지 않는 수령 방식입니다.");
        String note = optionalText(request.get("note"), 1000, "요청사항은 1000자 이하여야 합니다.");
        String contactName = optionalText(request.get("contactName"), 100, "수령인 이름은 100자 이하여야 합니다.");
        if (contactName == null) {
            contactName = user.name() == null || user.name().isBlank() ? user.email() : user.name();
        }
        String contactPhone = optionalText(request.get("contactPhone"), 40, "연락처는 40자 이하여야 합니다.");
        String postalCode = optionalText(request.get("postalCode"), 20, "우편번호는 20자 이하여야 합니다.");
        String addressLine1 = optionalText(request.get("addressLine1"), 255, "주소는 255자 이하여야 합니다.");
        String addressLine2 = optionalText(request.get("addressLine2"), 255, "상세 주소는 255자 이하여야 합니다.");
        if (!Boolean.TRUE.equals(request.get("asPolicyAccepted"))) {
            throw validation("Dazzajo 표준 AS 정책 동의가 필요합니다.");
        }

        Map<String, Object> quote = quoteDraftQueryService.current(authorization);
        List<Map<String, Object>> items = objectMaps(quote.get("items"));
        if (items.isEmpty()) {
            throw conflict("조립을 요청할 현재 견적이 없습니다.");
        }
        Map<String, Object> graph = buildGraphService.resolve(user, MockData.map("source", "QUOTE_DRAFT_CURRENT", "view", "FULL"));
        if (hasBlockingFail(graph)) {
            throw new ApiException(HttpStatus.CONFLICT, "CONFLICT_STATE", "장착 불가 항목이 있어 조립 요청을 만들 수 없습니다.",
                    Map.of("reason", "COMPATIBILITY_FAIL"));
        }

        String quoteSignature = sha256(toJson(items));
        String fingerprint = sha256(toJson(MockData.map(
                "quoteSignature", quoteSignature,
                "serviceType", serviceType,
                "region", region,
                "preferredDate", preferredDate.toString(),
                "deliveryMethod", deliveryMethod,
                "note", note,
                "contactName", contactName,
                "contactPhone", contactPhone,
                "postalCode", postalCode,
                "addressLine1", addressLine1,
                "addressLine2", addressLine2
        )));
        Map<String, Object> duplicate = requestByIdempotency(user.internalId(), key);
        if (duplicate != null) {
            if (!fingerprint.equals(DbValueMapper.string(duplicate, "request_fingerprint"))) {
                throw conflict("같은 Idempotency-Key로 다른 조립 요청을 만들 수 없습니다.");
            }
            return detailByInternalId(longValue(duplicate, "internal_id"));
        }

        Long quoteDraftId = internalQuoteDraftId(user.internalId(), DbValueMapper.string(quote, "id"));
        long estimatedPartsPrice = number(quote.get("totalPrice"), 0);
        int itemCount = (int) number(quote.get("itemCount"), items.size());
        String requestNo = requestNo();
        Long requestId = jdbcTemplate.queryForObject("""
                INSERT INTO assembly_requests (
                    request_no, user_id, quote_draft_id, idempotency_key, status,
                    service_type, region, preferred_date, delivery_method, note,
                    as_policy_accepted, estimated_parts_price, item_count, quote_signature,
                    request_fingerprint, compatibility_snapshot, contact_name, contact_phone,
                    postal_code, address_line1, address_line2, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'REQUESTED', ?, ?, ?, ?, ?, true, ?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?, ?, now(), now())
                RETURNING id
                """, Long.class,
                requestNo, user.internalId(), quoteDraftId, key, serviceType, region, preferredDate,
                deliveryMethod, note, estimatedPartsPrice, itemCount, quoteSignature, fingerprint, toJson(graph),
                contactName, contactPhone, postalCode, addressLine1, addressLine2);

        insertItems(requestId, items);
        addHistory(requestId, user.internalId(), null, "REQUESTED", "조립 요청 등록");
        int offerCount = createAutomaticOffers(requestId, serviceType, region, deliveryMethod, estimatedPartsPrice);
        if (offerCount > 0) {
            jdbcTemplate.update("UPDATE assembly_requests SET status = 'OFFERED', updated_at = now() WHERE id = ?", requestId);
            addHistory(requestId, null, "REQUESTED", "OFFERED", "기사 제안 자동 생성");
        }
        return detailByInternalId(requestId);
    }

    public Map<String, Object> listForUser(String authorization, Integer pageValue, Integer sizeValue) {
        CurrentUserService.CurrentUser user = currentUserService.requireUser(authorization);
        int page = page(pageValue);
        int size = size(sizeValue);
        List<Map<String, Object>> rows = jdbcTemplate.queryForList("""
                SELECT ar.id AS internal_id, ar.public_id::text AS id, ar.request_no, ar.status,
                       ar.service_type, ar.region, ar.preferred_date, ar.delivery_method,
                       ar.estimated_parts_price, ar.item_count, ar.selected_offer_id,
                       ar.created_at, ar.updated_at, ao.final_price,
                       (SELECT count(*) FROM assembly_offers available_offer
                        WHERE available_offer.assembly_request_id = ar.id
                          AND available_offer.status = 'AVAILABLE') AS available_offer_count,
                       ao.technician_snapshot, ap.status AS payment_status
                FROM assembly_requests ar
                LEFT JOIN assembly_offers ao ON ao.id = ar.selected_offer_id
                LEFT JOIN assembly_payments ap ON ap.assembly_request_id = ar.id
                WHERE ar.user_id = ?
                ORDER BY ar.created_at DESC, ar.id DESC
                LIMIT ? OFFSET ?
                """, user.internalId(), size, page * size);
        long total = jdbcTemplate.queryForObject("SELECT count(*) FROM assembly_requests WHERE user_id = ?", Long.class, user.internalId());
        return MockData.map("items", rows.stream().map(this::requestSummary).toList(), "page", page, "size", size, "total", total);
    }

    public Map<String, Object> detailForUser(String authorization, String publicId) {
        CurrentUserService.CurrentUser user = currentUserService.requireUser(authorization);
        return detailByInternalId(requireUserRequest(publicId, user.internalId()));
    }

    @Transactional
    public Map<String, Object> selectOffer(String authorization, String requestPublicId, String offerPublicId) {
        CurrentUserService.CurrentUser user = currentUserService.requireUser(authorization);
        Long requestId = requireUserRequestForUpdate(requestPublicId, user.internalId());
        Map<String, Object> request = requestRow(requestId);
        String status = DbValueMapper.string(request, "status");
        Map<String, Object> offer = offerRow(requestId, offerPublicId);
        Long offerId = longValue(offer, "internal_id");
        if ("MATCHED".equals(status) && offerId.equals(longValue(request, "selected_offer_id"))) {
            return detailByInternalId(requestId);
        }
        if (!"OFFERED".equals(status)) {
            throw conflict("기사 제안을 선택할 수 없는 요청 상태입니다.");
        }
        if (!"AVAILABLE".equals(DbValueMapper.string(offer, "status"))) {
            throw conflict("선택할 수 없는 기사 제안입니다.");
        }
        AssemblyOfferPricePolicy.PriceResult price = AssemblyOfferPricePolicy.calculate(
                DbValueMapper.string(request, "service_type"),
                longValue(request, "estimated_parts_price"),
                longValue(offer, "assembly_fee")
        );
        jdbcTemplate.update("""
                UPDATE assembly_offers
                SET confirmed_parts_price = ?, assembly_fee = ?, delivery_fee = ?, final_price = ?, updated_at = now()
                WHERE id = ?
                """, price.confirmedPartsPrice(), price.assemblyFee(), price.deliveryFee(), price.finalPrice(), offerId);
        jdbcTemplate.update("""
                INSERT INTO assembly_payments (assembly_request_id, amount, method, status, created_at, updated_at)
                VALUES (?, ?, 'VIRTUAL', 'PENDING', now(), now())
                ON CONFLICT (assembly_request_id) DO NOTHING
                """, requestId, price.finalPrice());
        jdbcTemplate.update("UPDATE assembly_offers SET status = 'SELECTED', selected_at = now(), updated_at = now() WHERE id = ?", offerId);
        jdbcTemplate.update("UPDATE assembly_offers SET status = 'EXPIRED', updated_at = now() WHERE assembly_request_id = ? AND status = 'AVAILABLE' AND id <> ?", requestId, offerId);
        jdbcTemplate.update("UPDATE assembly_requests SET status = 'MATCHED', selected_offer_id = ?, matched_at = now(), updated_at = now() WHERE id = ?", offerId, requestId);
        addHistory(requestId, user.internalId(), status, "MATCHED", "사용자 기사 제안 선택");
        return detailByInternalId(requestId);
    }

    @Transactional
    public Map<String, Object> confirmVirtualPayment(String authorization, String requestPublicId) {
        currentUserService.requireUser(authorization);
        throw new ApiException(
                HttpStatus.GONE,
                "PAYMENT_ENDPOINT_RETIRED",
                "가상 결제 즉시 완료 API는 종료되었습니다. 결제 시도 생성 API를 사용해 주세요."
        );
    }

    @Transactional
    public Map<String, Object> cancelForUser(String authorization, String requestPublicId, Map<String, Object> body) {
        CurrentUserService.CurrentUser user = currentUserService.requireUser(authorization);
        Long requestId = requireUserRequestForUpdate(requestPublicId, user.internalId());
        Map<String, Object> request = requestRow(requestId);
        String status = DbValueMapper.string(request, "status");
        if ("CANCELLED".equals(status)) {
            return detailByInternalId(requestId);
        }
        if (!USER_CANCEL_STATUSES.contains(status)) {
            throw conflict("조립이 시작된 요청은 사용자가 취소할 수 없습니다.");
        }
        // 서버 허용 범위를 UI의 canCancel 산식과 일치시킨다 — 결제(PAID) 이후에는 사용자
        // 자기취소를 막는다(취소 버튼이 없는데 API 직접 호출로 전액 포인트 환불이 되던 구멍).
        Map<String, Object> payment = paymentRow(requestId);
        if (payment != null && "PAID".equals(DbValueMapper.string(payment, "status"))) {
            throw conflict("결제가 완료된 요청은 직접 취소할 수 없습니다. 고객센터(관리자)를 통해 취소해 주세요.");
        }
        String reason = requiredLimitedText(body.get("reason"), 1000, "취소 사유가 필요합니다.");
        cancelRequest(requestId, user.internalId(), status, reason);
        return detailByInternalId(requestId);
    }

    public Map<String, Object> listTechnicians(
            String authorization,
            String query,
            String statusValue,
            String region,
            String providerTypeValue,
            String verificationStatusValue,
            Boolean includeDeletedValue,
            Integer pageValue,
            Integer sizeValue
    ) {
        currentUserService.requireAdmin(authorization);
        int page = page(pageValue);
        int size = size(sizeValue);
        boolean includeDeleted = Boolean.TRUE.equals(includeDeletedValue);
        List<Object> params = new ArrayList<>();
        StringBuilder where = new StringBuilder(" WHERE 1=1 ");
        if (!includeDeleted) where.append(" AND deleted_at IS NULL ");
        if (query != null && !query.isBlank()) {
            where.append(" AND (display_name ILIKE ? OR specialties::text ILIKE ?) ");
            params.add("%" + query.trim() + "%");
            params.add("%" + query.trim() + "%");
        }
        if (statusValue != null && !statusValue.isBlank()) {
            where.append(" AND status = ? ");
            params.add(allowed(statusValue, TECHNICIAN_STATUSES, "지원하지 않는 기사 상태입니다."));
        }
        if (region != null && !region.isBlank()) {
            where.append(" AND jsonb_exists(service_regions, ?) ");
            params.add(allowed(region, REGIONS, "지원하지 않는 조립 지역입니다."));
        }
        if (providerTypeValue != null && !providerTypeValue.isBlank()) {
            where.append(" AND provider_type = ? ");
            params.add(allowed(providerTypeValue, PROVIDER_TYPES, "지원하지 않는 기사 유형입니다."));
        }
        if (verificationStatusValue != null && !verificationStatusValue.isBlank()) {
            where.append(" AND verification_status = ? ");
            params.add(allowed(verificationStatusValue, VERIFICATION_STATUSES, "지원하지 않는 검증 상태입니다."));
        }
        Long total = jdbcTemplate.queryForObject("SELECT count(*) FROM technicians" + where, Long.class, params.toArray());
        params.add(size);
        params.add(page * size);
        List<Map<String, Object>> rows = jdbcTemplate.queryForList("SELECT * FROM technicians" + where + " ORDER BY sort_priority, created_at, id LIMIT ? OFFSET ?", params.toArray());
        return MockData.map("items", rows.stream().map(this::technicianMap).toList(), "page", page, "size", size, "total", total);
    }

    public Map<String, Object> technicianDetail(String authorization, String publicId) {
        currentUserService.requireAdmin(authorization);
        return technicianMap(requireTechnician(publicId, true));
    }

    @Transactional
    public Map<String, Object> createTechnician(String authorization, Map<String, Object> body) {
        CurrentUserService.CurrentUser admin = currentUserService.requireAdmin(authorization);
        TechnicianInput input = technicianInput(body, null);
        String publicId = jdbcTemplate.queryForObject("""
                INSERT INTO technicians (
                    display_name, initials, profile_image_url, status, service_regions, service_types,
                    specialties, rating, completed_jobs, avg_response_minutes, assembly_fee,
                    delivery_fee, lead_time_days, parts_price_adjustment, sort_priority,
                    standard_as_accepted, seeded, provider_type, verification_status,
                    approved_by_admin_id, approved_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, ?, ?, ?, ?, ?, ?, ?, ?, ?, false,
                    'INTERNAL', 'APPROVED', ?, now(), now(), now())
                RETURNING public_id::text
                """, String.class, input.displayName(), input.initials(), input.profileImageUrl(), input.status(),
                toJson(input.serviceRegions()), toJson(input.serviceTypes()), toJson(input.specialties()), input.rating(),
                input.completedJobs(), input.avgResponseMinutes(), input.assemblyFee(), input.deliveryFee(),
                input.leadTimeDays(), input.partsPriceAdjustment(), input.sortPriority(), input.standardAsAccepted(), admin.internalId());
        audit(admin, "TECHNICIAN_CREATED", "technicians", publicId, Map.of("status", input.status()));
        return technicianMap(requireTechnician(publicId, true));
    }

    @Transactional
    public Map<String, Object> updateTechnician(String authorization, String publicId, Map<String, Object> body) {
        CurrentUserService.CurrentUser admin = currentUserService.requireAdmin(authorization);
        Map<String, Object> existing = requireTechnician(publicId, true);
        TechnicianInput input = technicianInput(body, existing);
        if ("EXTERNAL".equals(DbValueMapper.string(existing, "provider_type"))
                && "ACTIVE".equals(input.status())
                && !"APPROVED".equals(DbValueMapper.string(existing, "verification_status"))) {
            throw conflict("승인된 외부 기사만 ACTIVE로 전환할 수 있습니다.");
        }
        jdbcTemplate.update("""
                UPDATE technicians SET
                    display_name = ?, initials = ?, profile_image_url = ?, status = ?,
                    service_regions = ?::jsonb, service_types = ?::jsonb, specialties = ?::jsonb,
                    rating = ?, completed_jobs = ?, avg_response_minutes = ?, assembly_fee = ?,
                    delivery_fee = ?, lead_time_days = ?, parts_price_adjustment = ?, sort_priority = ?,
                    standard_as_accepted = ?, updated_at = now()
                WHERE public_id = ?::uuid
                """, input.displayName(), input.initials(), input.profileImageUrl(), input.status(),
                toJson(input.serviceRegions()), toJson(input.serviceTypes()), toJson(input.specialties()), input.rating(),
                input.completedJobs(), input.avgResponseMinutes(), input.assemblyFee(), input.deliveryFee(),
                input.leadTimeDays(), input.partsPriceAdjustment(), input.sortPriority(), input.standardAsAccepted(), publicId);
        if ("SUSPENDED".equals(input.status()) || !input.standardAsAccepted()) {
            expireExternalOffers(longValue(existing, "id"), "기사 운영 상태 변경");
        }
        audit(admin, "TECHNICIAN_UPDATED", "technicians", publicId, Map.of("status", input.status()));
        return technicianMap(requireTechnician(publicId, true));
    }

    @Transactional
    public Map<String, Object> deleteTechnician(String authorization, String publicId) {
        CurrentUserService.CurrentUser admin = currentUserService.requireAdmin(authorization);
        requireTechnician(publicId, false);
        jdbcTemplate.update("UPDATE technicians SET deleted_at = now(), status = 'INACTIVE', updated_at = now() WHERE public_id = ?::uuid", publicId);
        expireExternalOffers(longValue(requireTechnician(publicId, true), "id"), "기사 계정 삭제");
        audit(admin, "TECHNICIAN_SOFT_DELETED", "technicians", publicId, Map.of());
        return Map.of("id", publicId, "deleted", true);
    }

    @Transactional
    public Map<String, Object> restoreTechnician(String authorization, String publicId) {
        CurrentUserService.CurrentUser admin = currentUserService.requireAdmin(authorization);
        requireTechnician(publicId, true);
        jdbcTemplate.update("UPDATE technicians SET deleted_at = NULL, status = 'INACTIVE', updated_at = now() WHERE public_id = ?::uuid", publicId);
        audit(admin, "TECHNICIAN_RESTORED", "technicians", publicId, Map.of("status", "INACTIVE"));
        return technicianMap(requireTechnician(publicId, true));
    }

    @Transactional
    public Map<String, Object> approveTechnician(String authorization, String publicId) {
        CurrentUserService.CurrentUser admin = currentUserService.requireAdmin(authorization);
        Map<String, Object> technician = requireTechnician(publicId, false);
        if (!"EXTERNAL".equals(DbValueMapper.string(technician, "provider_type"))) {
            throw conflict("외부 기사 신청만 승인할 수 있습니다.");
        }
        if (!Boolean.TRUE.equals(technician.get("standard_as_accepted"))) {
            throw conflict("표준 AS 정책에 동의한 기사만 승인할 수 있습니다.");
        }
        jdbcTemplate.update("""
                UPDATE technicians SET verification_status = 'APPROVED', status = 'ACTIVE',
                    rejection_reason = NULL, approved_by_admin_id = ?, approved_at = now(), updated_at = now()
                WHERE id = ?
                """, admin.internalId(), longValue(technician, "id"));
        audit(admin, "TECHNICIAN_APPROVED", "technicians", publicId, Map.of("providerType", "EXTERNAL"));
        return technicianMap(requireTechnician(publicId, true));
    }

    @Transactional
    public Map<String, Object> rejectTechnician(String authorization, String publicId, Map<String, Object> body) {
        CurrentUserService.CurrentUser admin = currentUserService.requireAdmin(authorization);
        Map<String, Object> technician = requireTechnician(publicId, false);
        if (!"EXTERNAL".equals(DbValueMapper.string(technician, "provider_type"))) {
            throw conflict("외부 기사 신청만 거절할 수 있습니다.");
        }
        String reason = requiredLimitedText(body.get("reason"), 1000, "거절 사유가 필요합니다.");
        jdbcTemplate.update("""
                UPDATE technicians SET verification_status = 'REJECTED', status = 'INACTIVE',
                    rejection_reason = ?, approved_by_admin_id = NULL, approved_at = NULL, updated_at = now()
                WHERE id = ?
                """, reason, longValue(technician, "id"));
        expireExternalOffers(longValue(technician, "id"), reason);
        audit(admin, "TECHNICIAN_REJECTED", "technicians", publicId, Map.of("reason", reason));
        return technicianMap(requireTechnician(publicId, true));
    }

    public Map<String, Object> listAdminRequests(String authorization, String statusValue, String region, String query, Integer pageValue, Integer sizeValue) {
        currentUserService.requireAdmin(authorization);
        int page = page(pageValue);
        int size = size(sizeValue);
        List<Object> params = new ArrayList<>();
        StringBuilder where = new StringBuilder(" WHERE 1=1 ");
        if (statusValue != null && !statusValue.isBlank()) {
            where.append(" AND ar.status = ? ");
            params.add(statusValue.trim().toUpperCase(Locale.ROOT));
        }
        if (region != null && !region.isBlank()) {
            where.append(" AND ar.region = ? ");
            params.add(allowed(region, REGIONS, "지원하지 않는 조립 지역입니다."));
        }
        if (query != null && !query.isBlank()) {
            where.append(" AND (ar.request_no ILIKE ? OR u.email ILIKE ? OR u.name ILIKE ?) ");
            String like = "%" + query.trim() + "%";
            params.add(like); params.add(like); params.add(like);
        }
        String from = " FROM assembly_requests ar JOIN users u ON u.id = ar.user_id LEFT JOIN assembly_offers ao ON ao.id = ar.selected_offer_id LEFT JOIN assembly_payments ap ON ap.assembly_request_id = ar.id ";
        Long total = jdbcTemplate.queryForObject("SELECT count(*)" + from + where, Long.class, params.toArray());
        params.add(size); params.add(page * size);
        List<Map<String, Object>> rows = jdbcTemplate.queryForList("""
                SELECT ar.id AS internal_id, ar.public_id::text AS id, ar.request_no, ar.status,
                       ar.service_type, ar.region, ar.preferred_date, ar.delivery_method,
                       ar.estimated_parts_price, ar.item_count, ar.selected_offer_id,
                       ar.created_at, ar.updated_at, ao.final_price, ao.technician_snapshot,
                       ap.status AS payment_status, u.email AS user_email, u.name AS user_name
                """ + from + where + " ORDER BY ar.created_at DESC, ar.id DESC LIMIT ? OFFSET ?", params.toArray());
        return MockData.map("items", rows.stream().map(row -> {
            Map<String, Object> mapped = new LinkedHashMap<>(requestSummary(row));
            mapped.put("userEmail", DbValueMapper.string(row, "user_email"));
            mapped.put("userName", DbValueMapper.string(row, "user_name"));
            return mapped;
        }).toList(), "page", page, "size", size, "total", total);
    }

    public Map<String, Object> adminRequestDetail(String authorization, String publicId) {
        currentUserService.requireAdmin(authorization);
        return detailByInternalId(requireRequest(publicId));
    }

    @Transactional
    public Map<String, Object> updateAdminRequestStatus(String authorization, String publicId, Map<String, Object> body) {
        CurrentUserService.CurrentUser admin = currentUserService.requireAdmin(authorization);
        Long requestId = requireRequestForUpdate(publicId);
        Map<String, Object> request = requestRow(requestId);
        String current = DbValueMapper.string(request, "status");
        String target = requiredText(body.get("status"), "상태가 필요합니다.").toUpperCase(Locale.ROOT);
        String note = optionalText(body.get("note"), 1000, "관리자 메모는 1000자 이하여야 합니다.");
        if ("CANCELLED".equals(target)) {
            if (TERMINAL_STATUSES.contains(current)) throw conflict("종료된 요청은 취소할 수 없습니다.");
            if (note == null) throw validation("관리자 취소 사유가 필요합니다.");
            cancelRequest(requestId, admin.internalId(), current, note);
        } else {
            String expected = switch (current) {
                case "MATCHED" -> "CONFIRMED";
                case "CONFIRMED" -> "ASSEMBLING";
                case "ASSEMBLING" -> "SHIPPED";
                case "SHIPPED" -> "COMPLETED";
                default -> null;
            };
            if (!target.equals(expected)) throw conflict("허용되지 않는 조립 요청 상태 전이입니다.");
            if ("CONFIRMED".equals(target)) {
                Map<String, Object> payment = paymentRow(requestId);
                if (payment == null || !"PAID".equals(DbValueMapper.string(payment, "status"))) {
                    throw conflict("가상 결제 완료 후 요청을 확정할 수 있습니다.");
                }
            }
            jdbcTemplate.update("UPDATE assembly_requests SET status = ?, completed_at = CASE WHEN ? = 'COMPLETED' THEN now() ELSE completed_at END, updated_at = now() WHERE id = ?", target, target, requestId);
            addHistory(requestId, admin.internalId(), current, target, note);
        }
        audit(admin, "ASSEMBLY_REQUEST_STATUS_CHANGED", "assembly_requests", publicId, MockData.map("before", current, "after", target, "note", note));
        return detailByInternalId(requestId);
    }

    @Transactional
    public Map<String, Object> createAdminOffer(String authorization, String requestPublicId, Map<String, Object> body) {
        CurrentUserService.CurrentUser admin = currentUserService.requireAdmin(authorization);
        Long requestId = requireRequestForUpdate(requestPublicId);
        Map<String, Object> request = requestRow(requestId);
        String requestStatus = DbValueMapper.string(request, "status");
        if (!Set.of("REQUESTED", "OFFERED").contains(requestStatus)) throw conflict("제안을 추가할 수 없는 요청 상태입니다.");
        String technicianId = requiredText(body.get("technicianId"), "technicianId가 필요합니다.");
        Map<String, Object> technician = requireTechnician(technicianId, false);
        validateTechnicianEligibleForRequest(technician, request);
        long estimated = longValue(request, "estimated_parts_price");
        insertOffer(requestId, request, technician, body, estimated);
        if ("REQUESTED".equals(requestStatus)) {
            jdbcTemplate.update("UPDATE assembly_requests SET status = 'OFFERED', updated_at = now() WHERE id = ?", requestId);
            addHistory(requestId, admin.internalId(), "REQUESTED", "OFFERED", "관리자 기사 제안 생성");
        }
        audit(admin, "ASSEMBLY_OFFER_CREATED", "assembly_requests", requestPublicId, Map.of("technicianId", technicianId));
        return detailByInternalId(requestId);
    }

    @Transactional
    public Map<String, Object> updateAdminOffer(String authorization, String requestPublicId, String offerPublicId, Map<String, Object> body) {
        CurrentUserService.CurrentUser admin = currentUserService.requireAdmin(authorization);
        Long requestId = requireRequestForUpdate(requestPublicId);
        Map<String, Object> offer = offerRow(requestId, offerPublicId);
        if (!"AVAILABLE".equals(DbValueMapper.string(offer, "status"))) throw conflict("선택 또는 철회된 제안은 수정할 수 없습니다.");
        Map<String, Object> request = requestRow(requestId);
        long assemblyFee = optionalNonnegativeLong(body.get("assemblyFee"), longValue(offer, "assembly_fee"), "조립비");
        AssemblyOfferPricePolicy.PriceResult price = AssemblyOfferPricePolicy.calculate(
                DbValueMapper.string(request, "service_type"),
                longValue(request, "estimated_parts_price"),
                assemblyFee
        );
        int leadTime = (int) optionalPositiveLong(body.get("leadTimeDays"), longValue(offer, "lead_time_days"), "예상 소요일");
        String stockStatus = body.containsKey("stockStatus") ? requiredLimitedText(body.get("stockStatus"), 255, "재고 확인 문구가 필요합니다.") : DbValueMapper.string(offer, "stock_status");
        String adminNote = body.containsKey("adminNote") ? optionalText(body.get("adminNote"), 1000, "관리자 메모는 1000자 이하여야 합니다.") : DbValueMapper.string(offer, "admin_note");
        jdbcTemplate.update("""
                UPDATE assembly_offers SET confirmed_parts_price = ?, assembly_fee = ?, delivery_fee = ?,
                    final_price = ?, lead_time_days = ?, stock_status = ?, admin_note = ?, updated_at = now()
                WHERE id = ?
                """, price.confirmedPartsPrice(), price.assemblyFee(), price.deliveryFee(), price.finalPrice(),
                leadTime, stockStatus, adminNote, longValue(offer, "internal_id"));
        addOfferActivity(longValue(offer, "internal_id"), admin.internalId(), "ADMIN_UPDATED", offerPublicId, null);
        audit(admin, "ASSEMBLY_OFFER_UPDATED", "assembly_offers", offerPublicId, Map.of("requestId", requestPublicId));
        return detailByInternalId(requestId);
    }

    @Transactional
    public Map<String, Object> withdrawAdminOffer(String authorization, String requestPublicId, String offerPublicId, Map<String, Object> body) {
        CurrentUserService.CurrentUser admin = currentUserService.requireAdmin(authorization);
        Long requestId = requireRequestForUpdate(requestPublicId);
        Map<String, Object> offer = offerRow(requestId, offerPublicId);
        if (!"AVAILABLE".equals(DbValueMapper.string(offer, "status"))) throw conflict("선택 또는 철회된 제안은 철회할 수 없습니다.");
        String reason = requiredLimitedText(body.get("reason"), 1000, "철회 사유가 필요합니다.");
        jdbcTemplate.update("UPDATE assembly_offers SET status = 'WITHDRAWN', admin_note = ?, withdrawn_at = now(), updated_at = now() WHERE id = ?", reason, longValue(offer, "internal_id"));
        addOfferActivity(longValue(offer, "internal_id"), admin.internalId(), "ADMIN_WITHDRAWN", offerPublicId, reason);
        Integer available = jdbcTemplate.queryForObject("SELECT count(*) FROM assembly_offers WHERE assembly_request_id = ? AND status = 'AVAILABLE'", Integer.class, requestId);
        if (available != null && available == 0) {
            jdbcTemplate.update("UPDATE assembly_requests SET status = 'REQUESTED', updated_at = now() WHERE id = ? AND status = 'OFFERED'", requestId);
            addHistory(requestId, admin.internalId(), "OFFERED", "REQUESTED", "모든 기사 제안 철회");
        }
        audit(admin, "ASSEMBLY_OFFER_WITHDRAWN", "assembly_offers", offerPublicId, MockData.map("requestId", requestPublicId, "reason", reason));
        return detailByInternalId(requestId);
    }

    private void insertItems(Long requestId, List<Map<String, Object>> items) {
        for (Map<String, Object> item : items) {
            String partId = DbValueMapper.string(item, "partId");
            Long partInternalId = jdbcTemplate.queryForObject("SELECT id FROM parts WHERE public_id = ?::uuid", Long.class, partId);
            int quantity = (int) number(item.get("quantity"), 1);
            long currentPrice = number(item.get("currentPrice"), 0);
            jdbcTemplate.update("""
                    INSERT INTO assembly_request_items (
                        assembly_request_id, part_id, part_public_id, category, name, manufacturer,
                        quantity, unit_price_snapshot, line_total, external_offer_snapshot, created_at
                    ) VALUES (?, ?, ?::uuid, ?, ?, ?, ?, ?, ?, ?::jsonb, now())
                    """, requestId, partInternalId, partId, DbValueMapper.string(item, "category"),
                    DbValueMapper.string(item, "name"), DbValueMapper.string(item, "manufacturer"), quantity,
                    currentPrice, currentPrice * quantity, toJson(item.get("externalOffer")));
        }
    }

    private int createAutomaticOffers(Long requestId, String serviceType, String region, String deliveryMethod, long estimatedPartsPrice) {
        List<Map<String, Object>> technicians = jdbcTemplate.queryForList("""
                SELECT * FROM technicians
                WHERE status = 'ACTIVE' AND deleted_at IS NULL AND standard_as_accepted = true
                  AND provider_type = 'INTERNAL' AND verification_status = 'APPROVED'
                  AND jsonb_exists(service_regions, ?) AND jsonb_exists(service_types, ?)
                ORDER BY sort_priority, rating DESC, avg_response_minutes, id
                LIMIT 2
                """, region, serviceType);
        Map<String, Object> request = MockData.map("service_type", serviceType, "delivery_method", deliveryMethod);
        for (Map<String, Object> technician : technicians) {
            insertOffer(requestId, request, technician, Map.of(), estimatedPartsPrice);
        }
        return technicians.size();
    }

    private void insertOffer(Long requestId, Map<String, Object> request, Map<String, Object> technician, Map<String, Object> overrides, long estimatedPartsPrice) {
        String serviceType = DbValueMapper.string(request, "service_type");
        long assemblyFee = optionalNonnegativeLong(overrides.get("assemblyFee"), longValue(technician, "assembly_fee"), "조립비");
        AssemblyOfferPricePolicy.PriceResult price = AssemblyOfferPricePolicy.calculate(
                serviceType,
                estimatedPartsPrice,
                assemblyFee
        );
        int leadTime = (int) optionalPositiveLong(overrides.get("leadTimeDays"), longValue(technician, "lead_time_days"), "예상 소요일");
        String stockStatus = overrides.get("stockStatus") == null
                ? ("FULL_SERVICE".equals(serviceType) ? "주요 부품 재고 확인" : "보유 부품 검수 후 조립")
                : requiredLimitedText(overrides.get("stockStatus"), 255, "재고 확인 문구가 필요합니다.");
        String note = optionalText(overrides.get("adminNote"), 1000, "관리자 메모는 1000자 이하여야 합니다.");
        jdbcTemplate.update("""
                INSERT INTO assembly_offers (
                    assembly_request_id, technician_id, status, technician_snapshot,
                    confirmed_parts_price, assembly_fee, delivery_fee, final_price,
                    lead_time_days, stock_status, admin_note, created_at, updated_at
                ) VALUES (?, ?, 'AVAILABLE', ?::jsonb, ?, ?, ?, ?, ?, ?, ?, now(), now())
                """, requestId, longValue(technician, "id"), toJson(technicianSnapshot(technician)),
                price.confirmedPartsPrice(), price.assemblyFee(), price.deliveryFee(), price.finalPrice(),
                leadTime, stockStatus, note);
    }

    private Map<String, Object> detailByInternalId(Long requestId) {
        Map<String, Object> row = requestRow(requestId);
        Map<String, Object> payment = paymentRow(requestId);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", DbValueMapper.string(row, "public_id_text"));
        result.put("requestNo", DbValueMapper.string(row, "request_no"));
        result.put("status", DbValueMapper.string(row, "status"));
        result.put("serviceType", DbValueMapper.string(row, "service_type"));
        result.put("region", DbValueMapper.string(row, "region"));
        result.put("preferredDate", DbValueMapper.string(row, "preferred_date"));
        result.put("deliveryMethod", DbValueMapper.string(row, "delivery_method"));
        result.put("note", DbValueMapper.string(row, "note"));
        result.put("contact", MockData.map(
                "name", DbValueMapper.string(row, "contact_name"),
                "phone", DbValueMapper.string(row, "contact_phone"),
                "postalCode", DbValueMapper.string(row, "postal_code"),
                "addressLine1", DbValueMapper.string(row, "address_line1"),
                "addressLine2", DbValueMapper.string(row, "address_line2")
        ));
        result.put("asPolicyAccepted", row.get("as_policy_accepted"));
        result.put("estimatedPartsPrice", longValue(row, "estimated_parts_price"));
        result.put("itemCount", DbValueMapper.integer(row, "item_count"));
        result.put("selectedOfferId", DbValueMapper.string(row, "selected_offer_public_id"));
        result.put("cancellationReason", DbValueMapper.string(row, "cancellation_reason"));
        result.put("createdAt", DbValueMapper.timestamp(row, "created_at"));
        result.put("updatedAt", DbValueMapper.timestamp(row, "updated_at"));
        result.put("canCancel", USER_CANCEL_STATUSES.contains(DbValueMapper.string(row, "status"))
                && (payment == null || !"PAID".equals(DbValueMapper.string(payment, "status"))));
        result.put("items", requestItems(requestId));
        result.put("offers", requestOffers(requestId));
        result.put("payment", paymentMap(payment));
        result.put("statusHistory", requestHistory(requestId));
        return result;
    }

    private Map<String, Object> requestSummary(Map<String, Object> row) {
        Map<String, Object> tech = objectMap(DbValueMapper.json(row, "technician_snapshot", Map.of()));
        return MockData.map(
                "id", DbValueMapper.string(row, "id"),
                "requestNo", DbValueMapper.string(row, "request_no"),
                "status", DbValueMapper.string(row, "status"),
                "serviceType", DbValueMapper.string(row, "service_type"),
                "region", DbValueMapper.string(row, "region"),
                "preferredDate", DbValueMapper.string(row, "preferred_date"),
                "deliveryMethod", DbValueMapper.string(row, "delivery_method"),
                "estimatedPartsPrice", longValue(row, "estimated_parts_price"),
                "itemCount", DbValueMapper.integer(row, "item_count"),
                "availableOfferCount", DbValueMapper.integer(row, "available_offer_count"),
                "finalPrice", nullableLong(row.get("final_price")),
                "technicianName", text(tech.get("displayName")),
                "paymentStatus", DbValueMapper.string(row, "payment_status"),
                "createdAt", DbValueMapper.timestamp(row, "created_at"),
                "updatedAt", DbValueMapper.timestamp(row, "updated_at")
        );
    }

    private List<Map<String, Object>> requestItems(Long requestId) {
        return jdbcTemplate.queryForList("""
                SELECT part_public_id::text AS part_id, category, name, manufacturer, quantity,
                       unit_price_snapshot, line_total, external_offer_snapshot
                FROM assembly_request_items WHERE assembly_request_id = ? ORDER BY id
                """, requestId).stream().map(row -> MockData.map(
                "partId", DbValueMapper.string(row, "part_id"),
                "category", DbValueMapper.string(row, "category"),
                "name", DbValueMapper.string(row, "name"),
                "manufacturer", DbValueMapper.string(row, "manufacturer"),
                "quantity", DbValueMapper.integer(row, "quantity"),
                "unitPrice", longValue(row, "unit_price_snapshot"),
                "lineTotal", longValue(row, "line_total"),
                "externalOffer", DbValueMapper.json(row, "external_offer_snapshot", Map.of())
        )).toList();
    }

    private List<Map<String, Object>> requestOffers(Long requestId) {
        List<Map<String, Object>> rows = jdbcTemplate.queryForList("""
                SELECT ao.id AS internal_id, ao.public_id::text AS id, ao.technician_id,
                       t.public_id::text AS technician_public_id, t.profile_image_url AS technician_profile_image_url,
                       ao.status, ao.technician_snapshot,
                       ao.confirmed_parts_price, ao.assembly_fee, ao.delivery_fee, ao.final_price,
                       ao.lead_time_days, ao.stock_status, ao.warranty_days, ao.proposal_message,
                       ao.admin_note, ao.submitted_at,
                       t.provider_type, t.verification_status, ao.created_at, ao.updated_at
                FROM assembly_offers ao JOIN technicians t ON t.id = ao.technician_id
                WHERE ao.assembly_request_id = ?
                ORDER BY CASE ao.status WHEN 'SELECTED' THEN 0 WHEN 'AVAILABLE' THEN 1 ELSE 2 END, ao.created_at, ao.id
                """, requestId);
        return rows.stream().map(this::offerMap).toList();
    }

    private Map<String, Object> offerMap(Map<String, Object> row) {
        Map<String, Object> snapshot = objectMap(DbValueMapper.json(row, "technician_snapshot", Map.of()));
        return MockData.map(
                "id", DbValueMapper.string(row, "id"),
                "technicianId", DbValueMapper.string(row, "technician_public_id"),
                "technicianName", text(snapshot.get("displayName")),
                "initials", text(snapshot.get("initials")),
                "profileImageUrl", text(snapshot.get("profileImageUrl") == null
                        ? DbValueMapper.string(row, "technician_profile_image_url")
                        : snapshot.get("profileImageUrl")),
                "rating", snapshot.get("rating"),
                "completedJobs", snapshot.get("completedJobs"),
                "responseMinutes", snapshot.get("avgResponseMinutes"),
                "specialties", snapshot.getOrDefault("specialties", List.of()),
                "standardAsAccepted", snapshot.getOrDefault("standardAsAccepted", true),
                "providerType", snapshot.getOrDefault("providerType", DbValueMapper.string(row, "provider_type")),
                "verified", "APPROVED".equals(snapshot.getOrDefault("verificationStatus", DbValueMapper.string(row, "verification_status"))),
                "status", DbValueMapper.string(row, "status"),
                "confirmedPartsPrice", longValue(row, "confirmed_parts_price"),
                "assemblyFee", longValue(row, "assembly_fee"),
                "deliveryFee", longValue(row, "delivery_fee"),
                "finalPrice", longValue(row, "final_price"),
                "leadTimeDays", DbValueMapper.integer(row, "lead_time_days"),
                "stockStatus", DbValueMapper.string(row, "stock_status"),
                "warrantyDays", warrantyDays(row),
                "message", DbValueMapper.string(row, "proposal_message"),
                "adminNote", DbValueMapper.string(row, "admin_note"),
                "submittedAt", DbValueMapper.timestamp(row, "submitted_at"),
                "createdAt", DbValueMapper.timestamp(row, "created_at"),
                "updatedAt", DbValueMapper.timestamp(row, "updated_at")
        );
    }

    private Map<String, Object> paymentMap(Map<String, Object> row) {
        if (row == null) return null;
        return MockData.map(
                "id", DbValueMapper.string(row, "id"),
                "amount", longValue(row, "amount"),
                "paidAmount", longValue(row, "paid_amount"),
                "currency", DbValueMapper.string(row, "currency"),
                "provider", DbValueMapper.string(row, "provider"),
                "method", DbValueMapper.string(row, "method"),
                "status", DbValueMapper.string(row, "status"),
                "paidAt", DbValueMapper.timestamp(row, "paid_at"),
                "verifiedAt", DbValueMapper.timestamp(row, "verified_at"),
                "refundedAt", DbValueMapper.timestamp(row, "refunded_at"),
                "latestAttempt", latestPaymentAttempt(longValue(row, "internal_id")),
                "updatedAt", DbValueMapper.timestamp(row, "updated_at")
        );
    }

    private Map<String, Object> latestPaymentAttempt(Long paymentId) {
        if (paymentId == null) return null;
        Map<String, Object> row = jdbcTemplate.queryForList("""
                SELECT public_id::text AS id, provider, merchant_payment_id, provider_transaction_id,
                       pg_transaction_id, pay_method, easy_pay_provider, requested_amount, approved_amount,
                       currency, status, failure_code, failure_message, expires_at, verified_at,
                       completed_at, created_at, updated_at
                FROM assembly_payment_attempts
                WHERE assembly_payment_id = ?
                ORDER BY created_at DESC, id DESC
                LIMIT 1
                """, paymentId).stream().findFirst().orElse(null);
        if (row == null) return null;
        return MockData.map(
                "id", DbValueMapper.string(row, "id"),
                "provider", DbValueMapper.string(row, "provider"),
                "merchantPaymentId", DbValueMapper.string(row, "merchant_payment_id"),
                "providerTransactionId", DbValueMapper.string(row, "provider_transaction_id"),
                "pgTransactionId", DbValueMapper.string(row, "pg_transaction_id"),
                "payMethod", DbValueMapper.string(row, "pay_method"),
                "easyPayProvider", DbValueMapper.string(row, "easy_pay_provider"),
                "requestedAmount", longValue(row, "requested_amount"),
                "approvedAmount", longValue(row, "approved_amount"),
                "currency", DbValueMapper.string(row, "currency"),
                "status", DbValueMapper.string(row, "status"),
                "failureCode", DbValueMapper.string(row, "failure_code"),
                "failureMessage", DbValueMapper.string(row, "failure_message"),
                "expiresAt", DbValueMapper.timestamp(row, "expires_at"),
                "verifiedAt", DbValueMapper.timestamp(row, "verified_at"),
                "completedAt", DbValueMapper.timestamp(row, "completed_at"),
                "createdAt", DbValueMapper.timestamp(row, "created_at"),
                "updatedAt", DbValueMapper.timestamp(row, "updated_at")
        );
    }

    private List<Map<String, Object>> requestHistory(Long requestId) {
        return jdbcTemplate.queryForList("""
                SELECT from_status, to_status, note, created_at
                FROM assembly_request_status_history
                WHERE assembly_request_id = ? ORDER BY created_at, id
                """, requestId).stream().map(row -> MockData.map(
                "fromStatus", DbValueMapper.string(row, "from_status"),
                "toStatus", DbValueMapper.string(row, "to_status"),
                "note", DbValueMapper.string(row, "note"),
                "createdAt", DbValueMapper.timestamp(row, "created_at")
        )).toList();
    }

    private Map<String, Object> technicianMap(Map<String, Object> row) {
        return MockData.map(
                "id", DbValueMapper.string(row, "public_id"),
                "displayName", DbValueMapper.string(row, "display_name"),
                "initials", DbValueMapper.string(row, "initials"),
                "profileImageUrl", DbValueMapper.string(row, "profile_image_url"),
                "status", DbValueMapper.string(row, "status"),
                "providerType", DbValueMapper.string(row, "provider_type"),
                "verificationStatus", DbValueMapper.string(row, "verification_status"),
                "businessName", DbValueMapper.string(row, "business_name"),
                "contactPhone", DbValueMapper.string(row, "contact_phone"),
                "rejectionReason", DbValueMapper.string(row, "rejection_reason"),
                "approvedAt", DbValueMapper.timestamp(row, "approved_at"),
                "serviceRegions", DbValueMapper.json(row, "service_regions", List.of()),
                "serviceTypes", DbValueMapper.json(row, "service_types", List.of()),
                "specialties", DbValueMapper.json(row, "specialties", List.of()),
                "rating", row.get("rating") == null ? 0 : Double.valueOf(row.get("rating").toString()),
                "completedJobs", DbValueMapper.integer(row, "completed_jobs"),
                "avgResponseMinutes", DbValueMapper.integer(row, "avg_response_minutes"),
                "assemblyFee", longValue(row, "assembly_fee"),
                "deliveryFee", longValue(row, "delivery_fee"),
                "leadTimeDays", DbValueMapper.integer(row, "lead_time_days"),
                "partsPriceAdjustment", longValue(row, "parts_price_adjustment"),
                "sortPriority", DbValueMapper.integer(row, "sort_priority"),
                "standardAsAccepted", row.get("standard_as_accepted"),
                "seeded", row.get("seeded"),
                "deletedAt", DbValueMapper.timestamp(row, "deleted_at"),
                "createdAt", DbValueMapper.timestamp(row, "created_at"),
                "updatedAt", DbValueMapper.timestamp(row, "updated_at")
        );
    }

    private Map<String, Object> technicianSnapshot(Map<String, Object> row) {
        return MockData.map(
                "displayName", DbValueMapper.string(row, "display_name"),
                "initials", DbValueMapper.string(row, "initials"),
                "profileImageUrl", DbValueMapper.string(row, "profile_image_url"),
                "rating", row.get("rating") == null ? 0 : Double.valueOf(row.get("rating").toString()),
                "completedJobs", DbValueMapper.integer(row, "completed_jobs"),
                "avgResponseMinutes", DbValueMapper.integer(row, "avg_response_minutes"),
                "specialties", DbValueMapper.json(row, "specialties", List.of()),
                "standardAsAccepted", row.get("standard_as_accepted"),
                "providerType", DbValueMapper.string(row, "provider_type"),
                "verificationStatus", DbValueMapper.string(row, "verification_status")
        );
    }

    private Map<String, Object> requestRow(Long requestId) {
        return jdbcTemplate.queryForList("""
                SELECT ar.*, ar.public_id::text AS public_id_text, ao.public_id::text AS selected_offer_public_id
                FROM assembly_requests ar LEFT JOIN assembly_offers ao ON ao.id = ar.selected_offer_id
                WHERE ar.id = ?
                """, requestId).stream().findFirst().orElseThrow(this::notFound);
    }

    private Map<String, Object> paymentRow(Long requestId) {
        return jdbcTemplate.queryForList("""
                SELECT id AS internal_id, public_id::text AS id, amount, paid_amount, currency,
                       provider, method, status, paid_at, verified_at, refunded_at, updated_at
                FROM assembly_payments WHERE assembly_request_id = ?
                """, requestId).stream().findFirst().orElse(null);
    }

    private Map<String, Object> offerRow(Long requestId, String offerPublicId) {
        return jdbcTemplate.queryForList("SELECT *, id AS internal_id FROM assembly_offers WHERE assembly_request_id = ? AND public_id = ?::uuid", requestId, offerPublicId)
                .stream().findFirst().orElseThrow(this::notFound);
    }

    private Map<String, Object> requestByIdempotency(Long userId, String key) {
        return jdbcTemplate.queryForList("SELECT id AS internal_id, request_fingerprint FROM assembly_requests WHERE user_id = ? AND idempotency_key = ?", userId, key)
                .stream().findFirst().orElse(null);
    }

    private Long requireUserRequest(String publicId, Long userId) {
        return jdbcTemplate.queryForList("SELECT id FROM assembly_requests WHERE public_id = ?::uuid AND user_id = ?", publicId, userId)
                .stream().findFirst().map(row -> longValue(row, "id")).orElseThrow(this::notFound);
    }

    private Long requireUserRequestForUpdate(String publicId, Long userId) {
        return jdbcTemplate.queryForList("SELECT id FROM assembly_requests WHERE public_id = ?::uuid AND user_id = ? FOR UPDATE", publicId, userId)
                .stream().findFirst().map(row -> longValue(row, "id")).orElseThrow(this::notFound);
    }

    private Long requireRequest(String publicId) {
        return jdbcTemplate.queryForList("SELECT id FROM assembly_requests WHERE public_id = ?::uuid", publicId)
                .stream().findFirst().map(row -> longValue(row, "id")).orElseThrow(this::notFound);
    }

    private Long requireRequestForUpdate(String publicId) {
        return jdbcTemplate.queryForList("SELECT id FROM assembly_requests WHERE public_id = ?::uuid FOR UPDATE", publicId)
                .stream().findFirst().map(row -> longValue(row, "id")).orElseThrow(this::notFound);
    }

    private Map<String, Object> requireTechnician(String publicId, boolean includeDeleted) {
        String sql = "SELECT *, public_id::text AS public_id FROM technicians WHERE public_id = ?::uuid" + (includeDeleted ? "" : " AND deleted_at IS NULL");
        return jdbcTemplate.queryForList(sql, publicId).stream().findFirst().orElseThrow(this::notFound);
    }

    private Long internalQuoteDraftId(Long userId, String publicId) {
        if (publicId == null) return null;
        return jdbcTemplate.queryForList("SELECT id FROM quote_drafts WHERE public_id = ?::uuid AND user_id = ?", publicId, userId)
                .stream().findFirst().map(row -> longValue(row, "id")).orElse(null);
    }

    private void cancelRequest(Long requestId, Long actorId, String currentStatus, String reason) {
        Map<String, Object> payment = paymentRow(requestId);
        if (payment != null && "PAID".equals(DbValueMapper.string(payment, "status"))) {
            boolean refunded = buildGraphPointService.refundPaidPointPayment(requestId);
            if (!refunded) {
                throw conflict("결제가 완료된 요청은 PG 환불 처리 후 취소해야 합니다. 관리자에게 문의해 주세요.");
            }
        }
        jdbcTemplate.update("UPDATE assembly_requests SET status = 'CANCELLED', cancellation_reason = ?, cancelled_at = now(), updated_at = now() WHERE id = ?", reason, requestId);
        jdbcTemplate.update("UPDATE assembly_offers SET status = 'EXPIRED', updated_at = now() WHERE assembly_request_id = ? AND status = 'AVAILABLE'", requestId);
        jdbcTemplate.update("""
                UPDATE assembly_payment_attempts
                SET status = 'CANCELLED', failure_code = 'ORDER_CANCELLED', failure_message = '조립 요청이 취소되었습니다.',
                    completed_at = now(), updated_at = now()
                WHERE assembly_payment_id = (SELECT id FROM assembly_payments WHERE assembly_request_id = ?)
                  AND status IN ('READY', 'PROCESSING', 'VERIFYING')
                """, requestId);
        jdbcTemplate.update("""
                UPDATE assembly_payments
                SET status = 'CANCELLED', cancelled_at = now(), updated_at = now()
                WHERE assembly_request_id = ? AND status = 'PENDING'
                """, requestId);
        addHistory(requestId, actorId, currentStatus, "CANCELLED", reason);
    }

    private void addHistory(Long requestId, Long actorId, String from, String to, String note) {
        jdbcTemplate.update("""
                INSERT INTO assembly_request_status_history (assembly_request_id, actor_user_id, from_status, to_status, note, created_at)
                VALUES (?, ?, ?, ?, ?, now())
                """, requestId, actorId, from, to, note);
    }

    private void addOfferActivity(
            Long offerId,
            Long actorId,
            String action,
            String offerPublicId,
            String withdrawalReason
    ) {
        Map<String, Object> row = jdbcTemplate.queryForList("""
                SELECT public_id::text AS id, status, confirmed_parts_price, assembly_fee,
                       delivery_fee, final_price, lead_time_days, stock_status,
                       warranty_days, proposal_message, admin_note, updated_at
                FROM assembly_offers WHERE id = ?
                """, offerId).stream().findFirst().orElse(Map.of("id", offerPublicId));
        Map<String, Object> snapshot = new LinkedHashMap<>(row);
        snapshot.put("warrantyDays", warrantyDays(row));
        snapshot.put("message", DbValueMapper.string(row, "proposal_message"));
        if (withdrawalReason != null) {
            snapshot.put("withdrawalReason", withdrawalReason);
        }
        jdbcTemplate.update("""
                INSERT INTO assembly_offer_activities (assembly_offer_id, actor_user_id, action, snapshot, created_at)
                VALUES (?, ?, ?, ?::jsonb, now())
                """, offerId, actorId, action, toJson(snapshot));
    }

    private void expireExternalOffers(Long technicianId, String reason) {
        List<Long> requestIds = jdbcTemplate.queryForList("""
                SELECT DISTINCT assembly_request_id
                FROM assembly_offers
                WHERE technician_id = ? AND status = 'AVAILABLE'
                ORDER BY assembly_request_id
                """, technicianId).stream()
                .map(row -> longValue(row, "assembly_request_id"))
                .sorted()
                .toList();
        for (Long requestId : requestIds) {
            jdbcTemplate.queryForObject(
                    "SELECT id FROM assembly_requests WHERE id = ? FOR UPDATE",
                    Long.class,
                    requestId);
        }
        List<Map<String, Object>> offers = jdbcTemplate.queryForList("""
                SELECT id, public_id::text AS public_id, assembly_request_id FROM assembly_offers
                WHERE technician_id = ? AND status = 'AVAILABLE'
                ORDER BY assembly_request_id, id
                FOR UPDATE
                """, technicianId);
        for (Map<String, Object> offer : offers) {
            Long offerId = longValue(offer, "id");
            jdbcTemplate.update("""
                    UPDATE assembly_offers SET status = 'WITHDRAWN', admin_note = ?,
                        withdrawn_at = now(), updated_at = now() WHERE id = ?
                    """, reason, offerId);
            addOfferActivity(offerId, null, "ADMIN_WITHDRAWN", DbValueMapper.string(offer, "public_id"), reason);
        }
        for (Long requestId : requestIds) {
            Integer remaining = jdbcTemplate.queryForObject(
                    "SELECT count(*) FROM assembly_offers WHERE assembly_request_id = ? AND status = 'AVAILABLE'",
                    Integer.class, requestId);
            if (remaining != null && remaining == 0) {
                String previousStatus = jdbcTemplate.queryForObject(
                        "SELECT status FROM assembly_requests WHERE id = ?", String.class, requestId);
                if ("OFFERED".equals(previousStatus)) {
                    jdbcTemplate.update(
                            "UPDATE assembly_requests SET status = 'REQUESTED', updated_at = now() WHERE id = ?",
                            requestId);
                    addHistory(requestId, null, "OFFERED", "REQUESTED", "이용 가능한 기사 제안 없음");
                }
            }
        }
    }

    private static int warrantyDays(Map<String, Object> row) {
        Integer value = DbValueMapper.integer(row, "warranty_days");
        return value == null ? 0 : value;
    }

    private void validateTechnicianEligibleForRequest(Map<String, Object> technician, Map<String, Object> request) {
        if (!"ACTIVE".equals(DbValueMapper.string(technician, "status"))
                || !"APPROVED".equals(DbValueMapper.string(technician, "verification_status"))
                || !Boolean.TRUE.equals(technician.get("standard_as_accepted"))
                || !stringList(DbValueMapper.json(technician, "service_regions", List.of())).contains(DbValueMapper.string(request, "region"))
                || !stringList(DbValueMapper.json(technician, "service_types", List.of())).contains(DbValueMapper.string(request, "service_type"))) {
            throw conflict("요청 조건에 맞는 ACTIVE 기사만 제안할 수 있습니다.");
        }
    }

    private void audit(CurrentUserService.CurrentUser admin, String action, String targetType, String targetId, Object metadata) {
        jdbcTemplate.update("""
                INSERT INTO admin_audit_logs (actor_user_id, action, target_type, target_id, metadata, created_at)
                VALUES (?, ?, ?, ?, ?::jsonb, now())
                """, admin.internalId(), action, targetType, targetId, toJson(metadata));
    }

    private TechnicianInput technicianInput(Map<String, Object> body, Map<String, Object> existing) {
        String displayName = value(body, existing, "displayName", "display_name");
        displayName = requiredLimitedText(displayName, 120, "기사 이름이 필요합니다.");
        String initials = value(body, existing, "initials", "initials");
        initials = initials == null || initials.isBlank() ? displayName.substring(0, 1) : requiredLimitedText(initials, 12, "이니셜은 12자 이하여야 합니다.");
        String profileImageUrl = body.containsKey("profileImageUrl")
                ? profileImageValue(body.get("profileImageUrl"))
                : existing == null ? null : DbValueMapper.string(existing, "profile_image_url");
        String status = allowed(value(body, existing, "status", "status"), TECHNICIAN_STATUSES, "지원하지 않는 기사 상태입니다.");
        List<String> regions = stringList(body.containsKey("serviceRegions") ? body.get("serviceRegions") : existing == null ? List.of() : DbValueMapper.json(existing, "service_regions", List.of()));
        if (regions.isEmpty() || !REGIONS.containsAll(regions)) throw validation("지원 지역을 한 개 이상 올바르게 선택해 주세요.");
        List<String> serviceTypes = stringList(body.containsKey("serviceTypes") ? body.get("serviceTypes") : existing == null ? List.of() : DbValueMapper.json(existing, "service_types", List.of()));
        if (serviceTypes.isEmpty() || !SERVICE_TYPES.containsAll(serviceTypes)) throw validation("서비스 방식을 한 개 이상 올바르게 선택해 주세요.");
        List<String> specialties = stringList(body.containsKey("specialties") ? body.get("specialties") : existing == null ? List.of() : DbValueMapper.json(existing, "specialties", List.of()));
        double rating = doubleValue(body.containsKey("rating") ? body.get("rating") : existing == null ? 0 : existing.get("rating"), 0);
        if (rating < 0 || rating > 5) throw validation("평점은 0~5 범위여야 합니다.");
        int completedJobs = (int) optionalNonnegativeLong(body.get("completedJobs"), existing == null ? 0 : longValue(existing, "completed_jobs"), "완료 건수");
        int responseMinutes = (int) optionalNonnegativeLong(body.get("avgResponseMinutes"), existing == null ? 0 : longValue(existing, "avg_response_minutes"), "평균 응답 시간");
        long assemblyFee = optionalNonnegativeLong(body.get("assemblyFee"), existing == null ? 0 : longValue(existing, "assembly_fee"), "조립비");
        long deliveryFee = optionalNonnegativeLong(body.get("deliveryFee"), existing == null ? 0 : longValue(existing, "delivery_fee"), "배송비");
        int leadTime = (int) optionalPositiveLong(body.get("leadTimeDays"), existing == null ? 1 : longValue(existing, "lead_time_days"), "예상 소요일");
        long adjustment = body.containsKey("partsPriceAdjustment") ? number(body.get("partsPriceAdjustment"), 0) : existing == null ? 0 : longValue(existing, "parts_price_adjustment");
        int priority = (int) number(body.containsKey("sortPriority") ? body.get("sortPriority") : existing == null ? 100 : existing.get("sort_priority"), 100);
        boolean asAccepted = body.containsKey("standardAsAccepted") ? Boolean.TRUE.equals(body.get("standardAsAccepted")) : existing != null && Boolean.TRUE.equals(existing.get("standard_as_accepted"));
        if ("ACTIVE".equals(status) && !asAccepted) throw validation("ACTIVE 기사는 표준 AS 정책에 동의해야 합니다.");
        return new TechnicianInput(displayName, initials, profileImageUrl, status, regions, serviceTypes, specialties,
                rating, completedJobs, responseMinutes, assemblyFee, deliveryFee, leadTime, adjustment, priority, asAccepted);
    }

    private static boolean hasBlockingFail(Map<String, Object> graph) {
        for (Map<String, Object> node : objectMaps(graph.get("nodes"))) {
            if ("PART".equals(text(node.get("type"))) && "FAIL".equals(text(node.get("status")))) return true;
        }
        for (Map<String, Object> edge : objectMaps(graph.get("edges"))) {
            if ("FAIL".equals(text(edge.get("status")))) return true;
        }
        for (Map<String, Object> tool : objectMaps(graph.get("toolResults"))) {
            if ("FAIL".equals(text(tool.get("status"))) && Set.of("compatibility", "power", "size").contains(text(tool.get("tool")))) return true;
        }
        return false;
    }

    private static int page(Integer value) {
        if (value == null) return 0;
        if (value < 0) throw validation("page는 0 이상이어야 합니다.");
        return value;
    }

    private static int size(Integer value) {
        if (value == null) return 20;
        if (value < 1 || value > 100) throw validation("size는 1~100 범위여야 합니다.");
        return value;
    }

    private static LocalDate date(Object value) {
        try {
            return LocalDate.parse(requiredText(value, "희망 일정이 필요합니다."));
        } catch (Exception exception) {
            throw validation("희망 일정 형식은 YYYY-MM-DD여야 합니다.");
        }
    }

    private static String allowed(Object value, Set<String> values, String message) {
        String normalized = requiredText(value, message).toUpperCase(Locale.ROOT);
        if (!values.contains(normalized) && !values.contains(requiredText(value, message))) throw validation(message);
        return values.contains(normalized) ? normalized : requiredText(value, message);
    }

    private static String value(Map<String, Object> body, Map<String, Object> existing, String requestKey, String rowKey) {
        if (body.containsKey(requestKey)) return text(body.get(requestKey));
        return existing == null ? null : DbValueMapper.string(existing, rowKey);
    }

    private static String requiredText(Object value, String message) {
        String text = text(value);
        if (text == null || text.isBlank()) throw validation(message);
        return text.trim();
    }

    private static String requiredLimitedText(Object value, int max, String message) {
        String text = requiredText(value, message);
        if (text.length() > max) throw validation(message);
        return text;
    }

    private static String optionalText(Object value, int max, String message) {
        String text = text(value);
        if (text == null || text.isBlank()) return null;
        if (text.trim().length() > max) throw validation(message);
        return text.trim();
    }

    private static String profileImageValue(Object value) {
        String text = optionalText(value, PROFILE_IMAGE_TEXT_MAX, "프로필 이미지가 너무 큽니다.");
        if (text == null) return null;
        String lower = text.toLowerCase(Locale.ROOT);
        if (lower.startsWith("http://") || lower.startsWith("https://")
                || lower.startsWith("/api/technician-profile-images/")) {
            return text;
        }
        throw validation("프로필 이미지는 업로드된 이미지 경로 또는 HTTP(S) URL만 사용할 수 있습니다.");
    }

    private static long optionalNonnegativeLong(Object value, long fallback, String label) {
        long parsed = value == null ? fallback : number(value, fallback);
        if (parsed < 0) throw validation(label + "는 0 이상이어야 합니다.");
        return parsed;
    }

    private static long optionalPositiveLong(Object value, long fallback, String label) {
        long parsed = value == null ? fallback : number(value, fallback);
        if (parsed < 1) throw validation(label + "는 1 이상이어야 합니다.");
        return parsed;
    }

    private static long number(Object value, long fallback) {
        if (value == null) return fallback;
        if (value instanceof Number number) return number.longValue();
        try { return Long.parseLong(value.toString().trim()); }
        catch (NumberFormatException exception) { throw validation("숫자 형식이 올바르지 않습니다."); }
    }

    private static double doubleValue(Object value, double fallback) {
        if (value == null) return fallback;
        if (value instanceof Number number) return number.doubleValue();
        try { return Double.parseDouble(value.toString().trim()); }
        catch (NumberFormatException exception) { throw validation("숫자 형식이 올바르지 않습니다."); }
    }

    private static Long nullableLong(Object value) {
        if (value == null) return null;
        return value instanceof Number number ? number.longValue() : Long.valueOf(value.toString());
    }

    private static Long longValue(Map<String, Object> row, String key) {
        Object value = row.get(key);
        return value instanceof Number number ? number.longValue() : value == null ? null : Long.valueOf(value.toString());
    }

    private static String text(Object value) {
        return value == null ? null : value.toString();
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> objectMaps(Object value) {
        if (!(value instanceof List<?> list)) return List.of();
        return list.stream().filter(Map.class::isInstance).map(item -> (Map<String, Object>) item).toList();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> objectMap(Object value) {
        return value instanceof Map<?, ?> map ? (Map<String, Object>) map : Map.of();
    }

    private static List<String> stringList(Object value) {
        if (!(value instanceof List<?> list)) return List.of();
        return list.stream().map(AssemblyBrokerageService::text).filter(item -> item != null && !item.isBlank()).map(String::trim).distinct().toList();
    }

    private static String toJson(Object value) {
        try { return OBJECT_MAPPER.writeValueAsString(value == null ? Map.of() : value); }
        catch (Exception exception) { throw new IllegalStateException("JSON 변환에 실패했습니다.", exception); }
    }

    private static String sha256(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception exception) {
            throw new IllegalStateException("요청 fingerprint 생성에 실패했습니다.", exception);
        }
    }

    private static String requestNo() {
        String date = OffsetDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd"));
        return "ASM-" + date + "-" + UUID.randomUUID().toString().replace("-", "").substring(0, 8).toUpperCase(Locale.ROOT);
    }

    private static ApiException validation(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", message);
    }

    private static ApiException conflict(String message) {
        return new ApiException(HttpStatus.CONFLICT, "CONFLICT_STATE", message);
    }

    private ApiException notFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "조립 요청 또는 기사 정보를 찾을 수 없습니다.");
    }

    private record TechnicianInput(
            String displayName,
            String initials,
            String profileImageUrl,
            String status,
            List<String> serviceRegions,
            List<String> serviceTypes,
            List<String> specialties,
            double rating,
            int completedJobs,
            int avgResponseMinutes,
            long assemblyFee,
            long deliveryFee,
            int leadTimeDays,
            long partsPriceAdjustment,
            int sortPriority,
            boolean standardAsAccepted
    ) {}
}

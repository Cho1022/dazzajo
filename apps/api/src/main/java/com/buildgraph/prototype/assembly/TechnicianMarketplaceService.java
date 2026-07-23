package com.buildgraph.prototype.assembly;

import com.buildgraph.prototype.common.ApiException;
import com.buildgraph.prototype.common.DbValueMapper;
import com.buildgraph.prototype.common.MockData;
import com.buildgraph.prototype.user.CurrentUserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TechnicianMarketplaceService {
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();
    private static final int PROFILE_IMAGE_TEXT_MAX = 2_000;
    private static final Set<String> REGIONS = Set.of("서울", "경기", "인천", "대전", "대구", "부산", "광주");
    private static final Set<String> SERVICE_TYPES = Set.of("FULL_SERVICE", "ASSEMBLY_ONLY");
    private static final Set<String> SCOPES = Set.of("OPEN", "SELECTED");
    private static final int MAX_EXTERNAL_OFFERS = 3;

    private final JdbcTemplate jdbcTemplate;
    private final CurrentUserService currentUserService;

    public TechnicianMarketplaceService(JdbcTemplate jdbcTemplate, CurrentUserService currentUserService) {
        this.jdbcTemplate = jdbcTemplate;
        this.currentUserService = currentUserService;
    }

    public void requireProfileImageUpload(String authorization) {
        requireRegularUser(authorization);
    }

    @Transactional
    public Map<String, Object> apply(String authorization, Map<String, Object> body) {
        CurrentUserService.CurrentUser user = requireRegularUser(authorization);
        Map<String, Object> existing = technicianByUser(user.internalId());
        if (existing != null && !"REJECTED".equals(DbValueMapper.string(existing, "verification_status"))) {
            throw conflict("이미 처리 중이거나 승인된 기사 프로필이 있습니다.");
        }
        ProfileInput input = profileInput(body, existing);
        if (!input.standardAsAccepted()) {
            throw validation("Dazzajo 표준 AS 정책 동의가 필요합니다.");
        }
        if (existing == null) {
            jdbcTemplate.update("""
                    INSERT INTO technicians (
                        user_id, display_name, initials, profile_image_url, status,
                        provider_type, verification_status, business_name, contact_phone,
                        service_regions, service_types, specialties, rating, completed_jobs,
                        avg_response_minutes, assembly_fee, delivery_fee, lead_time_days,
                        parts_price_adjustment, sort_priority, standard_as_accepted, seeded,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, 'INACTIVE', 'EXTERNAL', 'PENDING', ?, ?,
                        ?::jsonb, ?::jsonb, ?::jsonb, 0, 0, 0, ?, ?, ?, 0, 1000, true, false,
                        now(), now())
                    """, user.internalId(), input.displayName(), input.initials(), input.profileImageUrl(),
                    input.businessName(), input.contactPhone(), toJson(input.serviceRegions()),
                    toJson(input.serviceTypes()), toJson(input.specialties()), input.assemblyFee(),
                    input.deliveryFee(), input.leadTimeDays());
        } else {
            jdbcTemplate.update("""
                    UPDATE technicians SET display_name = ?, initials = ?, profile_image_url = ?,
                        business_name = ?, contact_phone = ?, service_regions = ?::jsonb,
                        service_types = ?::jsonb, specialties = ?::jsonb, assembly_fee = ?,
                        delivery_fee = ?, lead_time_days = ?, standard_as_accepted = true,
                        verification_status = 'PENDING', status = 'INACTIVE', rejection_reason = NULL,
                        approved_by_admin_id = NULL, approved_at = NULL, updated_at = now()
                    WHERE id = ?
                    """, input.displayName(), input.initials(), input.profileImageUrl(), input.businessName(),
                    input.contactPhone(), toJson(input.serviceRegions()), toJson(input.serviceTypes()),
                    toJson(input.specialties()), input.assemblyFee(), input.deliveryFee(), input.leadTimeDays(),
                    longValue(existing, "id"));
        }
        return profile(authorization);
    }

    public Map<String, Object> profile(String authorization) {
        CurrentUserService.CurrentUser user = requireRegularUser(authorization);
        Map<String, Object> technician = technicianByUser(user.internalId());
        if (technician == null) throw notFound();
        return profileMap(technician);
    }

    public Optional<Map<String, Object>> profileIfPresent(String authorization) {
        CurrentUserService.CurrentUser user = requireRegularUser(authorization);
        return Optional.ofNullable(technicianByUser(user.internalId())).map(this::profileMap);
    }

    @Transactional
    public Map<String, Object> updateProfile(String authorization, Map<String, Object> body) {
        CurrentUserService.CurrentUser user = requireRegularUser(authorization);
        Map<String, Object> existing = technicianByUser(user.internalId());
        if (existing == null) throw notFound();
        if ("REJECTED".equals(DbValueMapper.string(existing, "verification_status"))) {
            throw conflict("거절된 신청은 재신청으로 제출해 주세요.");
        }
        ProfileInput input = profileInput(body, existing);
        if (!input.standardAsAccepted()) throw validation("Dazzajo 표준 AS 정책 동의가 필요합니다.");
        jdbcTemplate.update("""
                UPDATE technicians SET display_name = ?, initials = ?, profile_image_url = ?,
                    business_name = ?, contact_phone = ?, service_regions = ?::jsonb,
                    service_types = ?::jsonb, specialties = ?::jsonb, assembly_fee = ?,
                    delivery_fee = ?, lead_time_days = ?, standard_as_accepted = true, updated_at = now()
                WHERE id = ?
                """, input.displayName(), input.initials(), input.profileImageUrl(), input.businessName(),
                input.contactPhone(), toJson(input.serviceRegions()), toJson(input.serviceTypes()),
                toJson(input.specialties()), input.assemblyFee(), input.deliveryFee(), input.leadTimeDays(),
                longValue(existing, "id"));
        return profile(authorization);
    }

    public Map<String, Object> listRequests(String authorization, String scopeValue, Integer pageValue, Integer sizeValue) {
        CurrentUserService.CurrentUser user = requireRegularUser(authorization);
        String scope = allowed(scopeValue == null ? "OPEN" : scopeValue, SCOPES, "지원하지 않는 요청함 범위입니다.");
        Map<String, Object> technician = "OPEN".equals(scope)
                ? requireBidEligibleTechnician(user.internalId())
                : requireApprovedExternalTechnician(user.internalId());
        int page = page(pageValue);
        int size = size(sizeValue);
        String condition = "OPEN".equals(scope) ? openCondition() : selectedCondition();
        Object[] baseParams = "OPEN".equals(scope)
                ? new Object[]{longValue(technician, "id"), longValue(technician, "id"), user.internalId()}
                : new Object[]{longValue(technician, "id")};
        long total = jdbcTemplate.queryForObject("SELECT count(*) " + requestFrom() + condition, Long.class, baseParams);
        Object[] pageParams = append(baseParams, size, page * size);
        List<Map<String, Object>> rows = jdbcTemplate.queryForList("""
                SELECT ar.id AS internal_id, ar.public_id::text AS id, ar.request_no, ar.status,
                       ar.service_type, ar.region, ar.preferred_date, ar.delivery_method,
                       ar.estimated_parts_price, ar.item_count, ar.created_at, ar.updated_at,
                       own_offer.public_id::text AS own_offer_id, own_offer.status AS own_offer_status,
                       ap.status AS payment_status
                """ + requestFrom() + condition + " ORDER BY ar.created_at DESC, ar.id DESC LIMIT ? OFFSET ?", pageParams);
        return MockData.map(
                "items", rows.stream().map(this::requestSummary).toList(),
                "page", page,
                "size", size,
                "total", total
        );
    }

    public Map<String, Object> requestDetail(String authorization, String requestPublicId) {
        CurrentUserService.CurrentUser user = requireRegularUser(authorization);
        Map<String, Object> technician = requireApprovedExternalTechnician(user.internalId());
        Map<String, Object> request = accessibleRequest(
                requestPublicId, technician, user.internalId(), isBidEligible(technician));
        return requestDetailMap(request, technician);
    }

    @Transactional
    public Map<String, Object> createOffer(String authorization, String requestPublicId, Map<String, Object> body) {
        CurrentUserService.CurrentUser user = requireRegularUser(authorization);
        Map<String, Object> technician = requireBidEligibleTechnician(user.internalId());
        Map<String, Object> request = lockOpenRequest(requestPublicId, technician, user.internalId());
        Long requestId = longValue(request, "id");
        Long technicianId = longValue(technician, "id");
        Integer existing = jdbcTemplate.queryForObject(
                "SELECT count(*) FROM assembly_offers WHERE assembly_request_id = ? AND technician_id = ?",
                Integer.class, requestId, technicianId);
        if (existing != null && existing > 0) throw conflict("이 요청에는 이미 제안을 제출했습니다.");
        Integer externalCount = jdbcTemplate.queryForObject("""
                SELECT count(*) FROM assembly_offers ao
                JOIN technicians t ON t.id = ao.technician_id
                WHERE ao.assembly_request_id = ? AND ao.status = 'AVAILABLE' AND t.provider_type = 'EXTERNAL'
                """, Integer.class, requestId);
        if (externalCount != null && externalCount >= MAX_EXTERNAL_OFFERS) {
            throw conflict("외부 기사 제안이 마감되었습니다.");
        }
        OfferInput input = offerInput(body, null, request);
        String offerId = jdbcTemplate.queryForObject("""
                INSERT INTO assembly_offers (
                    assembly_request_id, technician_id, status, technician_snapshot,
                    confirmed_parts_price, assembly_fee, delivery_fee, final_price,
                    lead_time_days, stock_status, warranty_days, proposal_message, submitted_by_user_id,
                    submitted_at, created_at, updated_at
                ) VALUES (?, ?, 'AVAILABLE', ?::jsonb, ?, ?, ?, ?, ?, ?, ?, ?, ?, now(), now(), now())
                RETURNING public_id::text
                """, String.class, requestId, technicianId, toJson(technicianSnapshot(technician)),
                input.confirmedPartsPrice(), input.assemblyFee(), input.deliveryFee(), input.finalPrice(),
                input.leadTimeDays(), input.stockStatus(), input.warrantyDays(), input.message(), user.internalId());
        Map<String, Object> offer = ownOfferByPublicId(offerId, technicianId, true);
        addOfferActivity(longValue(offer, "id"), user.internalId(), "SUBMITTED", offer, null);
        if ("REQUESTED".equals(DbValueMapper.string(request, "status"))) {
            jdbcTemplate.update("UPDATE assembly_requests SET status = 'OFFERED', updated_at = now() WHERE id = ?", requestId);
            addRequestHistory(requestId, user.internalId(), "REQUESTED", "OFFERED", "외부 기사 제안 도착");
        }
        return requestDetailMap(requestRow(requestId), technician);
    }

    @Transactional
    public Map<String, Object> updateOffer(String authorization, String offerPublicId, Map<String, Object> body) {
        CurrentUserService.CurrentUser user = requireRegularUser(authorization);
        Map<String, Object> technician = requireBidEligibleTechnician(user.internalId());
        Map<String, Object> offer = ownOfferByPublicId(offerPublicId, longValue(technician, "id"), true);
        if (!"AVAILABLE".equals(DbValueMapper.string(offer, "status"))) throw conflict("수정할 수 없는 제안입니다.");
        Map<String, Object> request = requestRowForUpdate(longValue(offer, "assembly_request_id"));
        if (!Set.of("REQUESTED", "OFFERED").contains(DbValueMapper.string(request, "status"))) {
            throw conflict("마감된 요청의 제안은 수정할 수 없습니다.");
        }
        OfferInput input = offerInput(body, offer, request);
        jdbcTemplate.update("""
                UPDATE assembly_offers SET confirmed_parts_price = ?, assembly_fee = ?, delivery_fee = ?,
                    final_price = ?, lead_time_days = ?, stock_status = ?, warranty_days = ?,
                    proposal_message = ?, updated_at = now()
                WHERE id = ?
                """, input.confirmedPartsPrice(), input.assemblyFee(), input.deliveryFee(), input.finalPrice(),
                input.leadTimeDays(), input.stockStatus(), input.warrantyDays(), input.message(), longValue(offer, "id"));
        Map<String, Object> updated = ownOfferByPublicId(offerPublicId, longValue(technician, "id"), true);
        addOfferActivity(longValue(updated, "id"), user.internalId(), "UPDATED", updated, null);
        return offerMap(updated);
    }

    @Transactional
    public Map<String, Object> withdrawOffer(String authorization, String offerPublicId, Map<String, Object> body) {
        CurrentUserService.CurrentUser user = requireRegularUser(authorization);
        Map<String, Object> technician = requireBidEligibleTechnician(user.internalId());
        Map<String, Object> offer = ownOfferByPublicId(offerPublicId, longValue(technician, "id"), true);
        if (!"AVAILABLE".equals(DbValueMapper.string(offer, "status"))) throw conflict("철회할 수 없는 제안입니다.");
        Map<String, Object> request = requestRowForUpdate(longValue(offer, "assembly_request_id"));
        if (!Set.of("REQUESTED", "OFFERED").contains(DbValueMapper.string(request, "status"))) {
            throw conflict("마감된 요청의 제안은 철회할 수 없습니다.");
        }
        String reason = required(body.get("reason"), 1000, "철회 사유가 필요합니다.");
        jdbcTemplate.update("""
                UPDATE assembly_offers SET status = 'WITHDRAWN', admin_note = ?, withdrawn_at = now(), updated_at = now()
                WHERE id = ?
                """, reason, longValue(offer, "id"));
        Map<String, Object> updated = ownOfferByPublicId(offerPublicId, longValue(technician, "id"), true);
        addOfferActivity(longValue(updated, "id"), user.internalId(), "WITHDRAWN", updated, reason);
        Integer remaining = jdbcTemplate.queryForObject(
                "SELECT count(*) FROM assembly_offers WHERE assembly_request_id = ? AND status = 'AVAILABLE'",
                Integer.class, longValue(request, "id"));
        if (remaining != null && remaining == 0) {
            jdbcTemplate.update("UPDATE assembly_requests SET status = 'REQUESTED', updated_at = now() WHERE id = ?", longValue(request, "id"));
            addRequestHistory(longValue(request, "id"), user.internalId(), "OFFERED", "REQUESTED", "모든 기사 제안 철회");
        }
        return offerMap(updated);
    }

    private String requestFrom() {
        return """
                 FROM assembly_requests ar
                 LEFT JOIN assembly_offers own_offer
                   ON own_offer.assembly_request_id = ar.id AND own_offer.technician_id = ?
                 LEFT JOIN assembly_payments ap ON ap.assembly_request_id = ar.id
                """;
    }

    private String openCondition() {
        return """
                 JOIN technicians current_tech ON current_tech.id = ?
                 WHERE ar.user_id <> ?
                   AND ar.status IN ('REQUESTED', 'OFFERED')
                   AND jsonb_exists(current_tech.service_regions, ar.region)
                   AND jsonb_exists(current_tech.service_types, ar.service_type)
                   AND own_offer.id IS NULL
                   AND (SELECT count(*) FROM assembly_offers ext_offer
                        JOIN technicians ext_tech ON ext_tech.id = ext_offer.technician_id
                        WHERE ext_offer.assembly_request_id = ar.id
                          AND ext_offer.status = 'AVAILABLE'
                          AND ext_tech.provider_type = 'EXTERNAL') < 3
                """;
    }

    private String selectedCondition() {
        return """
                 WHERE own_offer.status = 'SELECTED'
                """;
    }

    private Map<String, Object> accessibleRequest(
            String publicId,
            Map<String, Object> technician,
            Long userId,
            boolean allowOpenRequest
    ) {
        Long technicianId = longValue(technician, "id");
        List<Map<String, Object>> rows = jdbcTemplate.queryForList("""
                SELECT ar.*, ar.public_id::text AS public_id_text, ap.status AS payment_status,
                       own_offer.public_id::text AS own_offer_public_id, own_offer.status AS own_offer_status
                FROM assembly_requests ar
                LEFT JOIN assembly_offers own_offer
                  ON own_offer.assembly_request_id = ar.id AND own_offer.technician_id = ?
                LEFT JOIN assembly_payments ap ON ap.assembly_request_id = ar.id
                WHERE ar.public_id = ?::uuid
                """ + detailAccessCondition(), technicianId, publicId, allowOpenRequest, userId,
                toJson(DbValueMapper.json(technician, "service_regions", List.of())),
                toJson(DbValueMapper.json(technician, "service_types", List.of())));
        return rows.stream().findFirst().orElseThrow(TechnicianMarketplaceService::notFound);
    }

    static String detailAccessCondition() {
        return """
                  AND (
                    own_offer.id IS NOT NULL
                    OR (
                      ? AND ar.user_id <> ? AND ar.status IN ('REQUESTED', 'OFFERED')
                      AND jsonb_exists(?::jsonb, ar.region)
                      AND jsonb_exists(?::jsonb, ar.service_type)
                      AND own_offer.id IS NULL
                      AND (SELECT count(*) FROM assembly_offers ext_offer
                           JOIN technicians ext_tech ON ext_tech.id = ext_offer.technician_id
                           WHERE ext_offer.assembly_request_id = ar.id
                             AND ext_offer.status = 'AVAILABLE'
                             AND ext_tech.provider_type = 'EXTERNAL') < 3
                    )
                  )
                """;
    }

    private Map<String, Object> lockOpenRequest(String publicId, Map<String, Object> technician, Long userId) {
        Map<String, Object> row = jdbcTemplate.queryForList("""
                SELECT * FROM assembly_requests WHERE public_id = ?::uuid FOR UPDATE
                """, publicId).stream().findFirst().orElseThrow(TechnicianMarketplaceService::notFound);
        if (userId.equals(longValue(row, "user_id"))
                || !Set.of("REQUESTED", "OFFERED").contains(DbValueMapper.string(row, "status"))
                || !stringList(technician, "service_regions").contains(DbValueMapper.string(row, "region"))
                || !stringList(technician, "service_types").contains(DbValueMapper.string(row, "service_type"))) {
            throw notFound();
        }
        return row;
    }

    private Map<String, Object> requestDetailMap(Map<String, Object> request, Map<String, Object> technician) {
        Long requestId = longValue(request, "id");
        Map<String, Object> ownOffer = ownOffer(requestId, longValue(technician, "id"));
        Map<String, Object> payment = paymentRow(requestId);
        boolean selected = ownOffer != null && "SELECTED".equals(DbValueMapper.string(ownOffer, "status"));
        boolean paid = payment != null
                && "PAID".equals(DbValueMapper.string(payment, "status"))
                && !"MOCK".equals(DbValueMapper.string(payment, "provider"));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", DbValueMapper.string(request, request.containsKey("public_id_text") ? "public_id_text" : "id"));
        result.put("requestNo", DbValueMapper.string(request, "request_no"));
        result.put("status", DbValueMapper.string(request, "status"));
        result.put("serviceType", DbValueMapper.string(request, "service_type"));
        result.put("region", DbValueMapper.string(request, "region"));
        result.put("preferredDate", DbValueMapper.string(request, "preferred_date"));
        result.put("deliveryMethod", DbValueMapper.string(request, "delivery_method"));
        result.put("estimatedPartsPrice", longValue(request, "estimated_parts_price"));
        result.put("itemCount", DbValueMapper.integer(request, "item_count"));
        result.put("items", requestItems(requestId));
        result.put("ownOffer", ownOffer == null ? null : offerMap(ownOffer));
        result.put("paymentStatus", payment == null ? null : DbValueMapper.string(payment, "status"));
        result.put("contact", selected && paid ? contactMap(request) : null);
        result.put("note", selected && paid ? DbValueMapper.string(request, "note") : null);
        result.put("createdAt", DbValueMapper.timestamp(request, "created_at"));
        return result;
    }

    private Map<String, Object> requestSummary(Map<String, Object> row) {
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
                "ownOfferId", DbValueMapper.string(row, "own_offer_id"),
                "ownOfferStatus", DbValueMapper.string(row, "own_offer_status"),
                "paymentStatus", DbValueMapper.string(row, "payment_status"),
                "createdAt", DbValueMapper.timestamp(row, "created_at")
        );
    }

    private List<Map<String, Object>> requestItems(Long requestId) {
        return jdbcTemplate.queryForList("""
                SELECT part_public_id::text AS part_id, category, name, manufacturer,
                       quantity, unit_price_snapshot, line_total
                FROM assembly_request_items WHERE assembly_request_id = ? ORDER BY id
                """, requestId).stream().map(row -> MockData.map(
                "partId", DbValueMapper.string(row, "part_id"),
                "category", DbValueMapper.string(row, "category"),
                "name", DbValueMapper.string(row, "name"),
                "manufacturer", DbValueMapper.string(row, "manufacturer"),
                "quantity", DbValueMapper.integer(row, "quantity"),
                "unitPrice", longValue(row, "unit_price_snapshot"),
                "lineTotal", longValue(row, "line_total")
        )).toList();
    }

    private Map<String, Object> contactMap(Map<String, Object> row) {
        return MockData.map(
                "name", DbValueMapper.string(row, "contact_name"),
                "phone", DbValueMapper.string(row, "contact_phone"),
                "postalCode", DbValueMapper.string(row, "postal_code"),
                "addressLine1", DbValueMapper.string(row, "address_line1"),
                "addressLine2", DbValueMapper.string(row, "address_line2")
        );
    }

    private Map<String, Object> offerMap(Map<String, Object> row) {
        return MockData.map(
                "id", DbValueMapper.string(row, row.containsKey("public_id_text") ? "public_id_text" : "public_id"),
                "status", DbValueMapper.string(row, "status"),
                "confirmedPartsPrice", longValue(row, "confirmed_parts_price"),
                "assemblyFee", longValue(row, "assembly_fee"),
                "deliveryFee", longValue(row, "delivery_fee"),
                "finalPrice", longValue(row, "final_price"),
                "leadTimeDays", DbValueMapper.integer(row, "lead_time_days"),
                "stockStatus", DbValueMapper.string(row, "stock_status"),
                "warrantyDays", warrantyDays(row),
                "message", DbValueMapper.string(row, "proposal_message"),
                "note", DbValueMapper.string(row, "proposal_message"),
                "submittedAt", DbValueMapper.timestamp(row, "submitted_at"),
                "updatedAt", DbValueMapper.timestamp(row, "updated_at")
        );
    }

    private Map<String, Object> profileMap(Map<String, Object> row) {
        return MockData.map(
                "id", DbValueMapper.string(row, "public_id"),
                "displayName", DbValueMapper.string(row, "display_name"),
                "initials", DbValueMapper.string(row, "initials"),
                "profileImageUrl", DbValueMapper.string(row, "profile_image_url"),
                "businessName", DbValueMapper.string(row, "business_name"),
                "contactPhone", DbValueMapper.string(row, "contact_phone"),
                "status", DbValueMapper.string(row, "status"),
                "providerType", DbValueMapper.string(row, "provider_type"),
                "verificationStatus", DbValueMapper.string(row, "verification_status"),
                "rejectionReason", DbValueMapper.string(row, "rejection_reason"),
                "serviceRegions", DbValueMapper.json(row, "service_regions", List.of()),
                "serviceTypes", DbValueMapper.json(row, "service_types", List.of()),
                "specialties", DbValueMapper.json(row, "specialties", List.of()),
                "assemblyFee", longValue(row, "assembly_fee"),
                "deliveryFee", longValue(row, "delivery_fee"),
                "leadTimeDays", DbValueMapper.integer(row, "lead_time_days"),
                "standardAsAccepted", row.get("standard_as_accepted"),
                "seeded", row.get("seeded"),
                "approvedAt", DbValueMapper.timestamp(row, "approved_at"),
                "createdAt", DbValueMapper.timestamp(row, "created_at"),
                "updatedAt", DbValueMapper.timestamp(row, "updated_at")
        );
    }

    private ProfileInput profileInput(Map<String, Object> body, Map<String, Object> existing) {
        String displayName = stringValue(body, existing, "displayName", "display_name");
        displayName = required(displayName, 120, "기사 이름이 필요합니다.");
        String initials = stringValue(body, existing, "initials", "initials");
        if (initials == null || initials.isBlank()) initials = displayName.substring(0, 1);
        initials = required(initials, 12, "이니셜은 12자 이하여야 합니다.");
        String profileImageUrl = body.containsKey("profileImageUrl")
                ? profileImageValue(body.get("profileImageUrl"))
                : existing == null ? null : DbValueMapper.string(existing, "profile_image_url");
        String businessName = optionalValue(body, existing, "businessName", "business_name", 160);
        String contactPhone = phone(body.containsKey("contactPhone") ? body.get("contactPhone") : existing == null ? null : existing.get("contact_phone"));
        List<String> regions = listValue(body, existing, "serviceRegions", "service_regions");
        if (regions.isEmpty() || !REGIONS.containsAll(regions)) throw validation("지원 지역을 한 개 이상 선택해 주세요.");
        List<String> serviceTypes = listValue(body, existing, "serviceTypes", "service_types");
        if (serviceTypes.isEmpty() || !SERVICE_TYPES.containsAll(serviceTypes)) throw validation("서비스 방식을 한 개 이상 선택해 주세요.");
        List<String> specialties = listValue(body, existing, "specialties", "specialties");
        long assemblyFee = nonnegative(body.get("assemblyFee"), existing == null ? 0 : longValue(existing, "assembly_fee"), "조립비");
        long deliveryFee = nonnegative(body.get("deliveryFee"), existing == null ? 0 : longValue(existing, "delivery_fee"), "배송비");
        int leadTime = (int) positive(body.get("leadTimeDays"), existing == null ? 1 : longValue(existing, "lead_time_days"), "예상 소요일");
        boolean asAccepted = body.containsKey("standardAsAccepted")
                ? Boolean.TRUE.equals(body.get("standardAsAccepted"))
                : existing != null && Boolean.TRUE.equals(existing.get("standard_as_accepted"));
        return new ProfileInput(displayName, initials, profileImageUrl, businessName, contactPhone,
                regions, serviceTypes, specialties, assemblyFee, deliveryFee, leadTime, asAccepted);
    }

    private OfferInput offerInput(Map<String, Object> body, Map<String, Object> existing, Map<String, Object> request) {
        long assemblyFee = nonnegative(body.get("assemblyFee"), existing == null ? 0 : longValue(existing, "assembly_fee"), "조립비");
        AssemblyOfferPricePolicy.PriceResult price = AssemblyOfferPricePolicy.calculate(
                DbValueMapper.string(request, "service_type"),
                longValue(request, "estimated_parts_price"),
                assemblyFee
        );
        int leadTime = (int) positive(body.get("leadTimeDays"), existing == null ? 1 : longValue(existing, "lead_time_days"), "예상 소요일");
        String stockStatus = body.containsKey("stockStatus")
                ? required(body.get("stockStatus"), 255, "재고 확인 문구가 필요합니다.")
                : required(existing == null ? null : existing.get("stock_status"), 255, "재고 확인 문구가 필요합니다.");
        int warrantyDays = body.containsKey("warrantyDays")
                ? warrantyDays(body.get("warrantyDays"))
                : existing == null ? 0 : warrantyDays(existing);
        String message = body.containsKey("message")
                ? optional(body.get("message"), 500)
                : body.containsKey("note")
                        ? optional(body.get("note"), 500)
                        : existing == null ? null : DbValueMapper.string(existing, "proposal_message");
        return new OfferInput(price.confirmedPartsPrice(), price.assemblyFee(), price.deliveryFee(), price.finalPrice(),
                leadTime, stockStatus, warrantyDays, message);
    }

    private Map<String, Object> requireApprovedExternalTechnician(Long userId) {
        Map<String, Object> technician = technicianByUser(userId);
        if (technician == null
                || !"EXTERNAL".equals(DbValueMapper.string(technician, "provider_type"))
                || !"APPROVED".equals(DbValueMapper.string(technician, "verification_status"))) {
            throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "승인된 외부 기사만 이용할 수 있습니다.");
        }
        return technician;
    }

    private CurrentUserService.CurrentUser requireRegularUser(String authorization) {
        CurrentUserService.CurrentUser user = currentUserService.requireUser(authorization);
        if (!"USER".equals(user.role())) {
            throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "사용자 계정만 외부 기사 기능을 이용할 수 있습니다.");
        }
        return user;
    }

    private Map<String, Object> requireBidEligibleTechnician(Long userId) {
        Map<String, Object> technician = requireApprovedExternalTechnician(userId);
        if (!isBidEligible(technician)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "활동 중이며 표준 AS에 동의한 기사만 입찰할 수 있습니다.");
        }
        return technician;
    }

    private boolean isBidEligible(Map<String, Object> technician) {
        return "ACTIVE".equals(DbValueMapper.string(technician, "status"))
                && Boolean.TRUE.equals(technician.get("standard_as_accepted"));
    }

    private Map<String, Object> technicianByUser(Long userId) {
        return jdbcTemplate.queryForList("""
                SELECT *, public_id::text AS public_id FROM technicians
                WHERE user_id = ? AND deleted_at IS NULL
                """, userId).stream().findFirst().orElse(null);
    }

    private Map<String, Object> ownOffer(Long requestId, Long technicianId) {
        return jdbcTemplate.queryForList("""
                SELECT *, id AS internal_id, public_id::text AS public_id_text
                FROM assembly_offers WHERE assembly_request_id = ? AND technician_id = ?
                """, requestId, technicianId).stream().findFirst().orElse(null);
    }

    private Map<String, Object> ownOfferByPublicId(String publicId, Long technicianId, boolean lock) {
        String suffix = lock ? " FOR UPDATE" : "";
        return jdbcTemplate.queryForList("""
                SELECT *, id AS internal_id, public_id::text AS public_id_text
                FROM assembly_offers WHERE public_id = ?::uuid AND technician_id = ?
                """ + suffix, publicId, technicianId).stream().findFirst().orElseThrow(TechnicianMarketplaceService::notFound);
    }

    private Map<String, Object> requestRow(Long requestId) {
        return jdbcTemplate.queryForList("""
                SELECT ar.*, ar.public_id::text AS public_id_text, ap.status AS payment_status
                FROM assembly_requests ar
                LEFT JOIN assembly_payments ap ON ap.assembly_request_id = ar.id
                WHERE ar.id = ?
                """, requestId).stream().findFirst().orElseThrow(TechnicianMarketplaceService::notFound);
    }

    private Map<String, Object> requestRowForUpdate(Long requestId) {
        return jdbcTemplate.queryForList("SELECT * FROM assembly_requests WHERE id = ? FOR UPDATE", requestId)
                .stream().findFirst().orElseThrow(TechnicianMarketplaceService::notFound);
    }

    private Map<String, Object> paymentRow(Long requestId) {
        return jdbcTemplate.queryForList("SELECT * FROM assembly_payments WHERE assembly_request_id = ?", requestId)
                .stream().findFirst().orElse(null);
    }

    private void addOfferActivity(
            Long offerId,
            Long actorId,
            String action,
            Map<String, Object> snapshot,
            String withdrawalReason
    ) {
        Map<String, Object> activitySnapshot = new LinkedHashMap<>(offerMap(snapshot));
        if (withdrawalReason != null) {
            activitySnapshot.put("withdrawalReason", withdrawalReason);
        }
        jdbcTemplate.update("""
                INSERT INTO assembly_offer_activities (assembly_offer_id, actor_user_id, action, snapshot, created_at)
                VALUES (?, ?, ?, ?::jsonb, now())
                """, offerId, actorId, action, toJson(activitySnapshot));
    }

    private void addRequestHistory(Long requestId, Long actorId, String from, String to, String note) {
        jdbcTemplate.update("""
                INSERT INTO assembly_request_status_history (assembly_request_id, actor_user_id, from_status, to_status, note, created_at)
                VALUES (?, ?, ?, ?, ?, now())
                """, requestId, actorId, from, to, note);
    }

    private Map<String, Object> technicianSnapshot(Map<String, Object> row) {
        return MockData.map(
                "displayName", DbValueMapper.string(row, "display_name"),
                "initials", DbValueMapper.string(row, "initials"),
                "profileImageUrl", DbValueMapper.string(row, "profile_image_url"),
                "rating", row.get("rating"),
                "completedJobs", DbValueMapper.integer(row, "completed_jobs"),
                "avgResponseMinutes", DbValueMapper.integer(row, "avg_response_minutes"),
                "specialties", DbValueMapper.json(row, "specialties", List.of()),
                "standardAsAccepted", row.get("standard_as_accepted"),
                "providerType", "EXTERNAL",
                "verificationStatus", "APPROVED"
        );
    }

    @SuppressWarnings("unchecked")
    private static List<String> listValue(Map<String, Object> body, Map<String, Object> existing, String key, String dbKey) {
        Object value = body.containsKey(key) ? body.get(key) : existing == null ? List.of() : DbValueMapper.json(existing, dbKey, List.of());
        if (!(value instanceof List<?> list)) throw validation(key + " 형식이 올바르지 않습니다.");
        return list.stream().map(String::valueOf).map(String::trim).filter(item -> !item.isBlank()).distinct().toList();
    }

    private static List<String> stringList(Map<String, Object> row, String key) {
        Object value = DbValueMapper.json(row, key, List.of());
        if (!(value instanceof List<?> list)) return List.of();
        return list.stream().map(String::valueOf).toList();
    }

    private static String stringValue(Map<String, Object> body, Map<String, Object> existing, String key, String dbKey) {
        if (body.containsKey(key)) return body.get(key) == null ? null : body.get(key).toString();
        return existing == null ? null : DbValueMapper.string(existing, dbKey);
    }

    private static String optionalValue(Map<String, Object> body, Map<String, Object> existing, String key, String dbKey, int max) {
        Object value = body.containsKey(key) ? body.get(key) : existing == null ? null : existing.get(dbKey);
        return optional(value, max);
    }

    private static String phone(Object value) {
        String phone = required(value, 40, "연락처가 필요합니다.");
        if (!phone.matches("[0-9+() -]{8,40}")) throw validation("연락처 형식이 올바르지 않습니다.");
        return phone;
    }

    private static String required(Object value, int max, String message) {
        String text = value == null ? null : value.toString().trim();
        if (text == null || text.isBlank()) throw validation(message);
        if (text.length() > max) throw validation(message);
        return text;
    }

    private static String optional(Object value, int max) {
        if (value == null) return null;
        String text = value.toString().trim();
        if (text.isBlank()) return null;
        if (text.length() > max) throw validation("입력값이 너무 깁니다.");
        return text;
    }

    private static String profileImageValue(Object value) {
        String text = optional(value, PROFILE_IMAGE_TEXT_MAX);
        if (text == null) return null;
        String lower = text.toLowerCase(Locale.ROOT);
        if (lower.startsWith("http://") || lower.startsWith("https://")
                || lower.startsWith("/api/technician-profile-images/")) {
            return text;
        }
        throw validation("프로필 이미지는 업로드된 이미지 경로 또는 HTTP(S) URL만 사용할 수 있습니다.");
    }

    private static String allowed(Object value, Set<String> allowed, String message) {
        String text = value == null ? null : value.toString().trim().toUpperCase(Locale.ROOT);
        if (text == null || !allowed.contains(text)) throw validation(message);
        return text;
    }

    private static long nonnegative(Object value, long fallback, String label) {
        long result = value == null ? fallback : number(value, label);
        if (result < 0) throw validation(label + "는 0 이상이어야 합니다.");
        return result;
    }

    private static long positive(Object value, long fallback, String label) {
        long result = value == null ? fallback : number(value, label);
        if (result < 1) throw validation(label + "는 1 이상이어야 합니다.");
        return result;
    }

    private static long number(Object value, String label) {
        try {
            return value instanceof Number number ? number.longValue() : Long.parseLong(value.toString());
        } catch (Exception exception) {
            throw validation(label + " 형식이 올바르지 않습니다.");
        }
    }

    private static int warrantyDays(Object value) {
        if (value == null) throw validation("무상 보증 기간이 필요합니다.");
        if (!(value instanceof Byte || value instanceof Short || value instanceof Integer || value instanceof Long)) {
            throw validation("무상 보증 기간 형식이 올바르지 않습니다.");
        }
        long result = ((Number) value).longValue();
        if (result < 0 || result > 365) {
            throw validation("무상 보증 기간은 0~365일 범위여야 합니다.");
        }
        return (int) result;
    }

    private static int warrantyDays(Map<String, Object> row) {
        Integer value = DbValueMapper.integer(row, "warranty_days");
        return value == null ? 0 : value;
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

    private static Object[] append(Object[] source, Object... additions) {
        Object[] result = new Object[source.length + additions.length];
        System.arraycopy(source, 0, result, 0, source.length);
        System.arraycopy(additions, 0, result, source.length, additions.length);
        return result;
    }

    private static long longValue(Map<String, Object> row, String key) {
        Object value = row.get(key);
        return value instanceof Number number ? number.longValue() : Long.parseLong(value.toString());
    }

    private static String toJson(Object value) {
        try {
            return OBJECT_MAPPER.writeValueAsString(value);
        } catch (Exception exception) {
            throw new IllegalStateException("JSON 변환에 실패했습니다.", exception);
        }
    }

    private static ApiException validation(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", message);
    }

    private static ApiException conflict(String message) {
        return new ApiException(HttpStatus.CONFLICT, "CONFLICT_STATE", message);
    }

    private static ApiException notFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "요청한 리소스를 찾을 수 없습니다.");
    }

    private record ProfileInput(
            String displayName,
            String initials,
            String profileImageUrl,
            String businessName,
            String contactPhone,
            List<String> serviceRegions,
            List<String> serviceTypes,
            List<String> specialties,
            long assemblyFee,
            long deliveryFee,
            int leadTimeDays,
            boolean standardAsAccepted
    ) {}

    private record OfferInput(
            long confirmedPartsPrice,
            long assemblyFee,
            long deliveryFee,
            long finalPrice,
            int leadTimeDays,
            String stockStatus,
            int warrantyDays,
            String message
    ) {}
}

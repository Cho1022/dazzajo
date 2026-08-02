package com.buildgraph.prototype.assembly;

import com.buildgraph.prototype.common.ApiException;
import com.buildgraph.prototype.user.CurrentUserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.format.DateTimeParseException;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class AssemblyPaymentService {
    private static final int ATTEMPT_TTL_MINUTES = 30;

    private final JdbcTemplate jdbcTemplate;
    private final CurrentUserService currentUserService;
    private final PaymentGateway paymentGateway;
    private final MockPaymentGateway mockPaymentGateway;
    private final TransactionTemplate transactionTemplate;
    private final ObjectMapper objectMapper;
    private final String webhookSecret;

    public AssemblyPaymentService(
            JdbcTemplate jdbcTemplate,
            CurrentUserService currentUserService,
            PaymentGateway paymentGateway,
            MockPaymentGateway mockPaymentGateway,
            TransactionTemplate transactionTemplate,
            ObjectMapper objectMapper,
            @Value("${buildgraph.payment.mock.webhook-secret:}") String webhookSecret
    ) {
        this.jdbcTemplate = jdbcTemplate;
        this.currentUserService = currentUserService;
        this.paymentGateway = paymentGateway;
        this.mockPaymentGateway = mockPaymentGateway;
        this.transactionTemplate = transactionTemplate;
        this.objectMapper = objectMapper;
        this.webhookSecret = webhookSecret;
    }

    public Map<String, Object> createAttempt(
            String authorization,
            String requestPublicId,
            String idempotencyKey,
            Map<String, Object> body
    ) {
        CurrentUserService.CurrentUser user = currentUserService.requireUser(authorization);
        String key = requiredText(idempotencyKey, "Idempotency-Key가 필요합니다.");
        if (key.length() > 120) {
            throw validation("Idempotency-Key는 120자 이하여야 합니다.");
        }
        PaymentMethod method = paymentMethod(body);
        AttemptContext context = transactionTemplate.execute(status -> prepareAttempt(user.internalId(), requestPublicId, key, method));
        if (context == null) {
            throw new IllegalStateException("결제 시도 생성 결과가 없습니다.");
        }

        PaymentGateway.CheckoutSession session;
        try {
            session = paymentGateway.createCheckout(new PaymentGateway.CheckoutRequest(
                    context.merchantPaymentId(), context.orderName(), context.amount(), context.currency(),
                    context.payMethod(), context.easyPayProvider(), context.expiresAt()
            ));
        } catch (RuntimeException exception) {
            jdbcTemplate.update("""
                    UPDATE assembly_payment_attempts
                    SET status = 'FAILED', failure_code = 'PROVIDER_CREATE_FAILED', failure_message = ?, completed_at = now(), updated_at = now()
                    WHERE public_id = ?::uuid AND status = 'READY'
                    """, limitedMessage(exception.getMessage()), context.attemptPublicId());
            throw exception;
        }
        jdbcTemplate.update("""
                UPDATE assembly_payment_attempts
                SET provider_transaction_id = ?, status = CASE WHEN status = 'READY' THEN 'PROCESSING' ELSE status END, updated_at = now()
                WHERE public_id = ?::uuid
                """, session.providerTransactionId(), context.attemptPublicId());

        Map<String, Object> response = attemptViewForUser(context.attemptPublicId(), user.internalId());
        response.put("checkout", checkoutMap(session));
        return response;
    }

    public Map<String, Object> setMockResult(
            String authorization,
            String attemptPublicId,
            Map<String, Object> body
    ) {
        CurrentUserService.CurrentUser user = currentUserService.requireUser(authorization);
        Map<String, Object> attempt = requireAttemptForUser(attemptPublicId, user.internalId(), false);
        String status = text(attempt, "status");
        if (isTerminal(status)) {
            return attemptMap(attempt);
        }
        String result = requiredText(body.get("result"), "Mock 결제 결과가 필요합니다.");
        mockPaymentGateway.setOutcome(text(attempt, "merchant_payment_id"), result);
        return attemptMap(requireAttemptForUser(attemptPublicId, user.internalId(), false));
    }

    public Map<String, Object> completeAttempt(String authorization, String attemptPublicId) {
        CurrentUserService.CurrentUser user = currentUserService.requireUser(authorization);
        Map<String, Object> attempt = requireAttemptForUser(attemptPublicId, user.internalId(), false);
        return verifyAndFinalize(text(attempt, "merchant_payment_id"), user.internalId());
    }

    public Map<String, Object> receiveMockWebhook(String signature, String rawBody) {
        requireWebhookSignature(signature);
        JsonNode payload;
        try {
            payload = objectMapper.readTree(rawBody);
        } catch (Exception exception) {
            throw validation("웹훅 JSON 형식이 올바르지 않습니다.");
        }
        String eventId = requiredJsonText(payload, "eventId");
        String eventType = requiredJsonText(payload, "eventType");
        String merchantPaymentId = requiredJsonText(payload, "merchantPaymentId");
        String result = requiredJsonText(payload, "result");
        String hash = sha256(rawBody);

        List<Map<String, Object>> inserted = jdbcTemplate.queryForList("""
                INSERT INTO payment_webhook_events (
                    provider, event_id, event_type, merchant_payment_id, payload_hash, payload, signature_verified, status
                ) VALUES ('MOCK', ?, ?, ?, ?, ?::jsonb, true, 'RECEIVED')
                ON CONFLICT (provider, event_id) DO NOTHING
                RETURNING id
                """, eventId, eventType, merchantPaymentId, hash, rawBody);
        if (inserted.isEmpty()) {
            return webhookResponse(eventId, "DUPLICATE", merchantPaymentId);
        }

        try {
            mockPaymentGateway.setOutcome(merchantPaymentId, result);
            Map<String, Object> attempt = verifyAndFinalize(merchantPaymentId, null);
            jdbcTemplate.update("""
                    UPDATE payment_webhook_events
                    SET status = 'PROCESSED', processed_at = now(), updated_at = now()
                    WHERE provider = 'MOCK' AND event_id = ?
                    """, eventId);
            Map<String, Object> response = webhookResponse(eventId, "PROCESSED", merchantPaymentId);
            response.put("attempt", attempt);
            return response;
        } catch (RuntimeException exception) {
            jdbcTemplate.update("""
                    UPDATE payment_webhook_events
                    SET status = 'FAILED', error_message = ?, updated_at = now()
                    WHERE provider = 'MOCK' AND event_id = ?
                    """, limitedMessage(exception.getMessage()), eventId);
            throw exception;
        }
    }

    private AttemptContext prepareAttempt(
            Long userId,
            String requestPublicId,
            String idempotencyKey,
            PaymentMethod method
    ) {
        Map<String, Object> ids = jdbcTemplate.queryForList("""
                SELECT ar.id AS request_id, ap.id AS payment_id
                FROM assembly_requests ar
                JOIN assembly_payments ap ON ap.assembly_request_id = ar.id
                WHERE ar.public_id = ?::uuid AND ar.user_id = ?
                """, requestPublicId, userId).stream().findFirst().orElseThrow(this::notFound);
        Map<String, Object> request = jdbcTemplate.queryForList("""
                SELECT id AS request_id, request_no, status AS request_status
                FROM assembly_requests
                WHERE id = ? AND user_id = ?
                FOR UPDATE
                """, longValue(ids, "request_id"), userId).stream().findFirst().orElseThrow(this::notFound);
        Map<String, Object> payment = jdbcTemplate.queryForList("""
                SELECT id AS payment_id, status AS payment_status, amount, currency
                FROM assembly_payments
                WHERE id = ? AND assembly_request_id = ?
                FOR UPDATE
                """, longValue(ids, "payment_id"), longValue(ids, "request_id"))
                .stream().findFirst().orElseThrow(this::notFound);
        payment.putAll(request);
        if (!"MATCHED".equals(text(payment, "request_status"))) {
            throw conflict("기사 매칭 후에만 결제를 시작할 수 있습니다.");
        }
        if ("PAID".equals(text(payment, "payment_status"))) {
            throw conflict("이미 결제가 완료되었습니다.");
        }
        if (!"PENDING".equals(text(payment, "payment_status"))) {
            throw conflict("결제를 시작할 수 없는 상태입니다.");
        }
        Long paymentId = longValue(payment, "payment_id");
        jdbcTemplate.update("""
                UPDATE assembly_payment_attempts
                SET status = 'EXPIRED', failure_code = 'ATTEMPT_EXPIRED', failure_message = '결제 유효 시간이 만료되었습니다.',
                    completed_at = now(), updated_at = now()
                WHERE assembly_payment_id = ? AND status IN ('READY', 'PROCESSING', 'VERIFYING') AND expires_at <= now()
                """, paymentId);

        Map<String, Object> existing = jdbcTemplate.queryForList("""
                SELECT * FROM assembly_payment_attempts
                WHERE assembly_payment_id = ? AND idempotency_key = ?
                FOR UPDATE
                """, paymentId, idempotencyKey).stream().findFirst().orElse(null);
        if (existing == null) {
            existing = jdbcTemplate.queryForList("""
                    SELECT * FROM assembly_payment_attempts
                    WHERE assembly_payment_id = ? AND status IN ('READY', 'PROCESSING', 'VERIFYING')
                    ORDER BY created_at DESC, id DESC LIMIT 1
                    FOR UPDATE
                    """, paymentId).stream().findFirst().orElse(null);
        }
        if (existing != null) {
            return attemptContext(existing, text(payment, "request_no"));
        }

        String merchantPaymentId = "BG-" + UUID.randomUUID().toString().replace("-", "");
        Map<String, Object> created = jdbcTemplate.queryForList("""
                INSERT INTO assembly_payment_attempts (
                    assembly_payment_id, idempotency_key, provider, merchant_payment_id,
                    pay_method, easy_pay_provider, requested_amount, currency, status, expires_at
                ) VALUES (?, ?, 'MOCK', ?, ?, ?, ?, ?, 'READY', now() + interval '30 minutes')
                RETURNING *
                """, paymentId, idempotencyKey, merchantPaymentId, method.payMethod(), method.easyPayProvider(),
                longValue(payment, "amount"), text(payment, "currency")).stream().findFirst().orElseThrow();
        return attemptContext(created, text(payment, "request_no"));
    }

    private Map<String, Object> verifyAndFinalize(String merchantPaymentId, Long userId) {
        VerificationStart start = transactionTemplate.execute(
                status -> beginVerification(merchantPaymentId, userId)
        );
        if (start == null) {
            throw new IllegalStateException("결제 검증 시작 결과가 없습니다.");
        }
        if (start.completedAttempt() != null) {
            return start.completedAttempt();
        }

        // 외부 PG 네트워크 호출은 DB row lock과 transaction을 점유하지 않는다.
        PaymentGateway.VerificationResult verification = paymentGateway.verify(merchantPaymentId);
        Map<String, Object> result = transactionTemplate.execute(
                status -> finalizeVerification(merchantPaymentId, userId, verification)
        );
        if (result == null) {
            throw new IllegalStateException("결제 검증 결과가 없습니다.");
        }
        return result;
    }

    private VerificationStart beginVerification(String merchantPaymentId, Long userId) {
        Map<String, Object> attempt = lockPaymentContext(merchantPaymentId, userId);
        requireRequestCanCompletePayment(attempt);

        String attemptStatus = text(attempt, "status");
        if (isTerminal(attemptStatus)) {
            return new VerificationStart(attemptMap(attempt));
        }
        requirePendingPayment(attempt);
        if (OffsetDateTime.now().isAfter(offsetDateTime(attempt.get("expires_at")))) {
            requireOneRow(jdbcTemplate.update("""
                    UPDATE assembly_payment_attempts
                    SET status = 'EXPIRED', failure_code = 'ATTEMPT_EXPIRED', failure_message = '결제 유효 시간이 만료되었습니다.',
                        completed_at = now(), updated_at = now()
                    WHERE id = ? AND status IN ('READY', 'PROCESSING')
                    """, longValue(attempt, "id")), "결제 시도 만료 상태가 이미 변경되었습니다.");
            return new VerificationStart(attemptMap(reloadAttempt(longValue(attempt, "id"))));
        }
        if (!"READY".equals(attemptStatus) && !"PROCESSING".equals(attemptStatus)) {
            throw conflict("이미 결제 검증이 진행 중입니다.");
        }
        requireOneRow(jdbcTemplate.update("""
                UPDATE assembly_payment_attempts
                SET status = 'VERIFYING', updated_at = now()
                WHERE id = ? AND status IN ('READY', 'PROCESSING')
                """, longValue(attempt, "id")), "결제 검증 시작 상태가 이미 변경되었습니다.");
        return new VerificationStart(null);
    }

    private Map<String, Object> finalizeVerification(
            String merchantPaymentId,
            Long userId,
            PaymentGateway.VerificationResult verification
    ) {
        Map<String, Object> attempt = lockPaymentContext(merchantPaymentId, userId);
        requireRequestCanCompletePayment(attempt);
        requirePendingPayment(attempt);
        if (!"VERIFYING".equals(text(attempt, "status"))) {
            throw conflict("결제 검증 상태가 이미 변경되었습니다.");
        }
        if (OffsetDateTime.now().isAfter(offsetDateTime(attempt.get("expires_at")))) {
            requireOneRow(jdbcTemplate.update("""
                    UPDATE assembly_payment_attempts
                    SET status = 'EXPIRED', failure_code = 'ATTEMPT_EXPIRED', failure_message = '결제 유효 시간이 만료되었습니다.',
                        completed_at = now(), updated_at = now()
                    WHERE id = ? AND status = 'VERIFYING'
                    """, longValue(attempt, "id")), "결제 시도 만료 상태가 이미 변경되었습니다.");
            return attemptMap(reloadAttempt(longValue(attempt, "id")));
        }
        if (verification.status() == PaymentGateway.VerificationStatus.PENDING) {
            requireOneRow(jdbcTemplate.update("""
                    UPDATE assembly_payment_attempts
                    SET status = 'PROCESSING', updated_at = now()
                    WHERE id = ? AND status = 'VERIFYING'
                    """, longValue(attempt, "id")), "결제 대기 상태가 이미 변경되었습니다.");
            return attemptMap(reloadAttempt(longValue(attempt, "id")));
        }
        if (verification.status() == PaymentGateway.VerificationStatus.PAID
                && verificationMatches(attempt, verification)) {
            requireOneRow(jdbcTemplate.update("""
                    UPDATE assembly_payments
                    SET provider = 'MOCK', method = ?, currency = ?, paid_amount = ?, status = 'PAID',
                        paid_at = COALESCE(paid_at, now()), verified_at = now(), updated_at = now()
                    WHERE id = ? AND status = 'PENDING'
                    """, text(attempt, "pay_method"), verification.currency(), verification.amount(),
                    longValue(attempt, "payment_id")), "결제 상태가 이미 변경되었습니다.");
            requireOneRow(jdbcTemplate.update("""
                    UPDATE assembly_payment_attempts
                    SET status = 'SUCCEEDED', provider_transaction_id = ?, pg_transaction_id = ?, approved_amount = ?,
                        verified_at = now(), completed_at = now(), updated_at = now(), failure_code = NULL, failure_message = NULL
                    WHERE id = ? AND status = 'VERIFYING'
                    """, verification.providerTransactionId(), verification.pgTransactionId(), verification.amount(),
                    longValue(attempt, "id")), "결제 시도 상태가 이미 변경되었습니다.");
            return attemptMap(reloadAttempt(longValue(attempt, "id")));
        }

        String finalStatus = verification.status() == PaymentGateway.VerificationStatus.CANCELLED ? "CANCELLED" : "FAILED";
        String failureCode = verification.status() == PaymentGateway.VerificationStatus.PAID
                ? "PAYMENT_VERIFICATION_MISMATCH" : verification.failureCode();
        String failureMessage = verification.status() == PaymentGateway.VerificationStatus.PAID
                ? "PG 조회 결과와 서버 주문 정보가 일치하지 않습니다." : verification.failureMessage();
        requireOneRow(jdbcTemplate.update("""
                UPDATE assembly_payment_attempts
                SET status = ?, provider_transaction_id = COALESCE(?, provider_transaction_id), approved_amount = ?,
                    failure_code = ?, failure_message = ?, verified_at = now(), completed_at = now(), updated_at = now()
                WHERE id = ? AND status = 'VERIFYING'
                """, finalStatus, verification.providerTransactionId(), verification.amount(), failureCode,
                limitedMessage(failureMessage), longValue(attempt, "id")), "결제 시도 상태가 이미 변경되었습니다.");
        return attemptMap(reloadAttempt(longValue(attempt, "id")));
    }

    private Map<String, Object> lockPaymentContext(String merchantPaymentId, Long userId) {
        String ownerClause = userId == null ? "" : " AND ar.user_id = ?";
        Object[] params = userId == null
                ? new Object[]{merchantPaymentId}
                : new Object[]{merchantPaymentId, userId};
        Map<String, Object> ids = jdbcTemplate.queryForList("""
                SELECT ar.id AS request_id, ap.id AS payment_id, apa.id AS attempt_id
                FROM assembly_requests ar
                JOIN assembly_payments ap ON ap.assembly_request_id = ar.id
                JOIN assembly_payment_attempts apa ON apa.assembly_payment_id = ap.id
                WHERE apa.merchant_payment_id = ?
                """ + ownerClause, params).stream().findFirst().orElseThrow(this::notFound);

        Map<String, Object> request = jdbcTemplate.queryForList("""
                SELECT id AS request_id, status AS request_status
                FROM assembly_requests
                WHERE id = ?
                FOR UPDATE
                """, longValue(ids, "request_id")).stream().findFirst().orElseThrow(this::notFound);
        Map<String, Object> payment = jdbcTemplate.queryForList("""
                SELECT id AS payment_id, status AS payment_status, amount AS payment_amount,
                       currency AS payment_currency
                FROM assembly_payments
                WHERE id = ? AND assembly_request_id = ?
                FOR UPDATE
                """, longValue(ids, "payment_id"), longValue(ids, "request_id"))
                .stream().findFirst().orElseThrow(this::notFound);
        Map<String, Object> attempt = jdbcTemplate.queryForList("""
                SELECT *
                FROM assembly_payment_attempts
                WHERE id = ? AND assembly_payment_id = ? AND merchant_payment_id = ?
                FOR UPDATE
                """, longValue(ids, "attempt_id"), longValue(ids, "payment_id"), merchantPaymentId)
                .stream().findFirst().orElseThrow(this::notFound);
        attempt.putAll(request);
        attempt.putAll(payment);
        return attempt;
    }

    private static void requireRequestCanCompletePayment(Map<String, Object> attempt) {
        if (!"MATCHED".equals(text(attempt, "request_status"))) {
            throw conflict("취소되었거나 결제를 완료할 수 없는 조립 요청 상태입니다.");
        }
    }

    private static void requirePendingPayment(Map<String, Object> attempt) {
        if (!"PENDING".equals(text(attempt, "payment_status"))) {
            throw conflict("결제 상태가 이미 변경되었습니다.");
        }
    }

    private static void requireOneRow(int updatedRows, String message) {
        if (updatedRows != 1) {
            throw conflict(message);
        }
    }

    private boolean verificationMatches(Map<String, Object> attempt, PaymentGateway.VerificationResult result) {
        return text(attempt, "merchant_payment_id").equals(result.merchantPaymentId())
                && longValue(attempt, "payment_amount").equals(result.amount())
                && text(attempt, "payment_currency").equals(result.currency())
                && text(attempt, "pay_method").equals(result.payMethod())
                && nullableEquals(text(attempt, "easy_pay_provider"), result.easyPayProvider());
    }

    private Map<String, Object> attemptViewForUser(String attemptPublicId, Long userId) {
        return attemptMap(requireAttemptForUser(attemptPublicId, userId, false));
    }

    private Map<String, Object> requireAttemptForUser(String attemptPublicId, Long userId, boolean forUpdate) {
        String lock = forUpdate ? " FOR UPDATE OF apa" : "";
        return jdbcTemplate.queryForList("""
                SELECT apa.* FROM assembly_payment_attempts apa
                JOIN assembly_payments ap ON ap.id = apa.assembly_payment_id
                JOIN assembly_requests ar ON ar.id = ap.assembly_request_id
                WHERE apa.public_id = ?::uuid AND ar.user_id = ?
                """ + lock, attemptPublicId, userId).stream().findFirst().orElseThrow(this::notFound);
    }

    private Map<String, Object> reloadAttempt(Long id) {
        return jdbcTemplate.queryForList("SELECT * FROM assembly_payment_attempts WHERE id = ?", id)
                .stream().findFirst().orElseThrow(this::notFound);
    }

    private AttemptContext attemptContext(Map<String, Object> row, String requestNo) {
        return new AttemptContext(
                text(row, "public_id"), text(row, "merchant_payment_id"), "Dazzajo 조립 " + requestNo,
                longValue(row, "requested_amount"), text(row, "currency"), text(row, "pay_method"),
                text(row, "easy_pay_provider"), offsetDateTime(row.get("expires_at"))
        );
    }

    private Map<String, Object> attemptMap(Map<String, Object> row) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", text(row, "public_id"));
        result.put("provider", text(row, "provider"));
        result.put("merchantPaymentId", text(row, "merchant_payment_id"));
        result.put("providerTransactionId", text(row, "provider_transaction_id"));
        result.put("pgTransactionId", text(row, "pg_transaction_id"));
        result.put("payMethod", text(row, "pay_method"));
        result.put("easyPayProvider", text(row, "easy_pay_provider"));
        result.put("requestedAmount", longValue(row, "requested_amount"));
        result.put("approvedAmount", longValue(row, "approved_amount"));
        result.put("currency", text(row, "currency"));
        result.put("status", text(row, "status"));
        result.put("failureCode", text(row, "failure_code"));
        result.put("failureMessage", text(row, "failure_message"));
        result.put("expiresAt", row.get("expires_at"));
        result.put("verifiedAt", row.get("verified_at"));
        result.put("completedAt", row.get("completed_at"));
        result.put("createdAt", row.get("created_at"));
        result.put("updatedAt", row.get("updated_at"));
        return result;
    }

    private Map<String, Object> checkoutMap(PaymentGateway.CheckoutSession session) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("provider", session.provider());
        result.put("providerTransactionId", session.providerTransactionId());
        result.put("merchantPaymentId", session.merchantPaymentId());
        result.put("orderName", session.orderName());
        result.put("amount", session.amount());
        result.put("currency", session.currency());
        result.put("payMethod", session.payMethod());
        result.put("easyPayProvider", session.easyPayProvider());
        result.put("expiresAt", session.expiresAt());
        return result;
    }

    private Map<String, Object> webhookResponse(String eventId, String status, String merchantPaymentId) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("eventId", eventId);
        result.put("status", status);
        result.put("merchantPaymentId", merchantPaymentId);
        return result;
    }

    private PaymentMethod paymentMethod(Map<String, Object> body) {
        String value = requiredText(body.get("method"), "결제 수단이 필요합니다.").toUpperCase();
        return switch (value) {
            case "CARD" -> new PaymentMethod("CARD", null);
            case "KAKAOPAY" -> new PaymentMethod("EASY_PAY", "KAKAOPAY");
            case "TOSSPAY" -> new PaymentMethod("EASY_PAY", "TOSSPAY");
            default -> throw validation("method는 CARD, KAKAOPAY, TOSSPAY 중 하나여야 합니다.");
        };
    }

    private void requireWebhookSignature(String signature) {
        if (webhookSecret == null || webhookSecret.isBlank()) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "WEBHOOK_DISABLED", "Mock 웹훅 비밀키가 설정되지 않았습니다.");
        }
        byte[] expected = webhookSecret.getBytes(StandardCharsets.UTF_8);
        byte[] actual = signature == null ? new byte[0] : signature.getBytes(StandardCharsets.UTF_8);
        if (!MessageDigest.isEqual(expected, actual)) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_WEBHOOK_SIGNATURE", "웹훅 서명이 올바르지 않습니다.");
        }
    }

    private String requiredJsonText(JsonNode payload, String field) {
        JsonNode value = payload.get(field);
        if (value == null || !value.isTextual() || value.asText().isBlank()) {
            throw validation(field + " 값이 필요합니다.");
        }
        return value.asText().trim();
    }

    private static String requiredText(Object value, String message) {
        if (value == null || value.toString().isBlank()) {
            throw validation(message);
        }
        return value.toString().trim();
    }

    private static String text(Map<String, Object> row, String key) {
        Object value = row.get(key);
        return value == null ? null : value.toString();
    }

    private static Long longValue(Map<String, Object> row, String key) {
        Object value = row.get(key);
        if (value instanceof Number number) {
            return number.longValue();
        }
        return value == null ? null : Long.valueOf(value.toString());
    }

    static OffsetDateTime offsetDateTime(Object value) {
        if (value instanceof OffsetDateTime offsetDateTime) {
            return offsetDateTime;
        }
        if (value instanceof Timestamp timestamp) {
            return timestamp.toInstant().atOffset(ZoneOffset.UTC);
        }
        if (value instanceof Instant instant) {
            return instant.atOffset(ZoneOffset.UTC);
        }
        if (value instanceof ZonedDateTime zonedDateTime) {
            return zonedDateTime.toOffsetDateTime();
        }
        if (value instanceof LocalDateTime localDateTime) {
            return localDateTime.atOffset(ZoneOffset.UTC);
        }
        if (value == null) {
            throw new IllegalArgumentException("결제 시각 값이 없습니다.");
        }
        String normalized = value.toString().trim().replace(' ', 'T');
        try {
            return OffsetDateTime.parse(normalized);
        } catch (DateTimeParseException ignored) {
            try {
                return LocalDateTime.parse(normalized).atOffset(ZoneOffset.UTC);
            } catch (DateTimeParseException invalid) {
                throw new IllegalArgumentException("결제 시각 형식이 올바르지 않습니다: " + value, invalid);
            }
        }
    }

    private static boolean nullableEquals(Object left, Object right) {
        return left == null ? right == null : left.equals(right);
    }

    private static boolean isTerminal(String status) {
        return "SUCCEEDED".equals(status) || "FAILED".equals(status) || "CANCELLED".equals(status) || "EXPIRED".equals(status);
    }

    private static String limitedMessage(String message) {
        if (message == null) return null;
        return message.length() <= 500 ? message : message.substring(0, 500);
    }

    private static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception exception) {
            throw new IllegalStateException("웹훅 payload hash 생성 실패", exception);
        }
    }

    private ApiException notFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "결제 정보를 찾을 수 없습니다.");
    }

    private static ApiException validation(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", message);
    }

    private static ApiException conflict(String message) {
        return new ApiException(HttpStatus.CONFLICT, "CONFLICT_STATE", message);
    }

    private record PaymentMethod(String payMethod, String easyPayProvider) {
    }

    private record AttemptContext(
            String attemptPublicId,
            String merchantPaymentId,
            String orderName,
            long amount,
            String currency,
            String payMethod,
            String easyPayProvider,
            OffsetDateTime expiresAt
    ) {
    }

    private record VerificationStart(Map<String, Object> completedAttempt) {
    }
}

package com.buildgraph.prototype.assembly;

import static org.junit.jupiter.api.Assertions.assertAll;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.buildgraph.prototype.build.BuildGraphService;
import com.buildgraph.prototype.common.ApiException;
import com.buildgraph.prototype.quote.QuoteDraftQueryService;
import com.buildgraph.prototype.user.CurrentUserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;

@Tag("postgres-integration")
class PaymentCancelRacePostgresTest {
    private static final long TIMEOUT_SECONDS = 10;

    @Test
    void requestCancellationLockWinsAndPaymentCompletionReturnsConflict() throws Exception {
        requirePostgresRaceTest();

        Fixture fixture = createFixture();
        PaidGateway gateway = new PaidGateway();
        ServiceHarness services = serviceHarness(fixture, gateway);
        CountDownLatch requestLocked = new CountDownLatch(1);
        CountDownLatch releaseCancellation = new CountDownLatch(1);
        CountDownLatch completionStarted = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        Future<Map<String, Object>> cancellationFuture = null;
        Future<OperationResult> completionFuture = null;
        try {
            cancellationFuture = executor.submit(() -> services.transactionTemplate().execute(status -> {
                services.jdbcTemplate().queryForObject(
                        "SELECT id FROM assembly_requests WHERE id = ? FOR UPDATE",
                        Long.class,
                        fixture.requestId()
                );
                requestLocked.countDown();
                awaitUnchecked(releaseCancellation, "cancellation transaction was not released");
                return services.brokerageService().cancelForUser(
                        "Bearer user", fixture.requestPublicId(), Map.of("reason", "race regression")
                );
            }));
            await(requestLocked, "cancellation transaction did not lock the request");

            completionFuture = executor.submit(() -> {
                completionStarted.countDown();
                try {
                    return new OperationResult(
                            services.paymentService().completeAttempt("Bearer user", fixture.attemptPublicId()),
                            null
                    );
                } catch (Throwable error) {
                    return new OperationResult(null, error);
                }
            });
            await(completionStarted, "payment completion did not start");
            releaseCancellation.countDown();

            Map<String, Object> cancellation = cancellationFuture.get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
            OperationResult completion = completionFuture.get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
            assertEquals("CANCELLED", cancellation.get("status"));
            assertConflict(completion.error());

            FinalState finalState = readFinalState(fixture);
            logFinalState("cancellation wins", finalState);
            assertAll(
                    () -> assertEquals("CANCELLED", finalState.requestStatus()),
                    () -> assertEquals("CANCELLED", finalState.paymentStatus()),
                    () -> assertEquals("CANCELLED", finalState.attemptStatus()),
                    () -> assertNull(finalState.paidAt()),
                    () -> assertNull(finalState.refundedAt()),
                    () -> assertEquals(1L, finalState.cancelledHistoryCount()),
                    () -> assertEquals(0L, finalState.refundRecordCount()),
                    () -> assertEquals(0, gateway.verifyCalls()),
                    () -> assertFalse(isForbiddenCombination(finalState))
            );
        } finally {
            releaseCancellation.countDown();
            waitForCompletion(cancellationFuture);
            waitForCompletion(completionFuture);
            shutdown(executor);
            deleteFixture(fixture);
        }
    }

    @Test
    void verifyingAttemptMakesUserCancellationReturnConflict() throws Exception {
        requirePostgresRaceTest();

        Fixture fixture = createFixture();
        BlockingPaidGateway gateway = new BlockingPaidGateway();
        ServiceHarness services = serviceHarness(fixture, gateway);
        ExecutorService executor = Executors.newSingleThreadExecutor();
        Future<OperationResult> completionFuture = null;
        try {
            completionFuture = executor.submit(() -> {
                try {
                    return new OperationResult(
                            services.paymentService().completeAttempt("Bearer user", fixture.attemptPublicId()),
                            null
                    );
                } catch (Throwable error) {
                    return new OperationResult(null, error);
                }
            });
            await(gateway.verificationStarted(), "payment verification did not start");
            assertEquals("VERIFYING", readFinalState(fixture).attemptStatus());

            ApiException cancellationError = assertThrows(ApiException.class, () ->
                    services.transactionTemplate().execute(status -> services.brokerageService().cancelForUser(
                            "Bearer user", fixture.requestPublicId(), Map.of("reason", "too late")
                    ))
            );
            assertConflict(cancellationError);

            gateway.releaseVerification();
            OperationResult completion = completionFuture.get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
            assertNull(completion.error());
            assertNotNull(completion.response());
            assertEquals("SUCCEEDED", completion.response().get("status"));

            FinalState finalState = readFinalState(fixture);
            logFinalState("verification wins", finalState);
            assertAll(
                    () -> assertEquals("MATCHED", finalState.requestStatus()),
                    () -> assertEquals("PAID", finalState.paymentStatus()),
                    () -> assertEquals("SUCCEEDED", finalState.attemptStatus()),
                    () -> assertNotNull(finalState.paidAt()),
                    () -> assertNull(finalState.refundedAt()),
                    () -> assertEquals(0L, finalState.cancelledHistoryCount()),
                    () -> assertEquals(0L, finalState.refundRecordCount()),
                    () -> assertFalse(isForbiddenCombination(finalState))
            );
        } finally {
            gateway.releaseVerification();
            waitForCompletion(completionFuture);
            shutdown(executor);
            deleteFixture(fixture);
        }
    }

    @Test
    void normalPaymentEndsPaidAndSucceeded() throws Exception {
        requirePostgresRaceTest();

        Fixture fixture = createFixture();
        ServiceHarness services = serviceHarness(fixture, new PaidGateway());
        try {
            Map<String, Object> response = services.paymentService()
                    .completeAttempt("Bearer user", fixture.attemptPublicId());
            FinalState finalState = readFinalState(fixture);
            logFinalState("normal payment", finalState);

            assertAll(
                    () -> assertEquals("SUCCEEDED", response.get("status")),
                    () -> assertEquals("MATCHED", finalState.requestStatus()),
                    () -> assertEquals("PAID", finalState.paymentStatus()),
                    () -> assertEquals("SUCCEEDED", finalState.attemptStatus()),
                    () -> assertNotNull(finalState.paidAt()),
                    () -> assertNull(finalState.refundedAt()),
                    () -> assertFalse(isForbiddenCombination(finalState))
            );
        } finally {
            deleteFixture(fixture);
        }
    }

    @Test
    void normalCancellationEndsRequestPaymentAndAttemptCancelled() throws Exception {
        requirePostgresRaceTest();

        Fixture fixture = createFixture();
        ServiceHarness services = serviceHarness(fixture, new PaidGateway());
        try {
            Map<String, Object> response = services.transactionTemplate().execute(status ->
                    services.brokerageService().cancelForUser(
                            "Bearer user", fixture.requestPublicId(), Map.of("reason", "normal cancellation")
                    )
            );
            FinalState finalState = readFinalState(fixture);
            logFinalState("normal cancellation", finalState);

            assertAll(
                    () -> assertNotNull(response),
                    () -> assertEquals("CANCELLED", response.get("status")),
                    () -> assertEquals("CANCELLED", finalState.requestStatus()),
                    () -> assertEquals("CANCELLED", finalState.paymentStatus()),
                    () -> assertEquals("CANCELLED", finalState.attemptStatus()),
                    () -> assertNull(finalState.paidAt()),
                    () -> assertNull(finalState.refundedAt()),
                    () -> assertEquals(1L, finalState.cancelledHistoryCount()),
                    () -> assertEquals(0L, finalState.refundRecordCount()),
                    () -> assertFalse(isForbiddenCombination(finalState))
            );
        } finally {
            deleteFixture(fixture);
        }
    }

    private static ServiceHarness serviceHarness(Fixture fixture, PaymentGateway gateway) {
        DriverManagerDataSource dataSource = new DriverManagerDataSource(
                databaseUrl(), databaseUsername(), databasePassword()
        );
        JdbcTemplate jdbcTemplate = new JdbcTemplate(dataSource);
        TransactionTemplate transactionTemplate = new TransactionTemplate(
                new DataSourceTransactionManager(dataSource)
        );
        CurrentUserService currentUserService = mock(CurrentUserService.class);
        when(currentUserService.requireUser("Bearer user")).thenReturn(new CurrentUserService.CurrentUser(
                fixture.userId(), "race-user", "user@example.com", "Race User", "USER", null
        ));
        AssemblyPaymentService paymentService = new AssemblyPaymentService(
                jdbcTemplate,
                currentUserService,
                gateway,
                mock(MockPaymentGateway.class),
                transactionTemplate,
                new ObjectMapper(),
                "race-secret"
        );
        AssemblyBrokerageService brokerageService = new AssemblyBrokerageService(
                jdbcTemplate,
                currentUserService,
                mock(QuoteDraftQueryService.class),
                mock(BuildGraphService.class),
                mock(BuildGraphPointService.class)
        );
        return new ServiceHarness(jdbcTemplate, transactionTemplate, paymentService, brokerageService);
    }

    private static Fixture createFixture() throws Exception {
        String marker = UUID.randomUUID().toString().replace("-", "");
        try (Connection connection = openConnection()) {
            connection.setAutoCommit(false);
            try {
                long userId = queryRequiredLong(connection,
                        "SELECT id FROM users WHERE email = 'user@example.com'",
                        "seed user user@example.com is required");
                long technicianId = queryRequiredLong(connection,
                        "SELECT id FROM technicians ORDER BY id LIMIT 1",
                        "at least one technician is required");

                long requestId;
                String requestPublicId;
                try (PreparedStatement statement = connection.prepareStatement("""
                        INSERT INTO assembly_requests (
                            request_no, user_id, idempotency_key, status, service_type, region,
                            preferred_date, delivery_method, as_policy_accepted,
                            estimated_parts_price, item_count, quote_signature, request_fingerprint,
                            compatibility_snapshot, created_at, updated_at
                        ) VALUES (?, ?, ?, 'MATCHED', 'ASSEMBLY_ONLY', '서울',
                                  current_date + 1, 'PICKUP', true,
                                  100000, 1, ?, ?, '{}'::jsonb, now(), now())
                        RETURNING id, public_id::text
                        """)) {
                    statement.setString(1, "RACE-" + marker);
                    statement.setLong(2, userId);
                    statement.setString(3, "race-request-" + marker);
                    statement.setString(4, marker);
                    statement.setString(5, marker);
                    try (ResultSet rows = statement.executeQuery()) {
                        requireRow(rows, "request fixture was not inserted");
                        requestId = rows.getLong("id");
                        requestPublicId = rows.getString("public_id");
                    }
                }

                long offerId;
                try (PreparedStatement statement = connection.prepareStatement("""
                        INSERT INTO assembly_offers (
                            assembly_request_id, technician_id, status, technician_snapshot,
                            confirmed_parts_price, assembly_fee, delivery_fee, final_price,
                            lead_time_days, stock_status, selected_at, created_at, updated_at
                        ) VALUES (?, ?, 'SELECTED', '{}'::jsonb,
                                  100000, 10000, 0, 110000,
                                  1, 'race fixture', now(), now(), now())
                        RETURNING id
                        """)) {
                    statement.setLong(1, requestId);
                    statement.setLong(2, technicianId);
                    try (ResultSet rows = statement.executeQuery()) {
                        requireRow(rows, "offer fixture was not inserted");
                        offerId = rows.getLong("id");
                    }
                }
                try (PreparedStatement statement = connection.prepareStatement(
                        "UPDATE assembly_requests SET selected_offer_id = ? WHERE id = ?")) {
                    statement.setLong(1, offerId);
                    statement.setLong(2, requestId);
                    statement.executeUpdate();
                }

                long paymentId;
                try (PreparedStatement statement = connection.prepareStatement("""
                        INSERT INTO assembly_payments (
                            assembly_request_id, amount, method, provider, currency,
                            paid_amount, status, created_at, updated_at
                        ) VALUES (?, 110000, 'VIRTUAL', 'LEGACY_VIRTUAL', 'KRW',
                                  0, 'PENDING', now(), now())
                        RETURNING id
                        """)) {
                    statement.setLong(1, requestId);
                    try (ResultSet rows = statement.executeQuery()) {
                        requireRow(rows, "payment fixture was not inserted");
                        paymentId = rows.getLong("id");
                    }
                }

                long attemptId;
                String attemptPublicId;
                String merchantPaymentId = "BG-RACE-" + marker;
                try (PreparedStatement statement = connection.prepareStatement("""
                        INSERT INTO assembly_payment_attempts (
                            assembly_payment_id, idempotency_key, provider, merchant_payment_id,
                            pay_method, requested_amount, currency, status, expires_at,
                            created_at, updated_at
                        ) VALUES (?, ?, 'MOCK', ?, 'CARD', 110000, 'KRW', 'PROCESSING',
                                  now() + interval '30 minutes', now(), now())
                        RETURNING id, public_id::text
                        """)) {
                    statement.setLong(1, paymentId);
                    statement.setString(2, "race-attempt-" + marker);
                    statement.setString(3, merchantPaymentId);
                    try (ResultSet rows = statement.executeQuery()) {
                        requireRow(rows, "payment attempt fixture was not inserted");
                        attemptId = rows.getLong("id");
                        attemptPublicId = rows.getString("public_id");
                    }
                }

                try (PreparedStatement statement = connection.prepareStatement("""
                        INSERT INTO assembly_request_status_history (
                            assembly_request_id, actor_user_id, from_status, to_status, note, created_at
                        ) VALUES (?, ?, 'OFFERED', 'MATCHED', 'race fixture', now())
                        """)) {
                    statement.setLong(1, requestId);
                    statement.setLong(2, userId);
                    statement.executeUpdate();
                }

                connection.commit();
                return new Fixture(
                        marker, userId, requestId, requestPublicId, offerId, paymentId,
                        attemptId, attemptPublicId, merchantPaymentId
                );
            } catch (Exception exception) {
                connection.rollback();
                throw exception;
            }
        }
    }

    private static FinalState readFinalState(Fixture fixture) throws Exception {
        try (Connection connection = openConnection();
                PreparedStatement statement = connection.prepareStatement("""
                        SELECT ar.status AS request_status,
                               ap.status AS payment_status,
                               apa.status AS attempt_status,
                               ap.paid_at,
                               ap.refunded_at,
                               (SELECT count(*)
                                FROM assembly_request_status_history history
                                WHERE history.assembly_request_id = ar.id
                                  AND history.to_status = 'CANCELLED') AS cancelled_history_count,
                               (SELECT count(*)
                                FROM point_transactions points
                                WHERE points.assembly_payment_id = ap.id
                                  AND points.transaction_type = 'REFUND') AS refund_record_count
                        FROM assembly_requests ar
                        JOIN assembly_payments ap ON ap.assembly_request_id = ar.id
                        JOIN assembly_payment_attempts apa ON apa.assembly_payment_id = ap.id
                        WHERE ar.id = ? AND apa.id = ?
                        """)) {
            statement.setLong(1, fixture.requestId());
            statement.setLong(2, fixture.attemptId());
            try (ResultSet rows = statement.executeQuery()) {
                requireRow(rows, "final race state was not found");
                return new FinalState(
                        rows.getString("request_status"),
                        rows.getString("payment_status"),
                        rows.getString("attempt_status"),
                        rows.getObject("paid_at", OffsetDateTime.class),
                        rows.getObject("refunded_at", OffsetDateTime.class),
                        rows.getLong("cancelled_history_count"),
                        rows.getLong("refund_record_count")
                );
            }
        }
    }

    private static void deleteFixture(Fixture fixture) throws Exception {
        try (Connection connection = openConnection()) {
            connection.setAutoCommit(false);
            try {
                try (PreparedStatement statement = connection.prepareStatement(
                        "DELETE FROM point_transactions WHERE assembly_payment_id = ?")) {
                    statement.setLong(1, fixture.paymentId());
                    statement.executeUpdate();
                }
                try (PreparedStatement statement = connection.prepareStatement(
                        "UPDATE assembly_requests SET selected_offer_id = NULL WHERE id = ?")) {
                    statement.setLong(1, fixture.requestId());
                    statement.executeUpdate();
                }
                try (PreparedStatement statement = connection.prepareStatement(
                        "DELETE FROM assembly_requests WHERE id = ?")) {
                    statement.setLong(1, fixture.requestId());
                    statement.executeUpdate();
                }
                connection.commit();
            } catch (Exception exception) {
                connection.rollback();
                throw exception;
            }
        }
    }

    private static Connection openConnection() throws SQLException {
        return DriverManager.getConnection(databaseUrl(), databaseUsername(), databasePassword());
    }

    private static String databaseUrl() {
        return environment("PAYMENT_CANCEL_RACE_DB_URL",
                environment("SPRING_DATASOURCE_URL", "jdbc:postgresql://localhost:55432/buildgraph"));
    }

    private static String databaseUsername() {
        return environment("PAYMENT_CANCEL_RACE_DB_USERNAME",
                environment("SPRING_DATASOURCE_USERNAME", "buildgraph"));
    }

    private static String databasePassword() {
        return environment("PAYMENT_CANCEL_RACE_DB_PASSWORD",
                environment("SPRING_DATASOURCE_PASSWORD", "buildgraph"));
    }

    private static void requirePostgresRaceTest() {
        Assumptions.assumeTrue(
                Boolean.parseBoolean(environment("PAYMENT_CANCEL_RACE_TEST_ENABLED", "false")),
                "Set PAYMENT_CANCEL_RACE_TEST_ENABLED=true only for a disposable PostgreSQL database"
        );
    }

    private static long queryRequiredLong(Connection connection, String sql, String message) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(sql);
                ResultSet rows = statement.executeQuery()) {
            requireRow(rows, message);
            return rows.getLong(1);
        }
    }

    private static void requireRow(ResultSet rows, String message) throws SQLException {
        if (!rows.next()) {
            throw new IllegalStateException(message);
        }
    }

    private static void assertConflict(Throwable error) {
        assertNotNull(error);
        assertEquals(ApiException.class, error.getClass());
        ApiException apiException = (ApiException) error;
        assertAll(
                () -> assertEquals(HttpStatus.CONFLICT, apiException.status()),
                () -> assertEquals("CONFLICT_STATE", apiException.code())
        );
    }

    private static boolean isForbiddenCombination(FinalState state) {
        return "CANCELLED".equals(state.requestStatus()) && "PAID".equals(state.paymentStatus());
    }

    private static void await(CountDownLatch latch, String message) throws InterruptedException {
        if (!latch.await(TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
            throw new IllegalStateException(message);
        }
    }

    private static void awaitUnchecked(CountDownLatch latch, String message) {
        try {
            await(latch, message);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(message, exception);
        }
    }

    private static void waitForCompletion(Future<?> future) {
        if (future == null || future.isDone()) {
            return;
        }
        try {
            future.get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
        } catch (Exception ignored) {
            future.cancel(true);
        }
    }

    private static void shutdown(ExecutorService executor) throws InterruptedException {
        executor.shutdownNow();
        executor.awaitTermination(TIMEOUT_SECONDS, TimeUnit.SECONDS);
    }

    private static String environment(String name, String defaultValue) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? defaultValue : value;
    }

    private static void logFinalState(String scenario, FinalState state) {
        System.out.printf(
                "%s: request=%s, payment=%s, attempt=%s, paid_at=%s, refunded_at=%s, "
                        + "cancelled_history=%d, refund_records=%d%n",
                scenario,
                state.requestStatus(),
                state.paymentStatus(),
                state.attemptStatus(),
                state.paidAt(),
                state.refundedAt(),
                state.cancelledHistoryCount(),
                state.refundRecordCount()
        );
    }

    private static class PaidGateway implements PaymentGateway {
        private int verifyCalls;

        @Override
        public String provider() {
            return "MOCK";
        }

        @Override
        public CheckoutSession createCheckout(CheckoutRequest request) {
            throw new UnsupportedOperationException("not used in this test");
        }

        @Override
        public VerificationResult verify(String merchantPaymentId) {
            verifyCalls += 1;
            return new VerificationResult(
                    VerificationStatus.PAID,
                    "provider-" + merchantPaymentId,
                    "pg-" + merchantPaymentId,
                    merchantPaymentId,
                    110_000L,
                    "KRW",
                    "CARD",
                    null,
                    null,
                    null
            );
        }

        int verifyCalls() {
            return verifyCalls;
        }
    }

    private static final class BlockingPaidGateway extends PaidGateway {
        private final CountDownLatch verificationStarted = new CountDownLatch(1);
        private final CountDownLatch releaseVerification = new CountDownLatch(1);

        @Override
        public VerificationResult verify(String merchantPaymentId) {
            verificationStarted.countDown();
            awaitUnchecked(releaseVerification, "payment verification was not released");
            return super.verify(merchantPaymentId);
        }

        CountDownLatch verificationStarted() {
            return verificationStarted;
        }

        void releaseVerification() {
            releaseVerification.countDown();
        }
    }

    private record ServiceHarness(
            JdbcTemplate jdbcTemplate,
            TransactionTemplate transactionTemplate,
            AssemblyPaymentService paymentService,
            AssemblyBrokerageService brokerageService
    ) {
    }

    private record OperationResult(Map<String, Object> response, Throwable error) {
    }

    private record Fixture(
            String marker,
            long userId,
            long requestId,
            String requestPublicId,
            long offerId,
            long paymentId,
            long attemptId,
            String attemptPublicId,
            String merchantPaymentId
    ) {
    }

    private record FinalState(
            String requestStatus,
            String paymentStatus,
            String attemptStatus,
            OffsetDateTime paidAt,
            OffsetDateTime refundedAt,
            long cancelledHistoryCount,
            long refundRecordCount
    ) {
    }
}

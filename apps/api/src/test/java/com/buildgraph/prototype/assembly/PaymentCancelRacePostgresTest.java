package com.buildgraph.prototype.assembly;

import static org.junit.jupiter.api.Assertions.assertAll;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

@Tag("postgres-integration")
class PaymentCancelRacePostgresTest {
    private static final long TIMEOUT_SECONDS = 10;

    @Test
    void reproducesCancelledRequestWithPaidSucceededAttempt() throws Exception {
        requirePostgresRaceTest();

        Fixture fixture = createFixture();
        CountDownLatch aReady = new CountDownLatch(1);
        CountDownLatch releaseA = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        Future<CancelUpdates> cancelFuture = null;
        Future<PaymentUpdates> paymentFuture = null;
        try {
            cancelFuture = executor.submit(() -> runCancellation(fixture, aReady, releaseA));
            await(aReady, "transaction A did not reach the payment read");

            paymentFuture = executor.submit(() -> runPaymentCompletion(fixture));
            PaymentUpdates paymentUpdates = paymentFuture.get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
            logPaymentUpdates(paymentUpdates);

            releaseA.countDown();

            CancelUpdates cancelUpdates = cancelFuture.get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
            logCancelUpdates(cancelUpdates);

            FinalState finalState = readFinalState(fixture);
            logFinalState(finalState);

            // 취소는 Request만 잠그고 결제 완료는 Payment와 Attempt만 잠그므로 두 트랜잭션이
            // 서로를 기다리지 않고 모두 커밋할 수 있다. 취소의 PENDING Payment 조건부 UPDATE가
            // 0행이어도 결과를 확인하지 않아 Request만 CANCELLED로 남는 비즈니스 불변조건 위반이다.
            assertAll(
                    () -> assertEquals("CANCELLED", finalState.requestStatus()),
                    () -> assertEquals("PAID", finalState.paymentStatus()),
                    () -> assertEquals("SUCCEEDED", finalState.attemptStatus()),
                    () -> assertNull(finalState.refundedAt())
            );
        } finally {
            // 테스트가 실패해도 A와 executor가 남지 않게 하는 안전 해제다.
            releaseA.countDown();
            waitForCompletion(cancelFuture);
            waitForCompletion(paymentFuture);
            executor.shutdownNow();
            executor.awaitTermination(TIMEOUT_SECONDS, TimeUnit.SECONDS);
            deleteFixture(fixture);
        }
    }

    private static CancelUpdates runCancellation(
            Fixture fixture,
            CountDownLatch aReady,
            CountDownLatch releaseA
    ) throws Exception {
        try (Connection connection = openConnection()) {
            connection.setAutoCommit(false);
            connection.setTransactionIsolation(Connection.TRANSACTION_READ_COMMITTED);
            try {
                try (PreparedStatement statement = connection.prepareStatement("""
                        SELECT id
                        FROM assembly_requests
                        WHERE id = ? AND user_id = ?
                        FOR UPDATE
                        """)) {
                    statement.setLong(1, fixture.requestId());
                    statement.setLong(2, fixture.userId());
                    try (ResultSet rows = statement.executeQuery()) {
                        requireRow(rows, "transaction A could not lock the request");
                    }
                }

                String paymentStatus;
                try (PreparedStatement statement = connection.prepareStatement("""
                        SELECT status
                        FROM assembly_payments
                        WHERE assembly_request_id = ?
                        """)) {
                    statement.setLong(1, fixture.requestId());
                    try (ResultSet rows = statement.executeQuery()) {
                        requireRow(rows, "transaction A could not read the payment");
                        paymentStatus = rows.getString("status");
                    }
                }
                requireState("PENDING", paymentStatus, "transaction A initial payment status");

                aReady.countDown();
                await(releaseA, "transaction A was not released after transaction B committed");

                int requestCancelled;
                try (PreparedStatement statement = connection.prepareStatement("""
                        UPDATE assembly_requests
                        SET status = 'CANCELLED', cancellation_reason = ?,
                            cancelled_at = now(), updated_at = now()
                        WHERE id = ?
                        """)) {
                    statement.setString(1, "payment-cancel race reproduction");
                    statement.setLong(2, fixture.requestId());
                    requestCancelled = statement.executeUpdate();
                }

                int attemptsCancelled;
                try (PreparedStatement statement = connection.prepareStatement("""
                        UPDATE assembly_payment_attempts
                        SET status = 'CANCELLED', failure_code = 'ORDER_CANCELLED',
                            failure_message = '조립 요청이 취소되었습니다.',
                            completed_at = now(), updated_at = now()
                        WHERE assembly_payment_id = (
                            SELECT id FROM assembly_payments WHERE assembly_request_id = ?
                        )
                          AND status IN ('READY', 'PROCESSING', 'VERIFYING')
                        """)) {
                    statement.setLong(1, fixture.requestId());
                    attemptsCancelled = statement.executeUpdate();
                }

                int paymentsCancelled;
                try (PreparedStatement statement = connection.prepareStatement("""
                        UPDATE assembly_payments
                        SET status = 'CANCELLED', cancelled_at = now(), updated_at = now()
                        WHERE assembly_request_id = ? AND status = 'PENDING'
                        """)) {
                    statement.setLong(1, fixture.requestId());
                    paymentsCancelled = statement.executeUpdate();
                }

                int historiesInserted;
                try (PreparedStatement statement = connection.prepareStatement("""
                        INSERT INTO assembly_request_status_history (
                            assembly_request_id, actor_user_id, from_status, to_status, note, created_at
                        ) VALUES (?, ?, 'MATCHED', 'CANCELLED', ?, now())
                        """)) {
                    statement.setLong(1, fixture.requestId());
                    statement.setLong(2, fixture.userId());
                    statement.setString(3, "payment-cancel race reproduction");
                    historiesInserted = statement.executeUpdate();
                }

                connection.commit();
                return new CancelUpdates(
                        requestCancelled,
                        attemptsCancelled,
                        paymentsCancelled,
                        historiesInserted
                );
            } catch (Exception exception) {
                connection.rollback();
                throw exception;
            }
        }
    }

    private static PaymentUpdates runPaymentCompletion(Fixture fixture) throws Exception {
        try (Connection connection = openConnection()) {
            connection.setAutoCommit(false);
            connection.setTransactionIsolation(Connection.TRANSACTION_READ_COMMITTED);
            try {
                try (PreparedStatement statement = connection.prepareStatement("""
                        SELECT apa.id, apa.status AS attempt_status,
                               ap.id AS payment_id, ap.status AS payment_status
                        FROM assembly_payment_attempts apa
                        JOIN assembly_payments ap ON ap.id = apa.assembly_payment_id
                        JOIN assembly_requests ar ON ar.id = ap.assembly_request_id
                        WHERE apa.id = ? AND ar.user_id = ?
                        FOR UPDATE OF apa, ap
                        """)) {
                    statement.setLong(1, fixture.attemptId());
                    statement.setLong(2, fixture.userId());
                    try (ResultSet rows = statement.executeQuery()) {
                        requireRow(rows, "transaction B could not lock the attempt and payment");
                        requireState("PROCESSING", rows.getString("attempt_status"),
                                "transaction B initial attempt status");
                        requireState("PENDING", rows.getString("payment_status"),
                                "transaction B initial payment status");
                    }
                }

                int attemptsSucceeded;
                try (PreparedStatement statement = connection.prepareStatement("""
                        UPDATE assembly_payment_attempts
                        SET status = 'SUCCEEDED', provider_transaction_id = ?, pg_transaction_id = ?,
                            approved_amount = requested_amount, verified_at = now(), completed_at = now(),
                            updated_at = now(), failure_code = NULL, failure_message = NULL
                        WHERE id = ?
                        """)) {
                    statement.setString(1, "provider-" + fixture.marker());
                    statement.setString(2, "pg-" + fixture.marker());
                    statement.setLong(3, fixture.attemptId());
                    attemptsSucceeded = statement.executeUpdate();
                }

                int paymentsPaid;
                try (PreparedStatement statement = connection.prepareStatement("""
                        UPDATE assembly_payments
                        SET provider = 'MOCK', method = 'CARD', currency = 'KRW',
                            paid_amount = amount, status = 'PAID',
                            paid_at = COALESCE(paid_at, now()), verified_at = now(), updated_at = now()
                        WHERE id = ? AND status = 'PENDING'
                        """)) {
                    statement.setLong(1, fixture.paymentId());
                    paymentsPaid = statement.executeUpdate();
                }

                connection.commit();
                return new PaymentUpdates(attemptsSucceeded, paymentsPaid);
            } catch (Exception exception) {
                connection.rollback();
                throw exception;
            }
        }
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
                try (PreparedStatement statement = connection.prepareStatement("""
                        INSERT INTO assembly_payment_attempts (
                            assembly_payment_id, idempotency_key, provider, merchant_payment_id,
                            pay_method, requested_amount, currency, status, expires_at,
                            created_at, updated_at
                        ) VALUES (?, ?, 'MOCK', ?, 'CARD', 110000, 'KRW', 'PROCESSING',
                                  now() + interval '30 minutes', now(), now())
                        RETURNING id
                        """)) {
                    statement.setLong(1, paymentId);
                    statement.setString(2, "race-attempt-" + marker);
                    statement.setString(3, "BG-RACE-" + marker);
                    try (ResultSet rows = statement.executeQuery()) {
                        requireRow(rows, "payment attempt fixture was not inserted");
                        attemptId = rows.getLong("id");
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
                return new Fixture(marker, userId, requestId, requestPublicId, offerId, paymentId, attemptId);
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
        return DriverManager.getConnection(
                environment("PAYMENT_CANCEL_RACE_DB_URL",
                        environment("SPRING_DATASOURCE_URL", "jdbc:postgresql://localhost:55432/buildgraph")),
                environment("PAYMENT_CANCEL_RACE_DB_USERNAME",
                        environment("SPRING_DATASOURCE_USERNAME", "buildgraph")),
                environment("PAYMENT_CANCEL_RACE_DB_PASSWORD",
                        environment("SPRING_DATASOURCE_PASSWORD", "buildgraph"))
        );
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

    private static void requireState(String expected, String actual, String label) {
        if (!expected.equals(actual)) {
            throw new IllegalStateException(label + ": expected=" + expected + ", actual=" + actual);
        }
    }

    private static void await(CountDownLatch latch, String message) throws InterruptedException {
        if (!latch.await(TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
            throw new IllegalStateException(message);
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

    private static String environment(String name, String defaultValue) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? defaultValue : value;
    }

    private static void logPaymentUpdates(PaymentUpdates updates) {
        System.out.printf(
                "Transaction B updates: attempt SUCCEEDED=%d, payment PAID=%d%n",
                updates.attemptsSucceeded(),
                updates.paymentsPaid()
        );
    }

    private static void logCancelUpdates(CancelUpdates updates) {
        System.out.printf(
                "Transaction A updates: request CANCELLED=%d, active attempt CANCELLED=%d, "
                        + "pending payment CANCELLED=%d, history inserted=%d%n",
                updates.requestCancelled(),
                updates.attemptsCancelled(),
                updates.paymentsCancelled(),
                updates.historiesInserted()
        );
    }

    private static void logFinalState(FinalState state) {
        System.out.printf(
                "Final state: request=%s, payment=%s, attempt=%s, paid_at=%s, refunded_at=%s, "
                        + "cancelled_history=%d, refund_records=%d%n",
                state.requestStatus(),
                state.paymentStatus(),
                state.attemptStatus(),
                state.paidAt(),
                state.refundedAt(),
                state.cancelledHistoryCount(),
                state.refundRecordCount()
        );
    }

    private record Fixture(
            String marker,
            long userId,
            long requestId,
            String requestPublicId,
            long offerId,
            long paymentId,
            long attemptId
    ) {
    }

    private record PaymentUpdates(int attemptsSucceeded, int paymentsPaid) {
    }

    private record CancelUpdates(
            int requestCancelled,
            int attemptsCancelled,
            int paymentsCancelled,
            int historiesInserted
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

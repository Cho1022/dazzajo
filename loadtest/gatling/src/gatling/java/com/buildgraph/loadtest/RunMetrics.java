package com.buildgraph.loadtest;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.atomic.AtomicLong;

final class RunMetrics {
    private static final DateTimeFormatter FILE_TIME =
            DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss").withZone(ZoneOffset.UTC);
    private static final AtomicLong connectAttempts = new AtomicLong();
    private static final AtomicLong connectSuccess = new AtomicLong();
    private static final AtomicLong subscribeAttempts = new AtomicLong();
    private static final AtomicLong subscribeSuccess = new AtomicLong();
    private static final AtomicLong sends = new AtomicLong();
    private static final AtomicLong canonicalMessages = new AtomicLong();
    private static final AtomicLong duplicates = new AtomicLong();
    private static final AtomicLong errorFrames = new AtomicLong();
    private static final Set<String> canonicalKeys = ConcurrentHashMap.newKeySet();
    private static final ConcurrentLinkedQueue<Long> roundtripMillis = new ConcurrentLinkedQueue<>();
    private static volatile long startedNanos;

    private RunMetrics() {
    }

    static void reset() {
        connectAttempts.set(0);
        connectSuccess.set(0);
        subscribeAttempts.set(0);
        subscribeSuccess.set(0);
        sends.set(0);
        canonicalMessages.set(0);
        duplicates.set(0);
        errorFrames.set(0);
        canonicalKeys.clear();
        roundtripMillis.clear();
        startedNanos = System.nanoTime();
    }

    static void recordConnectAttempt() {
        connectAttempts.incrementAndGet();
    }

    static void recordConnectSuccess() {
        connectSuccess.incrementAndGet();
    }

    static void recordSubscribeAttempt() {
        subscribeAttempts.incrementAndGet();
    }

    static void recordSubscribeSuccess() {
        subscribeSuccess.incrementAndGet();
    }

    static void recordSend() {
        sends.incrementAndGet();
    }

    static void recordCanonical(String actorId, String clientMessageId, long sendStartedNanos) {
        String key = actorId + "|" + clientMessageId;
        if (canonicalKeys.add(key)) {
            canonicalMessages.incrementAndGet();
            long elapsedNanos = Math.max(0, System.nanoTime() - sendStartedNanos);
            roundtripMillis.add(elapsedNanos / 1_000_000);
        } else {
            duplicates.incrementAndGet();
        }
    }

    static void recordErrorFrame() {
        errorFrames.incrementAndGet();
    }

    static Snapshot snapshot() {
        double elapsedSeconds = Math.max(0.001, (System.nanoTime() - startedNanos) / 1_000_000_000.0);
        List<Long> sorted = new ArrayList<>(roundtripMillis);
        sorted.sort(Comparator.naturalOrder());
        long sendCount = sends.get();
        long canonicalCount = canonicalMessages.get();
        return new Snapshot(
                connectAttempts.get(), connectSuccess.get(),
                subscribeAttempts.get(), subscribeSuccess.get(),
                sendCount, canonicalCount, Math.max(0, sendCount - canonicalCount),
                duplicates.get(), errorFrames.get(),
                percentile(sorted, 50), percentile(sorted, 95), percentile(sorted, 99),
                canonicalCount / elapsedSeconds, elapsedSeconds
        );
    }

    static void writeSummary(String simulationName, boolean assertSmoke) {
        Snapshot snapshot = snapshot();
        Path directory = TestConfig.resultsDir();
        Path output = directory.resolve("summary-" + simulationName + "-" + FILE_TIME.format(Instant.now()) + ".json");
        try {
            Files.createDirectories(directory);
            Files.writeString(output, snapshot.toJson(simulationName), StandardCharsets.UTF_8);
        } catch (IOException exception) {
            throw new IllegalStateException("Failed to write load-test summary to " + output, exception);
        }
        System.out.println("Load-test correctness summary: " + output);
        System.out.println(snapshot.toJson(simulationName));
        if (assertSmoke && !snapshot.smokePassed()) {
            throw new IllegalStateException("Smoke correctness gate failed: " + snapshot.toJson(simulationName));
        }
    }

    private static long percentile(List<Long> sorted, int percentile) {
        if (sorted.isEmpty()) {
            return 0;
        }
        int index = (int) Math.ceil((percentile / 100.0) * sorted.size()) - 1;
        return sorted.get(Math.max(0, Math.min(index, sorted.size() - 1)));
    }

    record Snapshot(
            long connectAttempts,
            long connectSuccess,
            long subscribeAttempts,
            long subscribeSuccess,
            long sends,
            long canonicalMessages,
            long missing,
            long duplicates,
            long errorFrames,
            long roundtripP50Ms,
            long roundtripP95Ms,
            long roundtripP99Ms,
            double messagesPerSecond,
            double elapsedSeconds
    ) {
        boolean smokePassed() {
            return connectAttempts == 2
                    && connectSuccess == 2
                    && subscribeAttempts == 4
                    && subscribeSuccess == 4
                    && sends == 10
                    && canonicalMessages == 10
                    && missing == 0
                    && duplicates == 0
                    && errorFrames == 0;
        }

        String toJson(String simulationName) {
            return String.format(Locale.ROOT, """
                    {
                      "simulation": "%s",
                      "connect": {"attempted": %d, "succeeded": %d, "failed": %d},
                      "subscribe": {"attempted": %d, "succeeded": %d, "failed": %d},
                      "sendCount": %d,
                      "messageCreatedCount": %d,
                      "missingCount": %d,
                      "duplicateCount": %d,
                      "errorFrameCount": %d,
                      "chatRoundtripMs": {"p50": %d, "p95": %d, "p99": %d},
                      "messagesPerSecond": %.3f,
                      "elapsedSeconds": %.3f
                    }
                    """,
                    simulationName,
                    connectAttempts, connectSuccess, connectAttempts - connectSuccess,
                    subscribeAttempts, subscribeSuccess, subscribeAttempts - subscribeSuccess,
                    sends, canonicalMessages, missing, duplicates, errorFrames,
                    roundtripP50Ms, roundtripP95Ms, roundtripP99Ms,
                    messagesPerSecond, elapsedSeconds);
        }
    }
}

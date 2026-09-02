package com.buildgraph.loadtest;

import java.net.URI;
import java.nio.file.Path;
import java.time.Duration;

final class TestConfig {
    static final Duration STOMP_TIMEOUT = Duration.ofSeconds(10);
    static final Duration SUBSCRIBE_ERROR_GUARD = Duration.ofMillis(200);
    static final Duration CHAT_TIMEOUT = Duration.ofSeconds(5);

    private TestConfig() {
    }

    static String wsUrl() {
        return System.getProperty(
                "loadtest.wsUrl",
                System.getenv().getOrDefault("LOADTEST_WS_URL", "ws://172.31.10.173:8080/ws/support-chat")
        );
    }

    static String wsBaseUrl() {
        URI uri = URI.create(wsUrl());
        int port = uri.getPort();
        return uri.getScheme() + "://" + uri.getHost() + (port < 0 ? "" : ":" + port);
    }

    static String wsPath() {
        String path = URI.create(wsUrl()).getRawPath();
        return path == null || path.isBlank() ? "/ws/support-chat" : path;
    }

    static Path resultsDir() {
        return Path.of(System.getProperty(
                "loadtest.resultsDir",
                System.getenv().getOrDefault("LOADTEST_RESULTS_DIR", "../results")
        )).toAbsolutePath().normalize();
    }
}

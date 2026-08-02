package com.buildgraph.loadtest;

import io.gatling.javaapi.http.HttpProtocolBuilder;

import static io.gatling.javaapi.http.HttpDsl.http;

final class SupportChatSimulationSupport {
    private SupportChatSimulationSupport() {
    }

    static HttpProtocolBuilder protocol() {
        return http
                .wsBaseUrl(TestConfig.wsBaseUrl())
                .wsUnmatchedInboundMessageBufferSize(2048);
    }
}

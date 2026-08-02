package com.buildgraph.loadtest;

import io.gatling.javaapi.core.ChainBuilder;
import io.gatling.javaapi.core.Session;
import io.gatling.javaapi.http.WsFrameCheck;
import java.time.Duration;
import java.util.UUID;
import java.util.stream.IntStream;

import static io.gatling.javaapi.core.CoreDsl.exec;
import static io.gatling.javaapi.core.CoreDsl.bodyString;
import static io.gatling.javaapi.core.CoreDsl.regex;
import static io.gatling.javaapi.http.HttpDsl.ws;

final class SupportChatFlows {
    private SupportChatFlows() {
    }

    static ChainBuilder connectAndSubscribe(String tokenKey) {
        return exec(session -> {
                    RunMetrics.recordConnectAttempt();
                    return session
                            .set("connectFrame", StompFrames.connect(session.getString(tokenKey)))
                            .remove("connectResponse")
                            .set("roomReceiptId", UUID.randomUUID().toString())
                            .set("errorReceiptId", UUID.randomUUID().toString());
                })
                .exec(ws("WebSocket handshake").connect(TestConfig.wsPath()))
                .exec(ws("STOMP CONNECT send")
                        .sendText("#{connectFrame}")
                        .await(TestConfig.STOMP_TIMEOUT).on(
                                ws.checkTextMessage("STOMP CONNECT")
                                        .matching(regex("(?s)^(?:CONNECTED|ERROR)(?:\\r?\\n).*$"))
                                        .check(bodyString().saveAs("connectResponse"))
                        ))
                .exec(session -> {
                    String response = session.contains("connectResponse")
                            ? session.getString("connectResponse")
                            : "";
                    if (response.startsWith("CONNECTED")) {
                        RunMetrics.recordConnectSuccess();
                        return session.markAsSucceeded();
                    }
                    if (response.startsWith("ERROR")) {
                        RunMetrics.recordErrorFrame();
                    }
                    return session.markAsFailed();
                })
                .exitHereIfFailed()
                .exec(session -> {
                    RunMetrics.recordSubscribeAttempt();
                    return session.remove("subscribeResponse").set(
                            "roomSubscribeFrame",
                            StompFrames.subscribe(
                                    "/topic/support-chat/rooms/" + session.getString("room_id"),
                                    "room-" + session.getString("actor_id"),
                                    session.getString("roomReceiptId")
                            )
                    );
                })
                .exec(ws("STOMP SUBSCRIBE room send")
                        .sendText("#{roomSubscribeFrame}")
                        .await(TestConfig.SUBSCRIBE_ERROR_GUARD).on(
                                ws.checkTextMessage("STOMP SUBSCRIBE room error guard")
                                        .matching(regex("(?s)^(?:RECEIPT(?:\\r?\\n).*receipt-id:#{roomReceiptId}|ERROR).*$"))
                                        .check(bodyString().saveAs("subscribeResponse"))
                                        .silent()
                        ))
                .exec(session -> recordSubscriptionResult(session))
                .exitHereIfFailed()
                .exec(session -> {
                    RunMetrics.recordSubscribeAttempt();
                    return session.remove("subscribeResponse").set(
                            "errorSubscribeFrame",
                            StompFrames.subscribe(
                                    "/user/queue/support-chat-errors",
                                    "errors-" + session.getString("actor_id"),
                                    session.getString("errorReceiptId")
                            )
                    );
                })
                .exec(ws("STOMP SUBSCRIBE errors send")
                        .sendText("#{errorSubscribeFrame}")
                        .await(TestConfig.SUBSCRIBE_ERROR_GUARD).on(
                                ws.checkTextMessage("STOMP SUBSCRIBE errors error guard")
                                        .matching(regex("(?s)^(?:RECEIPT(?:\\r?\\n).*receipt-id:#{errorReceiptId}|ERROR).*$"))
                                        .check(bodyString().saveAs("subscribeResponse"))
                                        .silent()
                        ))
                .exec(session -> recordSubscriptionResult(session))
                .exitHereIfFailed();
    }

    static ChainBuilder sendMessage(String content) {
        return exec(session -> {
                    String clientMessageId = UUID.randomUUID().toString();
                    RunMetrics.recordSend();
                    return session
                            .removeAll("receivedFrame", "duplicateFrame")
                            .set("clientMessageId", clientMessageId)
                            .set("sendStartedNanos", System.nanoTime())
                            .set("sendFrame", StompFrames.send(session.getString("room_id"), clientMessageId, content));
                })
                .exec(ws("STOMP SEND")
                        .sendText("#{sendFrame}")
                        .await(TestConfig.CHAT_TIMEOUT).on(
                                ws.checkTextMessage("Chat Roundtrip")
                                        .matching(regex(
                                                "(?s)(?:^ERROR|\\\"clientMessageId\\\":\\\"#{clientMessageId}\\\")"
                                        ))
                                        .check(bodyString()
                                                .transformWithSession(SupportChatFlows::observeInboundFrame)
                                                .saveAs("receivedFrame"))
                        )
                        .await(java.time.Duration.ofMillis(100)).on(
                                ws.checkTextMessage("Duplicate guard")
                                        .matching(regex(
                                                "(?s)(?:^ERROR|\\\"clientMessageId\\\":\\\"#{clientMessageId}\\\")"
                                        ))
                                        .check(bodyString()
                                                .transformWithSession(SupportChatFlows::observeInboundFrame)
                                                .saveAs("duplicateFrame"))
                                        .silent()
                        ))
                .exec(session -> {
                    if (!session.contains("receivedFrame")) {
                        return session.markAsFailed();
                    }
                    String receivedFrame = session.getString("receivedFrame");
                    if (isCanonical(receivedFrame)) {
                        return session.markAsSucceeded();
                    }
                    return session.markAsFailed();
                });
    }

    static ChainBuilder receiveMessages(String requestName, String content, int count) {
        WsFrameCheck[] checks = IntStream.rangeClosed(1, count)
                .mapToObj(index -> ws.checkTextMessage(requestName + " #" + index)
                        .matching(regex(
                                "(?s)^MESSAGE(?:\\r?\\n).*\\\"type\\\":\\\"MESSAGE_CREATED\\\".*"
                                        + "\\\"content\\\":\\\"" + content + "\\\".*$"
                        )))
                .toArray(WsFrameCheck[]::new);
        return exec(ws(requestName + " wait")
                .sendText("\n")
                .await(Duration.ofSeconds(30)).on(checks));
    }

    static ChainBuilder disconnect() {
        return exec(session -> session.set("disconnectFrame", StompFrames.disconnect(UUID.randomUUID().toString())))
                .exec(ws("STOMP DISCONNECT").sendText("#{disconnectFrame}"))
                .exec(ws("WebSocket close").close());
    }

    private static Session recordSubscriptionResult(Session session) {
        String response = session.contains("subscribeResponse")
                ? session.getString("subscribeResponse")
                : "";
        if (response.isEmpty() || response.startsWith("RECEIPT")) {
            RunMetrics.recordSubscribeSuccess();
            return session.markAsSucceeded();
        }
        if (response.startsWith("ERROR")) {
            RunMetrics.recordErrorFrame();
        }
        return session.markAsFailed();
    }

    private static boolean isCanonical(String frame) {
        return frame.startsWith("MESSAGE") && frame.contains("\"type\":\"MESSAGE_CREATED\"");
    }

    private static boolean isError(String frame) {
        return frame.startsWith("ERROR")
                || (frame.startsWith("MESSAGE") && frame.contains("\"code\":"));
    }

    private static String observeInboundFrame(String frame, Session session) {
        if (isCanonical(frame)) {
            RunMetrics.recordCanonical(
                    session.getString("actor_id"),
                    session.getString("clientMessageId"),
                    session.getLong("sendStartedNanos")
            );
        } else if (isError(frame)) {
            RunMetrics.recordErrorFrame();
        }
        return frame;
    }
}

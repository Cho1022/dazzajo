package com.buildgraph.loadtest;

final class StompFrames {
    private static final char NUL = '\0';

    private StompFrames() {
    }

    static String connect(String token) {
        return "CONNECT\n"
                + "accept-version:1.2\n"
                + "host:buildgraph-loadtest\n"
                + "heart-beat:0,0\n"
                + "Authorization:Bearer " + token + "\n"
                + "\n" + NUL;
    }

    static String subscribe(String destination, String subscriptionId, String receiptId) {
        return "SUBSCRIBE\n"
                + "id:" + subscriptionId + "\n"
                + "destination:" + destination + "\n"
                + "ack:auto\n"
                + "receipt:" + receiptId + "\n"
                + "\n" + NUL;
    }

    static String send(String roomId, String clientMessageId, String content) {
        String body = "{\"roomId\":\"" + roomId
                + "\",\"clientMessageId\":\"" + clientMessageId
                + "\",\"content\":\"" + content + "\"}";
        return "SEND\n"
                + "destination:/app/support-chat/messages\n"
                + "content-type:application/json\n"
                + "content-length:" + body.getBytes(java.nio.charset.StandardCharsets.UTF_8).length + "\n"
                + "\n" + body + NUL;
    }

    static String disconnect(String receiptId) {
        return "DISCONNECT\nreceipt:" + receiptId + "\n\n" + NUL;
    }
}

package com.buildgraph.prototype.ticket;

final class SupportChatMessagingException extends RuntimeException {
    private final String clientMessageId;
    private final String code;
    private final boolean retryable;

    SupportChatMessagingException(String clientMessageId, String code, String message, boolean retryable) {
        super(message);
        this.clientMessageId = clientMessageId;
        this.code = code;
        this.retryable = retryable;
    }

    String clientMessageId() {
        return clientMessageId;
    }

    String code() {
        return code;
    }

    boolean retryable() {
        return retryable;
    }
}

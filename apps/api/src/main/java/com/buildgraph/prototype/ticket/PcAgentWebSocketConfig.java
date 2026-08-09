package com.buildgraph.prototype.ticket;

import com.buildgraph.prototype.agent.PcAgentDiagnosisWebSocketHandler;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean;

@Configuration
@EnableWebSocket
public class PcAgentWebSocketConfig implements WebSocketConfigurer {
    private static final int MAX_TEXT_MESSAGE_BUFFER_BYTES = 512 * 1024;

    private final PcAgentDiagnosisWebSocketHandler pcAgentDiagnosisWebSocketHandler;

    public PcAgentWebSocketConfig(PcAgentDiagnosisWebSocketHandler pcAgentDiagnosisWebSocketHandler) {
        this.pcAgentDiagnosisWebSocketHandler = pcAgentDiagnosisWebSocketHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(pcAgentDiagnosisWebSocketHandler, "/ws/pc-agent/diagnosis")
                .setAllowedOriginPatterns("*");
    }

    @Bean
    public ServletServerContainerFactoryBean webSocketContainer() {
        ServletServerContainerFactoryBean container = new ServletServerContainerFactoryBean();
        container.setMaxTextMessageBufferSize(MAX_TEXT_MESSAGE_BUFFER_BYTES);
        container.setMaxBinaryMessageBufferSize(MAX_TEXT_MESSAGE_BUFFER_BYTES);
        return container;
    }
}

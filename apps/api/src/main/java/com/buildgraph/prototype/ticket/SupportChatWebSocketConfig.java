package com.buildgraph.prototype.ticket;

import com.buildgraph.prototype.common.BuildGraphCorsProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

@Configuration
@EnableWebSocketMessageBroker
public class SupportChatWebSocketConfig implements WebSocketMessageBrokerConfigurer {
    private final SupportChatInboundChannelInterceptor inboundChannelInterceptor;
    private final String[] allowedOrigins;

    public SupportChatWebSocketConfig(
            SupportChatInboundChannelInterceptor inboundChannelInterceptor,
            BuildGraphCorsProperties corsProperties
    ) {
        this.inboundChannelInterceptor = inboundChannelInterceptor;
        this.allowedOrigins = corsProperties.allowedOrigins();
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.addEndpoint("/ws/support-chat")
                .setAllowedOrigins(allowedOrigins);
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        registry.setApplicationDestinationPrefixes("/app");
        registry.enableSimpleBroker("/topic", "/queue");
        registry.setUserDestinationPrefix("/user");
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(inboundChannelInterceptor);
    }
}

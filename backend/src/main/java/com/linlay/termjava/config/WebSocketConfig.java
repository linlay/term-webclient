package com.linlay.termjava.config;

import com.linlay.termjava.auth.WsAuthHandshakeInterceptor;
import com.linlay.termjava.ws.TerminalWebSocketHandler;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final TerminalWebSocketHandler terminalWebSocketHandler;
    private final TerminalProperties terminalProperties;
    private final WsAuthHandshakeInterceptor wsAuthHandshakeInterceptor;

    public WebSocketConfig(TerminalWebSocketHandler terminalWebSocketHandler,
                           TerminalProperties terminalProperties,
                           WsAuthHandshakeInterceptor wsAuthHandshakeInterceptor) {
        this.terminalWebSocketHandler = terminalWebSocketHandler;
        this.terminalProperties = terminalProperties;
        this.wsAuthHandshakeInterceptor = wsAuthHandshakeInterceptor;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(terminalWebSocketHandler, "/ws/{sessionId}")
            .addInterceptors(wsAuthHandshakeInterceptor)
            .setAllowedOriginPatterns(terminalProperties.getAllowedOrigins().toArray(String[]::new));
    }
}

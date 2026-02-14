package com.linlay.ptyjava.config;

import com.linlay.ptyjava.ws.TerminalWebSocketHandler;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final TerminalWebSocketHandler terminalWebSocketHandler;
    private final TerminalProperties terminalProperties;

    public WebSocketConfig(TerminalWebSocketHandler terminalWebSocketHandler,
                           TerminalProperties terminalProperties) {
        this.terminalWebSocketHandler = terminalWebSocketHandler;
        this.terminalProperties = terminalProperties;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(terminalWebSocketHandler, "/ws/{sessionId}")
            .setAllowedOriginPatterns(terminalProperties.getAllowedOrigins().toArray(String[]::new));
    }
}

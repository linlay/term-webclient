package com.linlay.termjava.auth;

import jakarta.servlet.http.HttpSession;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.util.StringUtils;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;

@Component
public class WsAuthHandshakeInterceptor implements HandshakeInterceptor {

    private final AuthService authService;
    private final AppTokenService appTokenService;

    public WsAuthHandshakeInterceptor(AuthService authService, AppTokenService appTokenService) {
        this.authService = authService;
        this.appTokenService = appTokenService;
    }

    @Override
    public boolean beforeHandshake(ServerHttpRequest request,
                                   ServerHttpResponse response,
                                   WebSocketHandler wsHandler,
                                   Map<String, Object> attributes) {
        if (!authService.isEnabled() && !appTokenService.isEnabled()) {
            return true;
        }

        if (!(request instanceof ServletServerHttpRequest servletServerHttpRequest)) {
            response.setStatusCode(HttpStatus.UNAUTHORIZED);
            return false;
        }

        HttpSession session = servletServerHttpRequest.getServletRequest().getSession(false);
        if (authService.isSessionAuthenticated(session)) {
            attributes.put("authType", "session");
            return true;
        }

        String accessToken = servletServerHttpRequest.getServletRequest().getParameter("accessToken");
        if (appTokenService.isEnabled() && StringUtils.hasText(accessToken)) {
            try {
                AppTokenService.AppTokenPrincipal principal = appTokenService.authenticateToken(accessToken);
                attributes.put("authType", "access-token");
                attributes.put("principal", principal.username());
                return true;
            } catch (AuthUnauthorizedException ignored) {
                // fall through
            }
        }

        response.setStatusCode(HttpStatus.UNAUTHORIZED);
        return false;
    }

    @Override
    public void afterHandshake(ServerHttpRequest request,
                               ServerHttpResponse response,
                               WebSocketHandler wsHandler,
                               Exception exception) {
        // no-op
    }
}

package com.linlay.ptyjava.auth;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.http.server.ServletServerHttpResponse;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.web.socket.WebSocketHandler;

class WsAuthHandshakeInterceptorTest {

    @Test
    void allowsHandshakeWhenSessionAuthenticated() {
        AuthService authService = mock(AuthService.class);
        AppTokenService appTokenService = mock(AppTokenService.class);
        WsAuthHandshakeInterceptor interceptor = new WsAuthHandshakeInterceptor(authService, appTokenService);

        when(authService.isEnabled()).thenReturn(true);
        when(authService.isSessionAuthenticated(any())).thenReturn(true);
        when(appTokenService.isEnabled()).thenReturn(true);

        MockHttpServletRequest servletRequest = new MockHttpServletRequest("GET", "/ws/s1");
        servletRequest.setSession(new MockHttpSession());

        Map<String, Object> attributes = new HashMap<>();
        boolean allowed = interceptor.beforeHandshake(
            new ServletServerHttpRequest(servletRequest),
            new ServletServerHttpResponse(new MockHttpServletResponse()),
            mock(WebSocketHandler.class),
            attributes
        );

        assertTrue(allowed);
        assertEquals("session", attributes.get("authType"));
    }

    @Test
    void allowsHandshakeWhenAccessTokenIsValid() {
        AuthService authService = mock(AuthService.class);
        AppTokenService appTokenService = mock(AppTokenService.class);
        WsAuthHandshakeInterceptor interceptor = new WsAuthHandshakeInterceptor(authService, appTokenService);

        when(authService.isEnabled()).thenReturn(true);
        when(authService.isSessionAuthenticated(any())).thenReturn(false);
        when(appTokenService.isEnabled()).thenReturn(true);
        when(appTokenService.authenticateToken("valid-token"))
            .thenReturn(new AppTokenService.AppTokenPrincipal("app-user", null));

        MockHttpServletRequest servletRequest = new MockHttpServletRequest("GET", "/ws/s1");
        servletRequest.setParameter("accessToken", "valid-token");

        Map<String, Object> attributes = new HashMap<>();
        boolean allowed = interceptor.beforeHandshake(
            new ServletServerHttpRequest(servletRequest),
            new ServletServerHttpResponse(new MockHttpServletResponse()),
            mock(WebSocketHandler.class),
            attributes
        );

        assertTrue(allowed);
        assertEquals("access-token", attributes.get("authType"));
        assertEquals("app-user", attributes.get("principal"));
    }

    @Test
    void rejectsHandshakeWhenNoSessionAndNoToken() {
        AuthService authService = mock(AuthService.class);
        AppTokenService appTokenService = mock(AppTokenService.class);
        WsAuthHandshakeInterceptor interceptor = new WsAuthHandshakeInterceptor(authService, appTokenService);

        when(authService.isEnabled()).thenReturn(true);
        when(authService.isSessionAuthenticated(any())).thenReturn(false);
        when(appTokenService.isEnabled()).thenReturn(true);

        MockHttpServletRequest servletRequest = new MockHttpServletRequest("GET", "/ws/s1");
        MockHttpServletResponse rawResponse = new MockHttpServletResponse();
        ServletServerHttpResponse response = new ServletServerHttpResponse(rawResponse);

        boolean allowed = interceptor.beforeHandshake(
            new ServletServerHttpRequest(servletRequest),
            response,
            mock(WebSocketHandler.class),
            new HashMap<>()
        );

        assertFalse(allowed);
        assertEquals(HttpStatus.UNAUTHORIZED.value(), rawResponse.getStatus());
    }
}

package com.linlay.termjava.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.nio.charset.StandardCharsets;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

@Component
public class WebApiAuthInterceptor implements HandlerInterceptor {

    private final AuthService authService;

    public WebApiAuthInterceptor(ObjectProvider<AuthService> authServiceProvider) {
        this.authService = authServiceProvider.getIfAvailable();
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
        if (authService == null) {
            return true;
        }
        if (!authService.isEnabled()) {
            return true;
        }

        if (HttpMethod.OPTIONS.matches(request.getMethod())) {
            return true;
        }

        if (authService.isRequestAuthenticated(request)) {
            return true;
        }

        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write("{\"error\":\"unauthorized\"}");
        return false;
    }
}

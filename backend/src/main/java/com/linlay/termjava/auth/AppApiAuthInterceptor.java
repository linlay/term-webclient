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
public class AppApiAuthInterceptor implements HandlerInterceptor {

    private final AppTokenService appTokenService;

    public AppApiAuthInterceptor(ObjectProvider<AppTokenService> appTokenServiceProvider) {
        this.appTokenService = appTokenServiceProvider.getIfAvailable();
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
        if (appTokenService == null) {
            return true;
        }
        if (!appTokenService.isEnabled()) {
            return true;
        }

        if (HttpMethod.OPTIONS.matches(request.getMethod())) {
            return true;
        }

        if (isTicketDownloadRequest(request)) {
            return true;
        }

        try {
            AppTokenService.AppTokenPrincipal principal = appTokenService.authenticateRequest(request);
            request.setAttribute("appPrincipal", principal.username());
            return true;
        } catch (AuthUnauthorizedException ex) {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setCharacterEncoding(StandardCharsets.UTF_8.name());
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.getWriter().write("{\"error\":\"unauthorized\"}");
            return false;
        }
    }

    private boolean isTicketDownloadRequest(HttpServletRequest request) {
        if (request == null) {
            return false;
        }
        if (!(HttpMethod.GET.matches(request.getMethod()) || HttpMethod.HEAD.matches(request.getMethod()))) {
            return false;
        }
        String ticket = request.getParameter("ticket");
        if (ticket == null || ticket.isBlank()) {
            return false;
        }
        String uri = request.getRequestURI();
        if (uri == null) {
            return false;
        }
        return uri.endsWith("/files/download") || uri.endsWith("/files/download-archive");
    }
}

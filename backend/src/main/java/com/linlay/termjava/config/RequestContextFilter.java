package com.linlay.termjava.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import org.slf4j.MDC;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

public class RequestContextFilter extends OncePerRequestFilter {

    public static final String REQUEST_ID_HEADER = "X-Request-Id";

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        String requestId = request.getHeader(REQUEST_ID_HEADER);
        if (!StringUtils.hasText(requestId)) {
            requestId = UUID.randomUUID().toString();
        }

        String sessionId = request.getRequestedSessionId();
        if (!StringUtils.hasText(sessionId) && request.getSession(false) != null) {
            sessionId = request.getSession(false).getId();
        }

        MDC.put("requestId", requestId);
        if (StringUtils.hasText(sessionId)) {
            MDC.put("sessionId", sessionId);
        }

        response.setHeader(REQUEST_ID_HEADER, requestId);

        try {
            filterChain.doFilter(request, response);
        } finally {
            MDC.remove("requestId");
            MDC.remove("sessionId");
        }
    }
}

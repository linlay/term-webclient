package com.linlay.ptyjava.auth;

import com.linlay.ptyjava.config.TerminalProperties;
import com.linlay.ptyjava.model.auth.AuthStatusResponse;
import com.linlay.ptyjava.model.auth.LoginRequest;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class AuthService {

    public static final String AUTH_USER_SESSION_KEY = "terminal.auth.username";

    private final TerminalProperties terminalProperties;
    private final BCryptPasswordEncoder passwordEncoder = new BCryptPasswordEncoder();

    public AuthService(TerminalProperties terminalProperties) {
        this.terminalProperties = terminalProperties;
    }

    public boolean isEnabled() {
        return terminalProperties.getAuth().isEnabled();
    }

    public AuthStatusResponse currentStatus(HttpServletRequest request) {
        if (!isEnabled()) {
            return new AuthStatusResponse(false, true, "anonymous");
        }
        String username = authenticatedUsername(request);
        return new AuthStatusResponse(true, StringUtils.hasText(username), username);
    }

    public AuthStatusResponse login(LoginRequest request, HttpServletRequest servletRequest) {
        if (!isEnabled()) {
            return new AuthStatusResponse(false, true, "anonymous");
        }

        ensureAuthConfigured();

        String username = request == null ? "" : safe(request.getUsername());
        String password = request == null ? "" : request.getPassword();

        boolean usernameMatches = safe(terminalProperties.getAuth().getUsername()).equals(username);
        boolean passwordMatches = StringUtils.hasText(password)
            && passwordEncoder.matches(password, terminalProperties.getAuth().getPasswordHash());

        if (!usernameMatches || !passwordMatches) {
            throw new AuthUnauthorizedException("invalid username or password");
        }

        HttpSession existing = servletRequest.getSession(false);
        if (existing != null) {
            existing.invalidate();
        }

        HttpSession session = servletRequest.getSession(true);
        session.setMaxInactiveInterval(Math.max(60, terminalProperties.getAuth().getSessionTtlSeconds()));
        session.setAttribute(AUTH_USER_SESSION_KEY, username);
        return new AuthStatusResponse(true, true, username);
    }

    public void logout(HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        if (session != null) {
            session.invalidate();
        }
    }

    public boolean isRequestAuthenticated(HttpServletRequest request) {
        if (!isEnabled()) {
            return true;
        }
        return StringUtils.hasText(authenticatedUsername(request));
    }

    public boolean isSessionAuthenticated(HttpSession session) {
        if (!isEnabled()) {
            return true;
        }
        if (session == null) {
            return false;
        }
        Object value = session.getAttribute(AUTH_USER_SESSION_KEY);
        if (!(value instanceof String username) || !StringUtils.hasText(username)) {
            return false;
        }
        return username.equals(safe(terminalProperties.getAuth().getUsername()));
    }

    public String authenticatedUsername(HttpServletRequest request) {
        if (request == null) {
            return null;
        }
        HttpSession session = request.getSession(false);
        if (session == null) {
            return null;
        }
        Object value = session.getAttribute(AUTH_USER_SESSION_KEY);
        if (value instanceof String username && StringUtils.hasText(username)) {
            return username;
        }
        return null;
    }

    private void ensureAuthConfigured() {
        if (!StringUtils.hasText(terminalProperties.getAuth().getUsername())) {
            throw new IllegalStateException("terminal.auth.username is required when auth is enabled");
        }
        if (!StringUtils.hasText(terminalProperties.getAuth().getPasswordHash())) {
            throw new IllegalStateException("terminal.auth.password-hash is required when auth is enabled");
        }
    }

    private String safe(String value) {
        return value == null ? "" : value.trim();
    }
}

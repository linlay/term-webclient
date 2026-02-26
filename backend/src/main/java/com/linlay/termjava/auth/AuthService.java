package com.linlay.termjava.auth;

import com.linlay.termjava.config.AuthProperties;
import com.linlay.termjava.model.auth.AuthStatusResponse;
import com.linlay.termjava.model.auth.LoginRequest;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import java.util.regex.Pattern;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class AuthService {

    public static final String AUTH_USER_SESSION_KEY = "terminal.auth.username";
    private static final Pattern BCRYPT_PATTERN = Pattern.compile("^\\$2[aby]\\$\\d{2}\\$[./A-Za-z0-9]{53}$");
    private static final BCryptPasswordEncoder BCRYPT_ENCODER = new BCryptPasswordEncoder();

    private final AuthProperties authProperties;
    private final LoginRateLimiter loginRateLimiter;

    public AuthService(AuthProperties authProperties, LoginRateLimiter loginRateLimiter) {
        this.authProperties = authProperties;
        this.loginRateLimiter = loginRateLimiter;
    }

    public boolean isEnabled() {
        return authProperties.isEnabled();
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
        String rateLimitKey = loginRateLimiter.resolveRateLimitKey(servletRequest, username);

        loginRateLimiter.ensureAllowed(rateLimitKey);

        boolean usernameMatches = safe(authProperties.getUsername()).equals(username);
        boolean passwordMatches = matchesPassword(password);

        if (!usernameMatches || !passwordMatches) {
            loginRateLimiter.recordFailure(rateLimitKey);
            throw new AuthUnauthorizedException("invalid username or password");
        }
        loginRateLimiter.recordSuccess(rateLimitKey);

        HttpSession existing = servletRequest.getSession(false);
        if (existing != null) {
            existing.invalidate();
        }

        HttpSession session = servletRequest.getSession(true);
        session.setMaxInactiveInterval(Math.max(60, authProperties.getSessionTtlSeconds()));
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
        return username.equals(safe(authProperties.getUsername()));
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
        if (!StringUtils.hasText(authProperties.getUsername())) {
            throw new IllegalStateException("auth.username is required when auth is enabled");
        }
        String bcryptHash = normalizeBcryptHash(authProperties.getPasswordHashBcrypt());
        if (!StringUtils.hasText(bcryptHash)) {
            throw new IllegalStateException(
                "auth.password-hash-bcrypt must be configured when auth is enabled");
        }
        if (StringUtils.hasText(bcryptHash) && !BCRYPT_PATTERN.matcher(bcryptHash).matches()) {
            throw new IllegalStateException("auth.password-hash-bcrypt must be a BCrypt hash");
        }
    }

    private String safe(String value) {
        return value == null ? "" : value.trim();
    }

    private String normalizeBcryptHash(String value) {
        String normalized = safe(value);
        if (normalized.length() < 2) {
            return normalized;
        }
        char first = normalized.charAt(0);
        char last = normalized.charAt(normalized.length() - 1);
        if ((first == '\'' && last == '\'') || (first == '"' && last == '"')) {
            return normalized.substring(1, normalized.length() - 1).trim();
        }
        return normalized;
    }

    private boolean matchesPassword(String rawPassword) {
        if (!StringUtils.hasText(rawPassword)) {
            return false;
        }

        String bcryptHash = normalizeBcryptHash(authProperties.getPasswordHashBcrypt());
        try {
            return BCRYPT_ENCODER.matches(rawPassword, bcryptHash);
        } catch (IllegalArgumentException ignored) {
            return false;
        }
    }
}

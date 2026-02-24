package com.linlay.termjava.auth;

import com.linlay.termjava.config.AuthProperties;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

@Component
public class LoginRateLimiter {

    private final AuthProperties authProperties;
    private final Map<String, Deque<Long>> failures = new ConcurrentHashMap<>();

    public LoginRateLimiter(AuthProperties authProperties) {
        this.authProperties = authProperties;
    }

    public String resolveRateLimitKey(HttpServletRequest request, String username) {
        String user = StringUtils.hasText(username) ? username.trim() : "anonymous";

        String forwarded = request.getHeader("X-Forwarded-For");
        if (StringUtils.hasText(forwarded)) {
            int comma = forwarded.indexOf(',');
            String first = comma >= 0 ? forwarded.substring(0, comma) : forwarded;
            return first.trim() + "|" + user;
        }

        String remote = request.getRemoteAddr();
        if (!StringUtils.hasText(remote)) {
            remote = "unknown";
        }
        return remote + "|" + user;
    }

    public void ensureAllowed(String key) {
        if (!isEnabled()) {
            return;
        }

        Deque<Long> queue = failures.computeIfAbsent(key, ignored -> new ArrayDeque<>());
        long nowMillis = Instant.now().toEpochMilli();
        long cutoffMillis = nowMillis - windowSeconds() * 1000L;

        synchronized (queue) {
            trim(queue, cutoffMillis);
            if (queue.size() >= maxAttempts()) {
                throw new AuthTooManyRequestsException("too many login attempts, please retry later");
            }
        }
    }

    public void recordFailure(String key) {
        if (!isEnabled()) {
            return;
        }

        Deque<Long> queue = failures.computeIfAbsent(key, ignored -> new ArrayDeque<>());
        long nowMillis = Instant.now().toEpochMilli();
        long cutoffMillis = nowMillis - windowSeconds() * 1000L;

        synchronized (queue) {
            trim(queue, cutoffMillis);
            queue.addLast(nowMillis);
        }
    }

    public void recordSuccess(String key) {
        failures.remove(key);
    }

    private boolean isEnabled() {
        return authProperties.isLoginRateLimitEnabled();
    }

    private int maxAttempts() {
        return Math.max(1, authProperties.getLoginRateLimitMaxAttempts());
    }

    private int windowSeconds() {
        return Math.max(10, authProperties.getLoginRateLimitWindowSeconds());
    }

    private void trim(Deque<Long> queue, long cutoffMillis) {
        while (!queue.isEmpty() && queue.peekFirst() < cutoffMillis) {
            queue.pollFirst();
        }
    }
}

package com.linlay.termjava.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "auth")
public class AuthProperties {

    private boolean enabled = false;
    private String username = "admin";
    private String passwordHashBcrypt = "";
    private int sessionTtlSeconds = 12 * 3600;
    private boolean loginRateLimitEnabled = true;
    private int loginRateLimitWindowSeconds = 60;
    private int loginRateLimitMaxAttempts = 10;

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public String getPasswordHashBcrypt() {
        return passwordHashBcrypt;
    }

    public void setPasswordHashBcrypt(String passwordHashBcrypt) {
        this.passwordHashBcrypt = passwordHashBcrypt;
    }

    public int getSessionTtlSeconds() {
        return sessionTtlSeconds;
    }

    public void setSessionTtlSeconds(int sessionTtlSeconds) {
        this.sessionTtlSeconds = sessionTtlSeconds;
    }

    public boolean isLoginRateLimitEnabled() {
        return loginRateLimitEnabled;
    }

    public void setLoginRateLimitEnabled(boolean loginRateLimitEnabled) {
        this.loginRateLimitEnabled = loginRateLimitEnabled;
    }

    public int getLoginRateLimitWindowSeconds() {
        return loginRateLimitWindowSeconds;
    }

    public void setLoginRateLimitWindowSeconds(int loginRateLimitWindowSeconds) {
        this.loginRateLimitWindowSeconds = loginRateLimitWindowSeconds;
    }

    public int getLoginRateLimitMaxAttempts() {
        return loginRateLimitMaxAttempts;
    }

    public void setLoginRateLimitMaxAttempts(int loginRateLimitMaxAttempts) {
        this.loginRateLimitMaxAttempts = loginRateLimitMaxAttempts;
    }
}

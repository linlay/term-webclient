package com.linlay.ptyjava.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

@Data
@ConfigurationProperties(prefix = "auth")
public class AuthProperties {

    private boolean enabled = false;
    private String username = "admin";
    private String passwordHashBcrypt = "";
    private int sessionTtlSeconds = 12 * 3600;
    private boolean loginRateLimitEnabled = true;
    private int loginRateLimitWindowSeconds = 60;
    private int loginRateLimitMaxAttempts = 10;
}

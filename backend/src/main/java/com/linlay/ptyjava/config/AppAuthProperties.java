package com.linlay.ptyjava.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

@Data
@ConfigurationProperties(prefix = "app-auth")
public class AppAuthProperties {

    private boolean enabled = true;
    private String localPublicKey = "";
    private String jwksUri = "";
    private String issuer = "";
    private int jwksCacheSeconds = 300;
    private String audience = "";
    private int clockSkewSeconds = 30;
}

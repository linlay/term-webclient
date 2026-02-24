package com.linlay.termjava.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app-auth")
public class AppAuthProperties {

    private boolean enabled = true;
    private String localPublicKey = "";
    private String jwksUri = "";
    private String issuer = "";
    private int jwksCacheSeconds = 300;
    private String audience = "";
    private int clockSkewSeconds = 30;

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public String getLocalPublicKey() {
        return localPublicKey;
    }

    public void setLocalPublicKey(String localPublicKey) {
        this.localPublicKey = localPublicKey;
    }

    public String getJwksUri() {
        return jwksUri;
    }

    public void setJwksUri(String jwksUri) {
        this.jwksUri = jwksUri;
    }

    public String getIssuer() {
        return issuer;
    }

    public void setIssuer(String issuer) {
        this.issuer = issuer;
    }

    public int getJwksCacheSeconds() {
        return jwksCacheSeconds;
    }

    public void setJwksCacheSeconds(int jwksCacheSeconds) {
        this.jwksCacheSeconds = jwksCacheSeconds;
    }

    public String getAudience() {
        return audience;
    }

    public void setAudience(String audience) {
        this.audience = audience;
    }

    public int getClockSkewSeconds() {
        return clockSkewSeconds;
    }

    public void setClockSkewSeconds(int clockSkewSeconds) {
        this.clockSkewSeconds = clockSkewSeconds;
    }
}

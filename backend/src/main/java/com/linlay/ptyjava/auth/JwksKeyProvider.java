package com.linlay.ptyjava.auth;

import com.linlay.ptyjava.config.AppAuthProperties;
import com.nimbusds.jose.jwk.JWK;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

@Component
public class JwksKeyProvider {

    private final AppAuthProperties appAuthProperties;
    private final HttpClient httpClient;
    private final Object lock = new Object();

    private volatile CachedJwks cached;

    public JwksKeyProvider(AppAuthProperties appAuthProperties) {
        this.appAuthProperties = appAuthProperties;
        this.httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .build();
    }

    public RSAKey resolveRsaKey(String keyId) {
        JWKSet jwkSet = loadJwks();
        if (jwkSet == null) {
            throw new AuthUnauthorizedException("jwks is not configured");
        }

        List<JWK> keys = jwkSet.getKeys().stream()
            .filter(key -> key instanceof RSAKey)
            .toList();
        if (keys.isEmpty()) {
            throw new AuthUnauthorizedException("no rsa key found in jwks");
        }

        if (StringUtils.hasText(keyId)) {
            for (JWK key : keys) {
                if (keyId.equals(key.getKeyID())) {
                    return (RSAKey) key;
                }
            }
            throw new AuthUnauthorizedException("unable to resolve jwks key by kid");
        }

        if (keys.size() == 1) {
            return (RSAKey) keys.getFirst();
        }

        throw new AuthUnauthorizedException("token is missing kid while jwks contains multiple keys");
    }

    private JWKSet loadJwks() {
        String jwksUri = safe(appAuthProperties.getJwksUri());
        if (!StringUtils.hasText(jwksUri)) {
            return null;
        }

        CachedJwks snapshot = cached;
        Instant now = Instant.now();
        if (snapshot != null && now.isBefore(snapshot.expiresAt())) {
            return snapshot.jwkSet();
        }

        synchronized (lock) {
            snapshot = cached;
            now = Instant.now();
            if (snapshot != null && now.isBefore(snapshot.expiresAt())) {
                return snapshot.jwkSet();
            }

            JWKSet jwkSet = fetchJwks(jwksUri);
            int cacheSeconds = Math.max(1, appAuthProperties.getJwksCacheSeconds());
            cached = new CachedJwks(jwkSet, now.plusSeconds(cacheSeconds));
            return jwkSet;
        }
    }

    private JWKSet fetchJwks(String jwksUri) {
        HttpRequest request = HttpRequest.newBuilder(URI.create(jwksUri))
            .GET()
            .timeout(Duration.ofSeconds(5))
            .build();
        try {
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new AuthUnauthorizedException("jwks endpoint returned status " + response.statusCode());
            }
            return JWKSet.parse(response.body());
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new AuthUnauthorizedException("failed to fetch jwks", ex);
        } catch (IOException ex) {
            throw new AuthUnauthorizedException("failed to fetch jwks", ex);
        } catch (java.text.ParseException ex) {
            throw new AuthUnauthorizedException("invalid jwks payload", ex);
        }
    }

    private String safe(String value) {
        return value == null ? "" : value.trim();
    }

    private record CachedJwks(JWKSet jwkSet, Instant expiresAt) {
    }
}

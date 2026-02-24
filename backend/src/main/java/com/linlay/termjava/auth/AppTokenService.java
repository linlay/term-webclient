package com.linlay.termjava.auth;

import com.linlay.termjava.config.AppAuthProperties;
import com.linlay.termjava.model.auth.AuthStatusResponse;
import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.JWSVerifier;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import jakarta.servlet.http.HttpServletRequest;
import java.security.KeyFactory;
import java.security.NoSuchAlgorithmException;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.InvalidKeySpecException;
import java.security.spec.X509EncodedKeySpec;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Date;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class AppTokenService {

    private static final String AUTHORIZATION_HEADER = "Authorization";
    private static final String BEARER_PREFIX = "Bearer ";

    private final AppAuthProperties appAuthProperties;
    private final JwksKeyProvider jwksKeyProvider;
    private final Clock clock;

    private volatile String cachedLocalPublicKeyPem;
    private volatile RSAPublicKey cachedLocalPublicKey;

    public AppTokenService(AppAuthProperties appAuthProperties,
                           JwksKeyProvider jwksKeyProvider) {
        this.appAuthProperties = appAuthProperties;
        this.jwksKeyProvider = jwksKeyProvider;
        this.clock = Clock.systemUTC();
    }

    public boolean isEnabled() {
        return appAuthProperties.isEnabled();
    }

    public AuthStatusResponse currentStatus(HttpServletRequest request) {
        if (!isEnabled()) {
            return new AuthStatusResponse(false, true, "anonymous");
        }
        AppTokenPrincipal principal = authenticateRequest(request);
        return new AuthStatusResponse(true, true, principal.username());
    }

    public AppTokenPrincipal authenticateRequest(HttpServletRequest request) {
        String token = extractBearerToken(request);
        if (!StringUtils.hasText(token)) {
            throw new AuthUnauthorizedException("missing bearer token");
        }
        return authenticateToken(token);
    }

    public AppTokenPrincipal authenticateToken(String accessToken) {
        if (!isEnabled()) {
            return new AppTokenPrincipal("anonymous", null);
        }

        SignedJWT signedJwt = parse(accessToken);
        JWTClaimsSet claims = parseClaims(signedJwt);
        verifySignature(signedJwt);
        validateClaims(claims);

        String username = resolveUsername(claims);
        return new AppTokenPrincipal(username, claims);
    }

    public String extractBearerToken(HttpServletRequest request) {
        if (request == null) {
            return null;
        }
        String header = request.getHeader(AUTHORIZATION_HEADER);
        if (!StringUtils.hasText(header)) {
            return null;
        }
        String value = header.trim();
        if (!value.regionMatches(true, 0, BEARER_PREFIX, 0, BEARER_PREFIX.length())) {
            return null;
        }
        String token = value.substring(BEARER_PREFIX.length()).trim();
        return StringUtils.hasText(token) ? token : null;
    }

    private SignedJWT parse(String token) {
        try {
            return SignedJWT.parse(token);
        } catch (java.text.ParseException ex) {
            throw new AuthUnauthorizedException("invalid jwt token", ex);
        }
    }

    private JWTClaimsSet parseClaims(SignedJWT signedJwt) {
        try {
            return signedJwt.getJWTClaimsSet();
        } catch (java.text.ParseException ex) {
            throw new AuthUnauthorizedException("invalid jwt claims", ex);
        }
    }

    private void verifySignature(SignedJWT signedJwt) {
        JWSHeader header = signedJwt.getHeader();
        JWSAlgorithm algorithm = header.getAlgorithm();
        if (algorithm == null || JWSAlgorithm.NONE.equals(algorithm)) {
            throw new AuthUnauthorizedException("unsupported jwt algorithm");
        }
        if (!JWSAlgorithm.Family.RSA.contains(algorithm)) {
            throw new AuthUnauthorizedException("only RSA algorithms are supported");
        }

        RSAPublicKey publicKey = resolveVerificationKey(header);
        JWSVerifier verifier = new RSASSAVerifier(publicKey);

        boolean verified;
        try {
            verified = signedJwt.verify(verifier);
        } catch (JOSEException ex) {
            throw new AuthUnauthorizedException("jwt signature verification failed", ex);
        }
        if (!verified) {
            throw new AuthUnauthorizedException("jwt signature is invalid");
        }
    }

    private RSAPublicKey resolveVerificationKey(JWSHeader header) {
        RSAPublicKey localPublicKey = resolveLocalPublicKey();
        if (localPublicKey != null) {
            return localPublicKey;
        }

        RSAKey rsaJwk = jwksKeyProvider.resolveRsaKey(header.getKeyID());
        try {
            return rsaJwk.toRSAPublicKey();
        } catch (JOSEException ex) {
            throw new AuthUnauthorizedException("failed to convert jwks key", ex);
        }
    }

    private RSAPublicKey resolveLocalPublicKey() {
        String pem = safe(appAuthProperties.getLocalPublicKey());
        if (!StringUtils.hasText(pem)) {
            return null;
        }
        RSAPublicKey cached = cachedLocalPublicKey;
        if (cached != null && pem.equals(cachedLocalPublicKeyPem)) {
            return cached;
        }

        synchronized (this) {
            cached = cachedLocalPublicKey;
            if (cached != null && pem.equals(cachedLocalPublicKeyPem)) {
                return cached;
            }
            RSAPublicKey parsed = parseRsaPublicKey(pem);
            cachedLocalPublicKeyPem = pem;
            cachedLocalPublicKey = parsed;
            return parsed;
        }
    }

    private RSAPublicKey parseRsaPublicKey(String pem) {
        String normalized = pem
            .replace("-----BEGIN PUBLIC KEY-----", "")
            .replace("-----END PUBLIC KEY-----", "")
            .replaceAll("\\s+", "");

        byte[] decoded;
        try {
            decoded = Base64.getDecoder().decode(normalized);
        } catch (IllegalArgumentException ex) {
            throw new AuthUnauthorizedException("invalid local public key (base64 decode failed)", ex);
        }

        try {
            KeyFactory keyFactory = KeyFactory.getInstance("RSA");
            return (RSAPublicKey) keyFactory.generatePublic(new X509EncodedKeySpec(decoded));
        } catch (NoSuchAlgorithmException | InvalidKeySpecException ex) {
            throw new AuthUnauthorizedException("invalid local public key (rsa parse failed)", ex);
        }
    }

    private void validateClaims(JWTClaimsSet claims) {
        Instant now = clock.instant();
        Duration skew = Duration.ofSeconds(Math.max(0, appAuthProperties.getClockSkewSeconds()));

        Date expirationTime = claims.getExpirationTime();
        if (expirationTime == null) {
            throw new AuthUnauthorizedException("token is missing exp");
        }
        Instant exp = expirationTime.toInstant().plus(skew);
        if (now.isAfter(exp)) {
            throw new AuthUnauthorizedException("token has expired");
        }

        Date notBeforeTime = claims.getNotBeforeTime();
        if (notBeforeTime != null) {
            Instant nbf = notBeforeTime.toInstant().minus(skew);
            if (now.isBefore(nbf)) {
                throw new AuthUnauthorizedException("token is not active yet");
            }
        }

        String expectedIssuer = safe(appAuthProperties.getIssuer());
        if (StringUtils.hasText(expectedIssuer)) {
            String actualIssuer = safe(claims.getIssuer());
            if (!expectedIssuer.equals(actualIssuer)) {
                throw new AuthUnauthorizedException("token issuer is invalid");
            }
        }

        String configuredAudience = safe(appAuthProperties.getAudience());
        if (StringUtils.hasText(configuredAudience)) {
            List<String> expectedAudiences = parseExpectedAudiences(configuredAudience);
            List<String> actualAudiences = claims.getAudience() == null ? List.of() : claims.getAudience();
            boolean matched = actualAudiences.stream().anyMatch(expectedAudiences::contains);
            if (!matched) {
                throw new AuthUnauthorizedException("token audience is invalid");
            }
        }
    }

    private List<String> parseExpectedAudiences(String raw) {
        List<String> values = new ArrayList<>();
        for (String token : raw.split(",")) {
            String trimmed = token == null ? "" : token.trim();
            if (!trimmed.isEmpty()) {
                values.add(trimmed);
            }
        }
        return values;
    }

    private String resolveUsername(JWTClaimsSet claims) {
        String subject = safe(claims.getSubject());
        if (StringUtils.hasText(subject)) {
            return subject;
        }
        Object username = claims.getClaim("username");
        if (username instanceof String value && StringUtils.hasText(value)) {
            return value.trim();
        }
        return "app-user";
    }

    private String safe(String value) {
        return value == null ? "" : value.trim();
    }

    public record AppTokenPrincipal(String username, JWTClaimsSet claims) {
    }
}

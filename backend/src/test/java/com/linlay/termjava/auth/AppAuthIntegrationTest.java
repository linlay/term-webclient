package com.linlay.termjava.auth;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.Date;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
class AppAuthIntegrationTest {

    private static final String ISSUER = "https://issuer.example";
    private static final RSAKey APP_KEY = generateRsaKey();
    private static final String APP_PUBLIC_KEY_PEM = toPem(APP_KEY);

    @Autowired
    private MockMvc mockMvc;

    @DynamicPropertySource
    static void authProps(DynamicPropertyRegistry registry) {
        registry.add("app-auth.enabled", () -> "true");
        registry.add("app-auth.local-public-key", () -> APP_PUBLIC_KEY_PEM);
        registry.add("app-auth.issuer", () -> ISSUER);
        registry.add("app-auth.audience", () -> "appterm");
        registry.add("app-auth.jwks-uri", () -> "http://127.0.0.1:65535/should-not-be-called");
    }

    @Test
    void appApiRequiresToken() throws Exception {
        mockMvc.perform(get("/appapi/workdirTree"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void appApiAcceptsValidToken() throws Exception {
        String token = token("app-user", "appterm", ISSUER, Instant.now().plus(5, ChronoUnit.MINUTES));
        mockMvc.perform(get("/appapi/workdirTree")
                .header("Authorization", "Bearer " + token))
            .andExpect(status().isOk());
    }

    @Test
    void appVersionIsPublic() throws Exception {
        mockMvc.perform(get("/appapi/version"))
            .andExpect(status().isOk());
    }

    @Test
    void appAuthMeReturns401ForInvalidIssuer() throws Exception {
        String token = token("app-user", "appterm", "https://other-issuer", Instant.now().plus(5, ChronoUnit.MINUTES));
        mockMvc.perform(get("/appapi/auth/me")
                .header("Authorization", "Bearer " + token))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void appApiUsesLocalKeyWhenJwksAlsoConfigured() throws Exception {
        String token = token("priority-user", "appterm", ISSUER, Instant.now().plus(5, ChronoUnit.MINUTES));
        mockMvc.perform(get("/appapi/auth/me")
                .header("Authorization", "Bearer " + token))
            .andExpect(status().isOk());
    }

    private static String token(String subject, String audience, String issuer, Instant expirationAt) {
        JWTClaimsSet claimsSet = new JWTClaimsSet.Builder()
            .subject(subject)
            .audience(audience)
            .issuer(issuer)
            .notBeforeTime(Date.from(Instant.now().minus(1, ChronoUnit.MINUTES)))
            .expirationTime(Date.from(expirationAt))
            .build();

        SignedJWT signedJwt = new SignedJWT(
            new JWSHeader.Builder(JWSAlgorithm.RS256)
                .keyID(APP_KEY.getKeyID())
                .build(),
            claimsSet
        );
        try {
            signedJwt.sign(new RSASSASigner(APP_KEY.toPrivateKey()));
        } catch (JOSEException ex) {
            throw new IllegalStateException("failed to sign jwt", ex);
        }
        return signedJwt.serialize();
    }

    private static RSAKey generateRsaKey() {
        try {
            return new RSAKeyGenerator(2048)
                .keyID("app-key-1")
                .generate();
        } catch (JOSEException ex) {
            throw new IllegalStateException("failed to generate rsa key", ex);
        }
    }

    private static String toPem(RSAKey rsaKey) {
        try {
            String encoded = Base64.getMimeEncoder(64, "\n".getBytes(StandardCharsets.UTF_8))
                .encodeToString(rsaKey.toRSAPublicKey().getEncoded());
            return "-----BEGIN PUBLIC KEY-----\n" + encoded + "\n-----END PUBLIC KEY-----";
        } catch (JOSEException ex) {
            throw new IllegalStateException("failed to convert public key", ex);
        }
    }
}

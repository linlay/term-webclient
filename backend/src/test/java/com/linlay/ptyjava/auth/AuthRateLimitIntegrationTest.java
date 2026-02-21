package com.linlay.ptyjava.auth;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
class AuthRateLimitIntegrationTest {

    private static final String BCRYPT_HASH = new BCryptPasswordEncoder().encode("secret123");

    @Autowired
    private MockMvc mockMvc;

    @DynamicPropertySource
    static void authProps(DynamicPropertyRegistry registry) {
        registry.add("auth.enabled", () -> "true");
        registry.add("auth.username", () -> "tester");
        registry.add("auth.password-hash-bcrypt", () -> BCRYPT_HASH);
        registry.add("auth.login-rate-limit-enabled", () -> "true");
        registry.add("auth.login-rate-limit-window-seconds", () -> "120");
        registry.add("auth.login-rate-limit-max-attempts", () -> "2");
    }

    @Test
    void rejectsAfterTooManyFailures() throws Exception {
        String wrongPayload = """
            {
              "username":"tester",
              "password":"invalid"
            }
            """;

        mockMvc.perform(post("/webapi/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(wrongPayload))
            .andExpect(status().isUnauthorized());

        mockMvc.perform(post("/webapi/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(wrongPayload))
            .andExpect(status().isUnauthorized());

        mockMvc.perform(post("/webapi/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(wrongPayload))
            .andExpect(status().isTooManyRequests());
    }
}

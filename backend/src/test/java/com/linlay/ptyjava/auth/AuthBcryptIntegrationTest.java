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
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
    "terminal.auth.password-hash="
})
class AuthBcryptIntegrationTest {

    private static final String BCRYPT_HASH = new BCryptPasswordEncoder().encode("secret123");

    @Autowired
    private MockMvc mockMvc;

    @DynamicPropertySource
    static void authProps(DynamicPropertyRegistry registry) {
        registry.add("terminal.auth.enabled", () -> "true");
        registry.add("terminal.auth.username", () -> "tester");
        registry.add("terminal.auth.password-hash-bcrypt", () -> BCRYPT_HASH);
    }

    @Test
    void bcryptLoginWorks() throws Exception {
        mockMvc.perform(post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "username":"tester",
                      "password":"secret123"
                    }
                    """))
            .andExpect(status().isOk());
    }

    @Test
    void bcryptLoginRejectsWrongPassword() throws Exception {
        mockMvc.perform(post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "username":"tester",
                      "password":"wrong"
                    }
                    """))
            .andExpect(status().isUnauthorized());
    }
}

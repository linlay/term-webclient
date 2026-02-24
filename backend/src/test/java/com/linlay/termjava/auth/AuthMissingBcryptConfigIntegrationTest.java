package com.linlay.termjava.auth;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = {
    "auth.enabled=true",
    "auth.username=tester",
    "auth.password-hash-bcrypt="
})
@AutoConfigureMockMvc
class AuthMissingBcryptConfigIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void loginFailsWhenBcryptHashMissing() throws Exception {
        mockMvc.perform(post("/webapi/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "username":"tester",
                      "password":"secret123"
                    }
                    """))
            .andExpect(status().isInternalServerError())
            .andExpect(jsonPath("$.error").value("auth.password-hash-bcrypt must be configured when auth is enabled"));
    }
}

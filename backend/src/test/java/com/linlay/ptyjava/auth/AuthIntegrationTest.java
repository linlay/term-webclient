package com.linlay.ptyjava.auth;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest
@AutoConfigureMockMvc
class AuthIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @DynamicPropertySource
    static void authProps(DynamicPropertyRegistry registry) {
        registry.add("terminal.auth.enabled", () -> "true");
        registry.add("terminal.auth.username", () -> "tester");
        registry.add("terminal.auth.password-hash", () -> "5d7845ac6ee7cfffafc5fe5f35cf666d");
    }

    @Test
    void unauthenticatedApiCallReturns401() throws Exception {
        mockMvc.perform(get("/api/workdirTree"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void loginCreatesSessionAndAllowsApiCall() throws Exception {
        MvcResult result = mockMvc.perform(post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "username":"tester",
                      "password":"secret123"
                    }
                    """))
            .andExpect(status().isOk())
            .andReturn();

        MockHttpSession session = (MockHttpSession) result.getRequest().getSession(false);

        mockMvc.perform(get("/api/workdirTree").session(session))
            .andExpect(status().isOk());
    }
}

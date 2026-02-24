package com.linlay.termjava.auth;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest
@AutoConfigureMockMvc
class AuthIntegrationTest {

    private static final String BCRYPT_HASH = new BCryptPasswordEncoder().encode("secret123");

    @Autowired
    private MockMvc mockMvc;

    @DynamicPropertySource
    static void authProps(DynamicPropertyRegistry registry) {
        registry.add("auth.enabled", () -> "true");
        registry.add("auth.username", () -> "tester");
        registry.add("auth.password-hash-bcrypt", () -> BCRYPT_HASH);
    }

    @Test
    void unauthenticatedApiCallReturns401() throws Exception {
        mockMvc.perform(get("/webapi/workdirTree"))
            .andExpect(header().exists("X-Request-Id"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void versionEndpointIsPublic() throws Exception {
        mockMvc.perform(get("/webapi/version"))
            .andExpect(status().isOk())
            .andExpect(header().exists("X-Request-Id"));
    }

    @Test
    void loginCreatesSessionAndAllowsApiCall() throws Exception {
        MvcResult result = mockMvc.perform(post("/webapi/auth/login")
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

        mockMvc.perform(get("/webapi/workdirTree").session(session))
            .andExpect(status().isOk());
    }
}

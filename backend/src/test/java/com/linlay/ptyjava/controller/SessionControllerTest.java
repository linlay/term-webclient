package com.linlay.ptyjava.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.linlay.ptyjava.model.CreateSessionResponse;
import com.linlay.ptyjava.config.TerminalProperties;
import com.linlay.ptyjava.service.InvalidSessionRequestException;
import com.linlay.ptyjava.service.TerminalSessionService;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(SessionController.class)
class SessionControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private TerminalSessionService terminalSessionService;

    @MockBean
    private TerminalProperties terminalProperties;

    @Test
    void createSessionReturns201() throws Exception {
        when(terminalSessionService.createSession(any()))
            .thenReturn(new CreateSessionResponse("abc", "/ws/abc", Instant.parse("2026-02-12T00:00:00Z")));

        mockMvc.perform(post("/api/sessions")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.sessionId").value("abc"))
            .andExpect(jsonPath("$.wsUrl").value("/ws/abc"));
    }

    @Test
    void createSessionReturns400OnValidationError() throws Exception {
        when(terminalSessionService.createSession(any()))
            .thenThrow(new InvalidSessionRequestException("bad"));

        mockMvc.perform(post("/api/sessions")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("bad"));
    }

    @Test
    void createSessionReturns500OnUnexpectedError() throws Exception {
        when(terminalSessionService.createSession(any()))
            .thenThrow(new RuntimeException("boom"));

        mockMvc.perform(post("/api/sessions")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
            .andExpect(status().isInternalServerError())
            .andExpect(jsonPath("$.error").value("terminal session operation failed"));
    }

    @Test
    void deleteSessionReturns404WhenMissing() throws Exception {
        when(terminalSessionService.exists(eq("missing"))).thenReturn(false);

        mockMvc.perform(delete("/api/sessions/missing"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error").value("Session not found: missing"));
    }
}

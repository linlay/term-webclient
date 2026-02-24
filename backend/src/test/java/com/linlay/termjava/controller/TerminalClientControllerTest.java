package com.linlay.termjava.controller;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.linlay.termjava.config.TerminalProperties;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(TerminalClientController.class)
class TerminalClientControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private TerminalProperties terminalProperties;

    @Test
    void returnsConfiguredTerminalClients() throws Exception {
        TerminalProperties.CliClientProperties codex = new TerminalProperties.CliClientProperties();
        codex.setId("codex");
        codex.setLabel("Codex");
        codex.setWorkdir(".");

        when(terminalProperties.getCliClients()).thenReturn(List.of(codex));
        when(terminalProperties.getDefaultWorkdir()).thenReturn(".");

        mockMvc.perform(get("/webapi/terminal/clients"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].id").value("codex"))
            .andExpect(jsonPath("$[0].label").value("Codex"))
            .andExpect(jsonPath("$[0].defaultWorkdir").value("."));
    }
}

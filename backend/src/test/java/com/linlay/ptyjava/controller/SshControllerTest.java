package com.linlay.ptyjava.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.linlay.ptyjava.config.TerminalProperties;
import com.linlay.ptyjava.model.ssh.SshAuthType;
import com.linlay.ptyjava.model.ssh.SshCredentialResponse;
import com.linlay.ptyjava.model.ssh.SshCredentialSummaryResponse;
import com.linlay.ptyjava.model.ssh.SshPreflightResponse;
import com.linlay.ptyjava.service.ssh.SshCredentialStore;
import com.linlay.ptyjava.service.ssh.SshCredentialNotFoundException;
import com.linlay.ptyjava.service.ssh.SshExecService;
import com.linlay.ptyjava.service.ssh.SshPreflightService;
import com.linlay.ptyjava.service.ssh.SshSecurityException;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(SshController.class)
class SshControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private SshCredentialStore sshCredentialStore;

    @MockBean
    private SshExecService sshExecService;

    @MockBean
    private SshPreflightService sshPreflightService;

    @MockBean
    private TerminalProperties terminalProperties;

    @Test
    void listCredentialsReturnsSummaries() throws Exception {
        when(sshCredentialStore.listCredentials()).thenReturn(List.of(
            new SshCredentialSummaryResponse(
                "cred-1",
                "10.0.0.2",
                22,
                "ubuntu",
                SshAuthType.PASSWORD,
                Instant.parse("2026-02-14T00:00:00Z")
            )
        ));

        mockMvc.perform(get("/webapi/ssh/credentials"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].credentialId").value("cred-1"))
            .andExpect(jsonPath("$[0].host").value("10.0.0.2"));
    }

    @Test
    void createCredentialReturns201() throws Exception {
        when(sshCredentialStore.createCredential(any())).thenReturn(new SshCredentialResponse(
            "cred-1",
            "10.0.0.2",
            22,
            "ubuntu",
            SshAuthType.PASSWORD,
            Instant.parse("2026-02-14T00:00:00Z")
        ));

        mockMvc.perform(post("/webapi/ssh/credentials")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "host":"10.0.0.2",
                      "username":"ubuntu",
                      "password":"secret"
                    }
                    """))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.credentialId").value("cred-1"));
    }

    @Test
    void createCredentialReturns400OnSecurityError() throws Exception {
        when(sshCredentialStore.createCredential(any())).thenThrow(new SshSecurityException("bad request"));

        mockMvc.perform(post("/webapi/ssh/credentials")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("bad request"));
    }

    @Test
    void preflightReturnsResult() throws Exception {
        when(sshPreflightService.preflight("cred-1"))
            .thenReturn(new SshPreflightResponse("cred-1", false, "failed", 100));

        mockMvc.perform(post("/webapi/ssh/credentials/cred-1/preflight"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.credentialId").value("cred-1"))
            .andExpect(jsonPath("$.success").value(false));
    }

    @Test
    void deleteCredentialReturns204() throws Exception {
        mockMvc.perform(delete("/webapi/ssh/credentials/cred-1"))
            .andExpect(status().isNoContent());
    }

    @Test
    void deleteCredentialReturns404WhenMissing() throws Exception {
        doThrow(new SshCredentialNotFoundException("missing"))
            .when(sshCredentialStore).deleteCredential(eq("missing"));

        mockMvc.perform(delete("/webapi/ssh/credentials/missing"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error").value("SSH credential not found: missing"));
    }
}

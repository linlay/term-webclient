package com.linlay.termjava.service;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.linlay.termjava.config.TerminalProperties;
import com.linlay.termjava.model.CreateSessionRequest;
import com.linlay.termjava.model.CreateSessionResponse;
import com.linlay.termjava.model.RecentSessionItemResponse;
import com.linlay.termjava.model.SessionTabViewResponse;
import com.linlay.termjava.model.SessionType;
import com.linlay.termjava.service.RecentSessionStore;
import com.linlay.termjava.model.ssh.SshAuthType;
import com.linlay.termjava.model.ssh.SshCredentialResponse;
import com.linlay.termjava.service.ssh.SshConnectionPool;
import com.linlay.termjava.service.ssh.SshCredentialStore;
import com.pty4j.PtyProcess;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.PipedInputStream;
import java.io.PipedOutputStream;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;

class TerminalSessionServiceTest {

    private final List<TerminalSessionService> servicesToClose = new java.util.ArrayList<>();

    @AfterEach
    void cleanupSessions() {
        servicesToClose.forEach(service -> {
            service.listSessions().forEach(tab -> service.closeSession(tab.sessionId(), "cleanup", true));
        });
    }

    @Test
    void createSessionSucceedsWithDefaults(@TempDir Path tempDir) throws Exception {
        TerminalProperties props = baseProps(tempDir);
        PtyProcessLauncher launcher = mock(PtyProcessLauncher.class);
        PtyProcess process = mock(PtyProcess.class);

        when(process.getOutputStream()).thenReturn(new ByteArrayOutputStream());
        when(process.getInputStream()).thenReturn(new PipedInputStream(new PipedOutputStream()));
        when(launcher.start(any(), any(), any(), eq(120), eq(30))).thenReturn(process);

        TerminalSessionService service = new TerminalSessionService(
            props,
            launcher,
            mock(SshCredentialStore.class),
            mock(SshConnectionPool.class),
            mock(RecentSessionStore.class),
            new ObjectMapper()
        );
        servicesToClose.add(service);

        CreateSessionResponse response = service.createSession(new CreateSessionRequest());

        assertNotNull(response.sessionId());
        assertEquals("/ws/" + response.sessionId(), response.wsUrl());
        verify(launcher).start(any(), any(), eq(tempDir.toString()), eq(120), eq(30));
    }

    @Test
    void createSessionRejectsInvalidWorkdir(@TempDir Path tempDir) throws Exception {
        TerminalProperties props = baseProps(tempDir);
        PtyProcessLauncher launcher = mock(PtyProcessLauncher.class);
        TerminalSessionService service = new TerminalSessionService(
            props,
            launcher,
            mock(SshCredentialStore.class),
            mock(SshConnectionPool.class),
            mock(RecentSessionStore.class),
            new ObjectMapper()
        );
        servicesToClose.add(service);

        CreateSessionRequest req = new CreateSessionRequest();
        req.setWorkdir(tempDir.resolve("missing").toString());

        assertThrows(InvalidSessionRequestException.class, () -> service.createSession(req));
    }

    @Test
    void closeSessionIsIdempotent(@TempDir Path tempDir) throws Exception {
        TerminalProperties props = baseProps(tempDir);
        PtyProcessLauncher launcher = mock(PtyProcessLauncher.class);
        PtyProcess process = mock(PtyProcess.class);

        PipedOutputStream pos = new PipedOutputStream();
        PipedInputStream pis = new PipedInputStream(pos);

        when(process.getOutputStream()).thenReturn(new ByteArrayOutputStream());
        when(process.getInputStream()).thenReturn(pis);
        when(process.exitValue()).thenReturn(0);
        when(launcher.start(any(), any(), any(), any(Integer.class), any(Integer.class))).thenReturn(process);

        TerminalSessionService service = new TerminalSessionService(
            props,
            launcher,
            mock(SshCredentialStore.class),
            mock(SshConnectionPool.class),
            mock(RecentSessionStore.class),
            new ObjectMapper()
        );
        servicesToClose.add(service);
        CreateSessionResponse response = service.createSession(new CreateSessionRequest());

        assertDoesNotThrow(() -> service.closeSession(response.sessionId(), "test", true));
        assertDoesNotThrow(() -> service.closeSession(response.sessionId(), "test", true));

        pos.close();
        pis.close();
    }

    @Test
    void createSessionRejectsOversizedRows(@TempDir Path tempDir) {
        TerminalProperties props = baseProps(tempDir);
        PtyProcessLauncher launcher = mock(PtyProcessLauncher.class);
        TerminalSessionService service = new TerminalSessionService(
            props,
            launcher,
            mock(SshCredentialStore.class),
            mock(SshConnectionPool.class),
            mock(RecentSessionStore.class),
            new ObjectMapper()
        );
        servicesToClose.add(service);

        CreateSessionRequest req = new CreateSessionRequest();
        req.setRows(9999);

        assertThrows(InvalidSessionRequestException.class, () -> service.createSession(req));
    }

    @Test
    void createSessionUsesCliClientAndPreCommands(@TempDir Path tempDir) throws Exception {
        TerminalProperties props = baseProps(tempDir);
        TerminalProperties.CliClientProperties codex = new TerminalProperties.CliClientProperties();
        codex.setId("codex");
        codex.setLabel("Codex");
        codex.setCommand("codex");
        codex.setArgs(List.of("--profile", "fast"));
        codex.setWorkdir(tempDir.toString());
        codex.setShell("/bin/zsh");
        codex.setPreCommands(List.of(
            "export https_proxy=\"http://127.0.0.1:8001\"",
            "export HTTPS_PROXY=\"http://127.0.0.1:8001\""
        ));
        props.setCliClients(List.of(codex));

        PtyProcessLauncher launcher = mock(PtyProcessLauncher.class);
        PtyProcess process = mock(PtyProcess.class);
        when(process.getOutputStream()).thenReturn(new ByteArrayOutputStream());
        when(process.getInputStream()).thenReturn(new PipedInputStream(new PipedOutputStream()));
        when(launcher.start(any(), any(), any(), eq(120), eq(30))).thenReturn(process);

        TerminalSessionService service = new TerminalSessionService(
            props,
            launcher,
            mock(SshCredentialStore.class),
            mock(SshConnectionPool.class),
            mock(RecentSessionStore.class),
            new ObjectMapper()
        );
        servicesToClose.add(service);

        CreateSessionRequest request = new CreateSessionRequest();
        request.setClientId("codex");
        request.setToolId("codex");
        request.setTabTitle("Codex");
        service.createSession(request);

        ArgumentCaptor<List<String>> commandCaptor = ArgumentCaptor.forClass(List.class);
        verify(launcher).start(commandCaptor.capture(), any(), eq(tempDir.toString()), eq(120), eq(30));
        List<String> command = commandCaptor.getValue();
        assertEquals("/bin/zsh", command.get(0));
        assertEquals("-lc", command.get(1));
        assertTrue(command.get(2).contains("export https_proxy"));
        assertTrue(command.get(2).contains("exec 'codex' '--profile' 'fast'"));
    }

    @Test
    void createSessionRetriesLocalPtyStartupOnce(@TempDir Path tempDir) throws Exception {
        TerminalProperties props = baseProps(tempDir);
        PtyProcessLauncher launcher = mock(PtyProcessLauncher.class);
        PtyProcess process = mock(PtyProcess.class);

        when(process.getOutputStream()).thenReturn(new ByteArrayOutputStream());
        when(process.getInputStream()).thenReturn(new PipedInputStream(new PipedOutputStream()));
        when(launcher.start(any(), any(), any(), eq(120), eq(30)))
            .thenThrow(new IOException("temporary term startup failure"))
            .thenReturn(process);

        TerminalSessionService service = new TerminalSessionService(
            props,
            launcher,
            mock(SshCredentialStore.class),
            mock(SshConnectionPool.class),
            mock(RecentSessionStore.class),
            new ObjectMapper()
        );
        servicesToClose.add(service);

        CreateSessionResponse response = service.createSession(new CreateSessionRequest());
        assertNotNull(response.sessionId());
        verify(launcher, org.mockito.Mockito.times(2)).start(any(), any(), eq(tempDir.toString()), eq(120), eq(30));
    }

    @Test
    void listSessionsReturnsSharedTabMetadata(@TempDir Path tempDir) throws Exception {
        TerminalProperties props = baseProps(tempDir);
        PtyProcessLauncher launcher = mock(PtyProcessLauncher.class);
        PtyProcess process = mock(PtyProcess.class);

        when(process.getOutputStream()).thenReturn(new ByteArrayOutputStream());
        when(process.getInputStream()).thenReturn(new PipedInputStream(new PipedOutputStream()));
        when(launcher.start(any(), any(), any(), eq(120), eq(30))).thenReturn(process);

        TerminalSessionService service = new TerminalSessionService(
            props,
            launcher,
            mock(SshCredentialStore.class),
            mock(SshConnectionPool.class),
            mock(RecentSessionStore.class),
            new ObjectMapper()
        );
        servicesToClose.add(service);

        CreateSessionRequest req = new CreateSessionRequest();
        req.setToolId("terminal");
        req.setTabTitle("main-shell");
        CreateSessionResponse response = service.createSession(req);
        assertNotNull(response.sessionId());

        List<SessionTabViewResponse> sessions = service.listSessions();
        assertEquals(1, sessions.size());
        SessionTabViewResponse tab = sessions.get(0);
        assertEquals("main-shell", tab.title());
        assertEquals("terminal", tab.toolId());
        assertEquals(tempDir.toString(), tab.workdir());
        assertEquals("created", tab.connectionState());
    }

    @Test
    void listRecentSessionsForSshFiltersMissingCredentials(@TempDir Path tempDir) {
        TerminalProperties props = baseProps(tempDir);
        SshCredentialStore sshCredentialStore = mock(SshCredentialStore.class);
        RecentSessionStore recentSessionStore = mock(RecentSessionStore.class);

        CreateSessionRequest validRequest = new CreateSessionRequest();
        validRequest.setSessionType(SessionType.SSH_SHELL);
        validRequest.setToolId("ssh");
        validRequest.setTabTitle("ssh-valid");
        com.linlay.termjava.model.SshSessionRequest validSsh = new com.linlay.termjava.model.SshSessionRequest();
        validSsh.setCredentialId("cred-1");
        validSsh.setTerm("xterm-256color");
        validRequest.setSsh(validSsh);

        CreateSessionRequest invalidRequest = new CreateSessionRequest();
        invalidRequest.setSessionType(SessionType.SSH_SHELL);
        invalidRequest.setToolId("ssh");
        invalidRequest.setTabTitle("ssh-missing");
        com.linlay.termjava.model.SshSessionRequest invalidSsh = new com.linlay.termjava.model.SshSessionRequest();
        invalidSsh.setCredentialId("missing");
        invalidSsh.setTerm("xterm-256color");
        invalidRequest.setSsh(invalidSsh);

        when(recentSessionStore.listByTool("ssh")).thenReturn(List.of(
            new RecentSessionStore.RecentSessionRecord("fp1", "ssh", "ssh-valid", SessionType.SSH_SHELL, ".", Instant.now(), validRequest),
            new RecentSessionStore.RecentSessionRecord("fp2", "ssh", "ssh-missing", SessionType.SSH_SHELL, ".", Instant.now(), invalidRequest)
        ));
        when(sshCredentialStore.listCredentials()).thenReturn(List.of(
            new SshCredentialResponse("cred-1", "prod", "10.0.0.2", 22, "ubuntu", SshAuthType.PASSWORD, Instant.now())
        ));

        TerminalSessionService service = new TerminalSessionService(
            props,
            mock(PtyProcessLauncher.class),
            sshCredentialStore,
            mock(SshConnectionPool.class),
            recentSessionStore,
            new ObjectMapper()
        );
        servicesToClose.add(service);

        List<RecentSessionItemResponse> items = service.listRecentSessions("ssh");
        assertEquals(1, items.size());
        assertEquals("cred-1", items.get(0).request().getSsh().getCredentialId());
        verify(recentSessionStore).replaceToolRecords(eq("ssh"), anyList());
    }

    private TerminalProperties baseProps(Path tempDir) {
        TerminalProperties props = new TerminalProperties();
        props.setDefaultCommand("/bin/sh");
        props.setDefaultArgs(List.of("-i"));
        props.setDefaultWorkdir(tempDir.toString());
        props.setSessionIdleTimeoutSeconds(60);
        props.setWsDisconnectGraceSeconds(30);
        props.setMaxCols(500);
        props.setMaxRows(200);
        return props;
    }
}

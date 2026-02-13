package com.linlay.ptyjava.service;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.linlay.ptyjava.config.TerminalProperties;
import com.linlay.ptyjava.model.CreateSessionRequest;
import com.linlay.ptyjava.model.CreateSessionResponse;
import com.pty4j.PtyProcess;
import java.io.ByteArrayOutputStream;
import java.io.PipedInputStream;
import java.io.PipedOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class TerminalSessionServiceTest {

    @Test
    void createSessionSucceedsWithDefaults(@TempDir Path tempDir) throws Exception {
        TerminalProperties props = baseProps(tempDir);
        PtyProcessLauncher launcher = mock(PtyProcessLauncher.class);
        PtyProcess process = mock(PtyProcess.class);

        when(process.getOutputStream()).thenReturn(new ByteArrayOutputStream());
        when(process.getInputStream()).thenReturn(new PipedInputStream(new PipedOutputStream()));
        when(launcher.start(any(), any(), any(), eq(120), eq(30))).thenReturn(process);

        TerminalSessionService service = new TerminalSessionService(props, launcher, new ObjectMapper());

        CreateSessionResponse response = service.createSession(new CreateSessionRequest());

        assertNotNull(response.sessionId());
        assertEquals("/ws/" + response.sessionId(), response.wsUrl());
        verify(launcher).start(any(), any(), eq(tempDir.toString()), eq(120), eq(30));
    }

    @Test
    void createSessionRejectsInvalidWorkdir(@TempDir Path tempDir) throws Exception {
        TerminalProperties props = baseProps(tempDir);
        PtyProcessLauncher launcher = mock(PtyProcessLauncher.class);
        TerminalSessionService service = new TerminalSessionService(props, launcher, new ObjectMapper());

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

        TerminalSessionService service = new TerminalSessionService(props, launcher, new ObjectMapper());
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
        TerminalSessionService service = new TerminalSessionService(props, launcher, new ObjectMapper());

        CreateSessionRequest req = new CreateSessionRequest();
        req.setRows(9999);

        assertThrows(InvalidSessionRequestException.class, () -> service.createSession(req));
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

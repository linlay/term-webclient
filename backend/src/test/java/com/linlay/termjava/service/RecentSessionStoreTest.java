package com.linlay.termjava.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.linlay.termjava.config.TerminalProperties;
import com.linlay.termjava.model.CreateSessionRequest;
import com.linlay.termjava.model.SessionType;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class RecentSessionStoreTest {

    @Test
    void recordDeduplicatesAndKeepsMostRecentFirst(@TempDir Path tempDir) {
        RecentSessionStore store = newStore(tempDir, 5);
        CreateSessionRequest request = terminalRequest("terminal-1", "/tmp/a");

        store.record("terminal", "terminal-1", SessionType.LOCAL_PTY, "/tmp/a", request);
        store.record("terminal", "terminal-1", SessionType.LOCAL_PTY, "/tmp/a", request);

        List<RecentSessionStore.RecentSessionRecord> records = store.listByTool("terminal");
        assertEquals(1, records.size());
        assertEquals("terminal-1", records.get(0).title());
        assertNotNull(records.get(0).lastUsedAt());
    }

    @Test
    void recordTrimsToPerToolLimit(@TempDir Path tempDir) {
        RecentSessionStore store = newStore(tempDir, 5);
        for (int i = 1; i <= 7; i++) {
            CreateSessionRequest request = terminalRequest("terminal-" + i, "/tmp/" + i);
            store.record("terminal", "terminal-" + i, SessionType.LOCAL_PTY, "/tmp/" + i, request);
        }

        List<RecentSessionStore.RecentSessionRecord> records = store.listByTool("terminal");
        assertEquals(5, records.size());
        assertEquals("terminal-7", records.get(0).title());
        assertEquals("terminal-3", records.get(4).title());
    }

    @Test
    void replaceToolRecordsPersistsFilteredResult(@TempDir Path tempDir) {
        RecentSessionStore store = newStore(tempDir, 5);
        store.record("ssh", "ssh-1", SessionType.SSH_SHELL, ".", sshRequest("cred-1"));
        store.record("ssh", "ssh-2", SessionType.SSH_SHELL, ".", sshRequest("cred-2"));

        List<RecentSessionStore.RecentSessionRecord> records = store.listByTool("ssh");
        store.replaceToolRecords("ssh", List.of(records.get(0)));

        List<RecentSessionStore.RecentSessionRecord> next = store.listByTool("ssh");
        assertEquals(1, next.size());
        assertEquals("ssh-2", next.get(0).title());
    }

    private static RecentSessionStore newStore(Path tempDir, int perToolLimit) {
        TerminalProperties properties = new TerminalProperties();
        properties.setRecentSessionsFile(tempDir.resolve("recent-sessions.json").toString());
        properties.setRecentSessionsPerTool(perToolLimit);
        return new RecentSessionStore(properties, new ObjectMapper().findAndRegisterModules());
    }

    private static CreateSessionRequest terminalRequest(String title, String workdir) {
        CreateSessionRequest request = new CreateSessionRequest();
        request.setSessionType(SessionType.LOCAL_PTY);
        request.setToolId("terminal");
        request.setTabTitle(title);
        request.setWorkdir(workdir);
        request.setCommand("/bin/zsh");
        request.setArgs(List.of("-l"));
        return request;
    }

    private static CreateSessionRequest sshRequest(String credentialId) {
        CreateSessionRequest request = new CreateSessionRequest();
        request.setSessionType(SessionType.SSH_SHELL);
        request.setToolId("ssh");
        request.setTabTitle("ssh-" + credentialId);
        request.setWorkdir(".");
        com.linlay.termjava.model.SshSessionRequest ssh = new com.linlay.termjava.model.SshSessionRequest();
        ssh.setCredentialId(credentialId);
        ssh.setTerm("xterm-256color");
        request.setSsh(ssh);
        return request;
    }
}

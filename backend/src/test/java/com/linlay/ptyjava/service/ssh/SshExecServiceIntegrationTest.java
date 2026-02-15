package com.linlay.ptyjava.service.ssh;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.linlay.ptyjava.config.TerminalProperties;
import com.linlay.ptyjava.model.ssh.SshAuthType;
import com.linlay.ptyjava.model.ssh.SshExecRequest;
import com.linlay.ptyjava.model.ssh.SshExecResponse;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.SocketException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.apache.sshd.server.Environment;
import org.apache.sshd.server.ExitCallback;
import org.apache.sshd.server.SshServer;
import org.apache.sshd.server.channel.ChannelSession;
import org.apache.sshd.server.command.Command;
import org.apache.sshd.server.keyprovider.SimpleGeneratorHostKeyProvider;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class SshExecServiceIntegrationTest {

    private static final String CMD_OK = "__TEST_OK__";
    private static final String CMD_TIMEOUT = "__TEST_TIMEOUT__";
    private static final String CMD_TRUNCATE = "__TEST_TRUNCATE__";

    private SshServer server;
    private SshConnectionPool pool;

    @TempDir
    Path tempDir;

    @AfterEach
    void tearDown() throws IOException {
        if (pool != null) {
            pool.shutdown();
        }
        if (server != null) {
            try {
                server.stop(true);
            } catch (IOException ignored) {
            }
        }
    }

    @Test
    void executesCommandAndReturnsStdoutStderrAndExitCode() throws Exception {
        startExecServer();

        TerminalProperties props = baseProps();
        SshExecService service = buildService(props);
        SshExecRequest request = baseRequest(CMD_OK);

        SshExecResponse response = service.execute(request);

        assertEquals(7, response.exitCode());
        assertFalse(response.timedOut());
        assertFalse(response.stdoutTruncated());
        assertFalse(response.stderrTruncated());
        assertTrue(response.stdout().contains("stdout-ok"));
        assertTrue(response.stderr().contains("stderr-ok"));
    }

    @Test
    void marksTimeoutWhenRemoteCommandDoesNotFinishInTime() throws Exception {
        startExecServer();

        TerminalProperties props = baseProps();
        SshExecService service = buildService(props);
        SshExecRequest request = baseRequest(CMD_TIMEOUT);
        request.setTimeoutSeconds(1);

        SshExecResponse response = service.execute(request);

        assertTrue(response.timedOut());
        assertEquals(-1, response.exitCode());
    }

    @Test
    void truncatesOutputAtConfiguredLimit() throws Exception {
        startExecServer();

        TerminalProperties props = baseProps();
        props.getSsh().setExecMaxOutputBytes(64);
        SshExecService service = buildService(props);
        SshExecRequest request = baseRequest(CMD_TRUNCATE);

        SshExecResponse response = service.execute(request);

        assertTrue(response.stdoutTruncated());
        assertTrue(response.stderrTruncated());
        assertEquals(0, response.exitCode());
        assertTrue(response.stdout().length() <= 1024);
        assertTrue(response.stderr().length() <= 1024);
    }

    private SshExecService buildService(TerminalProperties props) {
        pool = new SshConnectionPool(props, new TofuHostKeyVerifier(new ObjectMapper(), props));
        SshCredentialStore store = mock(SshCredentialStore.class);
        when(store.resolveCredential(eq("cred-1"), isNull(), isNull(), isNull(), isNull()))
            .thenReturn(new ResolvedSshCredential(
                "cred-1",
                "127.0.0.1",
                server.getPort(),
                "tester",
                "xterm-256color",
                SshAuthType.PASSWORD,
                "secret",
                null,
                null
            ));
        return new SshExecService(props, store, pool);
    }

    private TerminalProperties baseProps() {
        TerminalProperties props = new TerminalProperties();
        props.getSsh().setConnectTimeoutMillis(5000);
        props.getSsh().setConnectionIdleTtlSeconds(30);
        props.getSsh().setExecDefaultTimeoutSeconds(5);
        props.getSsh().setExecMaxOutputBytes(1024);
        props.getSsh().setKnownHostsFile(tempDir.resolve("known-hosts.json").toString());
        return props;
    }

    private SshExecRequest baseRequest(String command) {
        SshExecRequest request = new SshExecRequest();
        request.setCredentialId("cred-1");
        request.setCommand(command);
        request.setTimeoutSeconds(3);
        return request;
    }

    private void startExecServer() throws IOException {
        Path hostKeyFile = tempDir.resolve("server-hostkey.ser");
        server = SshServer.setUpDefaultServer();
        server.setHost("127.0.0.1");
        server.setPort(0);
        server.setKeyPairProvider(new SimpleGeneratorHostKeyProvider(hostKeyFile));
        server.setPasswordAuthenticator((username, password, session) ->
            "tester".equals(username) && "secret".equals(password)
        );
        server.setCommandFactory((channel, command) -> new ScriptedExecCommand(command));

        try {
            server.start();
        } catch (SocketException ex) {
            Assumptions.assumeTrue(false, "Socket bind not permitted in this environment");
        }
    }

    private static final class ScriptedExecCommand implements Command, Runnable {

        private final String command;
        private final ExecutorService executor = Executors.newSingleThreadExecutor();

        private OutputStream out;
        private OutputStream err;
        private ExitCallback exitCallback;

        private ScriptedExecCommand(String command) {
            this.command = command == null ? "" : command;
        }

        @Override
        public void setInputStream(InputStream in) {
            // no-op
        }

        @Override
        public void setOutputStream(OutputStream out) {
            this.out = out;
        }

        @Override
        public void setErrorStream(OutputStream err) {
            this.err = err;
        }

        @Override
        public void setExitCallback(ExitCallback callback) {
            this.exitCallback = callback;
        }

        @Override
        public void start(ChannelSession channel, Environment env) {
            executor.submit(this);
        }

        @Override
        public void destroy(ChannelSession channel) {
            executor.shutdownNow();
        }

        @Override
        public void run() {
            int exitCode = 0;
            try {
                if (command.contains(CMD_TIMEOUT)) {
                    Thread.sleep(TimeUnit.SECONDS.toMillis(5));
                } else if (command.contains(CMD_TRUNCATE)) {
                    write(out, "x".repeat(4096));
                    write(err, "y".repeat(4096));
                } else if (command.contains(CMD_OK)) {
                    write(out, "stdout-ok\n");
                    write(err, "stderr-ok\n");
                    exitCode = 7;
                }
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            } catch (IOException ignored) {
            } finally {
                if (exitCallback != null) {
                    exitCallback.onExit(exitCode);
                }
                executor.shutdown();
            }
        }

        private static void write(OutputStream stream, String value) throws IOException {
            if (stream == null || value == null || value.isEmpty()) {
                return;
            }
            stream.write(value.getBytes(StandardCharsets.UTF_8));
            stream.flush();
        }
    }
}

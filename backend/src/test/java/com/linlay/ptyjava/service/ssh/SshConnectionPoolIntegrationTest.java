package com.linlay.ptyjava.service.ssh;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.linlay.ptyjava.config.TerminalProperties;
import com.linlay.ptyjava.model.ssh.SshAuthType;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.SocketException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.EnumSet;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.apache.sshd.client.channel.ChannelExec;
import org.apache.sshd.client.channel.ClientChannelEvent;
import org.apache.sshd.common.session.Session;
import org.apache.sshd.common.session.SessionListener;
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

class SshConnectionPoolIntegrationTest {

    private SshServer server;
    private SshConnectionPool pool;
    private final AtomicInteger sessionCount = new AtomicInteger();

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
    void reusesAuthenticatedConnectionAcrossLeases() throws Exception {
        startExecServer();

        TerminalProperties props = baseProps();
        pool = new SshConnectionPool(props, new TofuHostKeyVerifier(new ObjectMapper(), props));
        ResolvedSshCredential target = passwordCredential("secret");

        String first;
        try (SshConnectionPool.SshConnectionLease lease = pool.acquire(target)) {
            first = runExec(lease.openExecChannel("echo first"));
        }

        String second;
        try (SshConnectionPool.SshConnectionLease lease = pool.acquire(target)) {
            second = runExec(lease.openExecChannel("echo second"));
        }

        assertTrue(first.contains("echo first"));
        assertTrue(second.contains("echo second"));
        assertEquals(1, sessionCount.get());
    }

    @Test
    void failsWhenCredentialPasswordIsInvalid() throws Exception {
        startExecServer();

        TerminalProperties props = baseProps();
        pool = new SshConnectionPool(props, new TofuHostKeyVerifier(new ObjectMapper(), props));
        ResolvedSshCredential target = passwordCredential("wrong-password");

        assertThrows(SshSecurityException.class, () -> {
            try (SshConnectionPool.SshConnectionLease ignored = pool.acquire(target)) {
                // no-op
            }
        });
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
        server.setCommandFactory((channel, command) -> new EchoExecCommand(command));
        server.addSessionListener(new SessionListener() {
            @Override
            public void sessionCreated(Session session) {
                sessionCount.incrementAndGet();
            }
        });

        try {
            server.start();
        } catch (SocketException ex) {
            Assumptions.assumeTrue(false, "Socket bind not permitted in this environment");
        }
    }

    private TerminalProperties baseProps() {
        TerminalProperties props = new TerminalProperties();
        props.getSsh().setConnectTimeoutMillis(5000);
        props.getSsh().setConnectionIdleTtlSeconds(30);
        props.getSsh().setKnownHostsFile(tempDir.resolve("known-hosts.json").toString());
        return props;
    }

    private ResolvedSshCredential passwordCredential(String password) {
        return new ResolvedSshCredential(
            "cred-1",
            "127.0.0.1",
            server.getPort(),
            "tester",
            "xterm-256color",
            SshAuthType.PASSWORD,
            password,
            null,
            null
        );
    }

    private static String runExec(ChannelExec exec) throws Exception {
        try (ChannelExec command = exec) {
            command.waitFor(EnumSet.of(ClientChannelEvent.CLOSED), TimeUnit.SECONDS.toMillis(3));
            return new String(command.getInvertedOut().readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    private static final class EchoExecCommand implements Command, Runnable {

        private final String command;
        private final ExecutorService executor = Executors.newSingleThreadExecutor();

        private OutputStream out;
        private ExitCallback exitCallback;

        private EchoExecCommand(String command) {
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
            // no-op
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
            try {
                if (out != null) {
                    out.write(("executed:" + command + "\n").getBytes(StandardCharsets.UTF_8));
                    out.flush();
                }
            } catch (IOException ignored) {
            } finally {
                if (exitCallback != null) {
                    exitCallback.onExit(0);
                }
                executor.shutdown();
            }
        }
    }
}

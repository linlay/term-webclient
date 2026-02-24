package com.linlay.termjava.service.ssh;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.linlay.termjava.config.TerminalProperties;
import com.linlay.termjava.model.ssh.SshAuthType;
import java.io.ByteArrayOutputStream;
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

class SshShellRuntimeIntegrationTest {

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
    void opensShellHandlesIoAndResize() throws Exception {
        startShellServer();

        TerminalProperties props = new TerminalProperties();
        props.getSsh().setConnectTimeoutMillis(5000);
        props.getSsh().setConnectionIdleTtlSeconds(30);
        props.getSsh().setKnownHostsFile(tempDir.resolve("known-hosts.json").toString());
        pool = new SshConnectionPool(props, new TofuHostKeyVerifier(new ObjectMapper(), props));

        ResolvedSshCredential target = new ResolvedSshCredential(
            "cred-1",
            "127.0.0.1",
            server.getPort(),
            "tester",
            "xterm-256color",
            SshAuthType.PASSWORD,
            "secret",
            null,
            null
        );

        SshShellRuntime runtime = SshShellRuntime.open(pool, target, 100, 30);
        try {
            runtime.inputStream().write("ping\n".getBytes(StandardCharsets.UTF_8));
            runtime.inputStream().flush();

            String echoed = readUntilContains(runtime.outputStream(), "ECHO:ping", TimeUnit.SECONDS.toMillis(3));
            assertTrue(echoed.contains("ECHO:ping"));

            runtime.resize(140, 45);

            runtime.inputStream().write("exit\n".getBytes(StandardCharsets.UTF_8));
            runtime.inputStream().flush();
            assertEquals(0, runtime.awaitExit());
        } finally {
            runtime.close();
        }
    }

    private void startShellServer() throws IOException {
        Path hostKeyFile = tempDir.resolve("server-hostkey.ser");
        server = SshServer.setUpDefaultServer();
        server.setHost("127.0.0.1");
        server.setPort(0);
        server.setKeyPairProvider(new SimpleGeneratorHostKeyProvider(hostKeyFile));
        server.setPasswordAuthenticator((username, password, session) ->
            "tester".equals(username) && "secret".equals(password)
        );
        server.setShellFactory(channel -> new EchoShellCommand());

        try {
            server.start();
        } catch (SocketException ex) {
            Assumptions.assumeTrue(false, "Socket bind not permitted in this environment");
        }
    }

    private static String readUntilContains(InputStream stream, String token, long timeoutMs) throws Exception {
        long deadline = System.currentTimeMillis() + timeoutMs;
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[256];

        while (System.currentTimeMillis() < deadline) {
            while (stream.available() > 0) {
                int read = stream.read(chunk);
                if (read > 0) {
                    buffer.write(chunk, 0, read);
                }
            }
            String text = buffer.toString(StandardCharsets.UTF_8);
            if (text.contains(token)) {
                return text;
            }
            Thread.sleep(20L);
        }
        return buffer.toString(StandardCharsets.UTF_8);
    }

    private static final class EchoShellCommand implements Command, Runnable {

        private final ExecutorService executor = Executors.newSingleThreadExecutor();

        private InputStream in;
        private OutputStream out;
        private ExitCallback exitCallback;

        @Override
        public void setInputStream(InputStream in) {
            this.in = in;
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
            int exitCode = 0;
            try {
                StringBuilder line = new StringBuilder();
                int value;
                while ((value = in.read()) != -1) {
                    if (value == '\r') {
                        continue;
                    }
                    if (value == '\n') {
                        String text = line.toString();
                        if ("exit".equals(text)) {
                            writeLine("BYE");
                            break;
                        }
                        writeLine("ECHO:" + text);
                        line.setLength(0);
                        continue;
                    }
                    line.append((char) value);
                }
            } catch (IOException ignored) {
                exitCode = 1;
            } finally {
                if (exitCallback != null) {
                    exitCallback.onExit(exitCode);
                }
                executor.shutdown();
            }
        }

        private void writeLine(String text) throws IOException {
            if (out == null) {
                return;
            }
            out.write((text + "\n").getBytes(StandardCharsets.UTF_8));
            out.flush();
        }
    }
}

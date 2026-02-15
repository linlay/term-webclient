package com.linlay.ptyjava.service.ssh;

import com.linlay.ptyjava.config.TerminalProperties;
import com.linlay.ptyjava.model.ssh.SshExecRequest;
import com.linlay.ptyjava.model.ssh.SshExecResponse;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;
import org.apache.sshd.client.channel.ChannelExec;
import org.apache.sshd.client.channel.ClientChannelEvent;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class SshExecService {

    private static final Pattern ENV_KEY_PATTERN = Pattern.compile("[A-Za-z_][A-Za-z0-9_]*");

    private final TerminalProperties properties;
    private final SshCredentialStore credentialStore;
    private final SshConnectionPool connectionPool;
    private final ExecutorService ioExecutor = Executors.newCachedThreadPool(r -> {
        Thread thread = new Thread(r, "ssh-exec-io");
        thread.setDaemon(true);
        return thread;
    });

    public SshExecService(TerminalProperties properties,
                          SshCredentialStore credentialStore,
                          SshConnectionPool connectionPool) {
        this.properties = properties;
        this.credentialStore = credentialStore;
        this.connectionPool = connectionPool;
    }

    public SshExecResponse execute(SshExecRequest request) {
        if (!properties.getSsh().isEnabled()) {
            throw new SshSecurityException("SSH is disabled");
        }
        if (request == null) {
            throw new SshSecurityException("request must not be null");
        }
        if (!StringUtils.hasText(request.getCredentialId())) {
            throw new SshSecurityException("credentialId must not be blank");
        }
        if (!StringUtils.hasText(request.getCommand())) {
            throw new SshSecurityException("command must not be blank");
        }

        int timeoutSeconds = request.getTimeoutSeconds() == null
            ? properties.getSsh().getExecDefaultTimeoutSeconds()
            : request.getTimeoutSeconds();
        timeoutSeconds = Math.max(1, timeoutSeconds);

        int maxOutputBytes = Math.max(1024, properties.getSsh().getExecMaxOutputBytes());

        ResolvedSshCredential target = credentialStore.resolveCredential(
            request.getCredentialId(),
            null,
            null,
            null,
            null
        );

        String wrappedCommand = wrapCommand(request.getCommand(), request.getCwd(), request.getEnv());
        Instant started = Instant.now();

        try (SshConnectionPool.SshConnectionLease lease = connectionPool.acquire(target)) {
            ChannelExec command = lease.openExecChannel(wrappedCommand);
            try {
                Future<StreamReadResult> stdoutFuture = ioExecutor.submit(readStream(command.getInvertedOut(), maxOutputBytes));
                Future<StreamReadResult> stderrFuture = ioExecutor.submit(readStream(command.getInvertedErr(), maxOutputBytes));

                boolean timedOut = !waitForCompletion(command, timeoutSeconds);
                if (timedOut) {
                    command.close(true);
                }

                StreamReadResult stdout = await(stdoutFuture);
                StreamReadResult stderr = await(stderrFuture);

                Integer exit = command.getExitStatus();
                int exitCode = timedOut ? -1 : (exit == null ? -1 : exit);
                long durationMs = Duration.between(started, Instant.now()).toMillis();

                return new SshExecResponse(
                    new String(stdout.bytes(), StandardCharsets.UTF_8),
                    new String(stderr.bytes(), StandardCharsets.UTF_8),
                    exitCode,
                    durationMs,
                    timedOut,
                    stdout.truncated(),
                    stderr.truncated()
                );
            } finally {
                command.close(false);
            }
        } catch (IOException e) {
            throw new SshSecurityException("SSH exec failed", e);
        }
    }

    private Callable<StreamReadResult> readStream(InputStream inputStream, int maxBytes) {
        return () -> {
            if (inputStream == null) {
                return new StreamReadResult(new byte[0], false);
            }

            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[4096];
            boolean truncated = false;

            int read;
            while ((read = inputStream.read(chunk)) != -1) {
                if (read <= 0) {
                    continue;
                }

                int room = maxBytes - buffer.size();
                if (room > 0) {
                    int writeLen = Math.min(room, read);
                    buffer.write(chunk, 0, writeLen);
                    if (writeLen < read) {
                        truncated = true;
                    }
                } else {
                    truncated = true;
                }
            }

            return new StreamReadResult(buffer.toByteArray(), truncated);
        };
    }

    private StreamReadResult await(Future<StreamReadResult> future) {
        try {
            return future.get();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new SshSecurityException("Interrupted while waiting SSH output", e);
        } catch (ExecutionException e) {
            Throwable cause = e.getCause();
            if (cause instanceof RuntimeException runtimeException) {
                throw runtimeException;
            }
            throw new SshSecurityException("Failed while reading SSH output", cause);
        }
    }

    private boolean waitForCompletion(ChannelExec command, int timeoutSeconds) {
        long timeoutMillis = Math.max(1L, TimeUnit.SECONDS.toMillis(timeoutSeconds));
        Set<ClientChannelEvent> events = command.waitFor(
            EnumSet.of(ClientChannelEvent.CLOSED, ClientChannelEvent.TIMEOUT),
            timeoutMillis
        );
        return !(events.contains(ClientChannelEvent.TIMEOUT) && !events.contains(ClientChannelEvent.CLOSED));
    }

    private String wrapCommand(String command, String cwd, Map<String, String> env) {
        StringBuilder script = new StringBuilder();

        if (StringUtils.hasText(cwd)) {
            script.append("cd ").append(shellQuote(cwd.trim())).append(" && ");
        }

        if (env != null && !env.isEmpty()) {
            for (Map.Entry<String, String> entry : env.entrySet()) {
                if (!ENV_KEY_PATTERN.matcher(entry.getKey()).matches()) {
                    throw new SshSecurityException("Invalid env key: " + entry.getKey());
                }
                script.append(entry.getKey())
                    .append("=")
                    .append(shellQuote(entry.getValue() == null ? "" : entry.getValue()))
                    .append(" ");
            }
        }

        script.append(command);
        return "bash -lc " + shellQuote(script.toString());
    }

    private String shellQuote(String value) {
        return "'" + value.replace("'", "'\"'\"'") + "'";
    }

    private record StreamReadResult(byte[] bytes, boolean truncated) {
    }
}

package com.linlay.termjava.service.ssh;

import com.linlay.termjava.config.TerminalProperties;
import com.linlay.termjava.model.ssh.SshAuthType;
import jakarta.annotation.PreDestroy;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyPair;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.apache.sshd.client.SshClient;
import org.apache.sshd.client.channel.ChannelExec;
import org.apache.sshd.client.channel.ChannelShell;
import org.apache.sshd.client.future.AuthFuture;
import org.apache.sshd.client.future.ConnectFuture;
import org.apache.sshd.client.session.ClientSession;
import org.apache.sshd.common.NamedResource;
import org.apache.sshd.common.channel.PtyChannelConfiguration;
import org.apache.sshd.common.config.keys.FilePasswordProvider;
import org.apache.sshd.common.util.security.SecurityUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class SshConnectionPool {

    private static final Logger log = LoggerFactory.getLogger(SshConnectionPool.class);
    private static final int MAX_CONNECT_ATTEMPTS = 3;
    private static final long RETRY_BASE_DELAY_MILLIS = 1000L;
    private static final Set<ClientSession.ClientSessionEvent> AUTHED_STATE =
        Set.of(ClientSession.ClientSessionEvent.AUTHED);

    private final TerminalProperties properties;
    private final TofuHostKeyVerifier hostKeyVerifier;
    private final ConcurrentMap<SshConnectionKey, PooledConnection> pool = new ConcurrentHashMap<>();
    private final ConcurrentMap<SshConnectionKey, CompletableFuture<PooledConnection>> inflightConnects =
        new ConcurrentHashMap<>();
    private final ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(1);

    public SshConnectionPool(TerminalProperties properties,
                             TofuHostKeyVerifier hostKeyVerifier) {
        this.properties = properties;
        this.hostKeyVerifier = hostKeyVerifier;
    }

    public SshConnectionLease acquire(ResolvedSshCredential target) {
        if (target == null) {
            throw new SshSecurityException("Resolved SSH target must not be null");
        }

        SshConnectionKey key = new SshConnectionKey(target.host(), target.port(), target.username(), target.credentialId());

        // Fast path: reuse existing healthy connection
        PooledConnection existing = pool.get(key);
        if (existing != null && existing.isConnected()) {
            existing.retain();
            return new SshConnectionLease(this, key, existing, target);
        }

        // Slow path: coalesce concurrent connect attempts for the same key
        boolean[] isConnector = {false};
        CompletableFuture<PooledConnection> flight = inflightConnects.computeIfAbsent(key, k -> {
            isConnector[0] = true;
            return new CompletableFuture<>();
        });

        if (isConnector[0]) {
            return doConnect(key, existing, target, flight);
        }
        return awaitFlight(key, target, flight);
    }

    @PreDestroy
    void shutdown() {
        for (PooledConnection connection : pool.values()) {
            connection.forceClose();
        }
        pool.clear();
        inflightConnects.clear();
        scheduler.shutdownNow();
    }

    private SshConnectionLease doConnect(SshConnectionKey key,
                                         PooledConnection existing,
                                         ResolvedSshCredential target,
                                         CompletableFuture<PooledConnection> flight) {
        PooledConnection installed;
        try {
            PooledConnection newConn = connect(target);
            installed = pool.compute(key, (k, current) -> {
                if (current != null && current.isConnected() && current != existing) {
                    newConn.forceClose();
                    return current;
                }
                if (current != null) {
                    current.forceClose();
                }
                return newConn;
            });
        } catch (Throwable ex) {
            inflightConnects.remove(key, flight);
            flight.completeExceptionally(ex);
            throw ex;
        }

        // Remove before complete: late arrivals hit fast-path (pool.get) instead of stale future
        inflightConnects.remove(key, flight);
        flight.complete(installed);

        installed.retain();
        return new SshConnectionLease(this, key, installed, target);
    }

    private SshConnectionLease awaitFlight(SshConnectionKey key,
                                           ResolvedSshCredential target,
                                           CompletableFuture<PooledConnection> flight) {
        PooledConnection result;
        try {
            result = flight.join();
        } catch (CompletionException ce) {
            Throwable cause = ce.getCause();
            if (cause instanceof RuntimeException re) {
                throw re;
            }
            throw new SshSecurityException("SSH connection failed (shared attempt)", cause);
        }
        result.retain();
        return new SshConnectionLease(this, key, result, target);
    }

    private PooledConnection connect(ResolvedSshCredential target) {
        IOException lastError = null;
        boolean transientFailureOnly = true;
        for (int attempt = 1; attempt <= MAX_CONNECT_ATTEMPTS; attempt++) {
            try {
                return connectOnce(target);
            } catch (IOException e) {
                lastError = e;
                boolean transientHandshakeFailure = isTransientHandshakeFailure(e);
                transientFailureOnly = transientFailureOnly && transientHandshakeFailure;
                if (!transientHandshakeFailure) {
                    throw new SshSecurityException("Failed to connect SSH target", e);
                }
                if (attempt >= MAX_CONNECT_ATTEMPTS) {
                    break;
                }
                log.warn(
                    "Transient SSH connect failure on attempt {}/{} for {}@{}:{} (credential={}): {}",
                    attempt,
                    MAX_CONNECT_ATTEMPTS,
                    target.username(),
                    target.host(),
                    target.port(),
                    target.credentialId(),
                    compactDiagnostic(e)
                );
                sleepBeforeRetry(attempt);
            }
        }
        if (transientFailureOnly && lastError != null) {
            throw new SshSecurityException(
                "SSH handshake repeatedly closed during identification exchange after "
                    + MAX_CONNECT_ATTEMPTS
                    + " attempts",
                lastError
            );
        }
        throw new SshSecurityException("Failed to connect SSH target", lastError);
    }

    private PooledConnection connectOnce(ResolvedSshCredential target) throws IOException {
        SshClient client = SshClient.setUpDefaultClient();
        client.setServerKeyVerifier((session, remoteAddress, serverKey) ->
            hostKeyVerifier.verify(target.host(), target.port(), serverKey)
        );
        client.start();

        ClientSession session = null;
        boolean connected = false;
        try {
            ConnectFuture connectFuture = client.connect(target.username(), target.host(), target.port());
            connectFuture.verify(properties.getSsh().getConnectTimeoutMillis(), TimeUnit.MILLISECONDS);
            session = connectFuture.getSession();
            connected = true;

            authenticate(session, target);
            return new PooledConnection(client, session);
        } catch (IOException | RuntimeException ex) {
            closeQuietly(session);
            if (!connected) {
                stopQuietly(client);
            } else {
                forceCloseClient(client);
            }
            if (ex instanceof IOException ioException) {
                throw ioException;
            }
            throw ex;
        }
    }

    private void authenticate(ClientSession session, ResolvedSshCredential target) throws IOException {
        if (target.authType() == SshAuthType.PASSWORD) {
            authenticateWithPassword(session, target);
            return;
        }
        authenticateWithPrivateKey(session, target);
    }

    private void authenticateWithPassword(ClientSession session, ResolvedSshCredential target) throws IOException {
        if (!StringUtils.hasText(target.password())) {
            throw new SshSecurityException("SSH password is missing for credential " + target.credentialId());
        }
        session.addPasswordIdentity(target.password());
        AuthFuture authFuture = session.auth();
        authFuture.verify(properties.getSsh().getConnectTimeoutMillis(), TimeUnit.MILLISECONDS);
    }

    private void authenticateWithPrivateKey(ClientSession session, ResolvedSshCredential target) throws IOException {
        if (!StringUtils.hasText(target.privateKey())) {
            throw new SshSecurityException("SSH private key is missing for credential " + target.credentialId());
        }

        try (ByteArrayInputStream keyInput = new ByteArrayInputStream(target.privateKey().getBytes(StandardCharsets.UTF_8))) {
            FilePasswordProvider passwordProvider = StringUtils.hasText(target.privateKeyPassphrase())
                ? FilePasswordProvider.of(target.privateKeyPassphrase())
                : FilePasswordProvider.EMPTY;
            Iterable<KeyPair> keyPairs = SecurityUtils.loadKeyPairIdentities(
                null,
                NamedResource.ofName("inline-private-key"),
                keyInput,
                passwordProvider
            );
            boolean hasKey = false;
            for (KeyPair keyPair : keyPairs) {
                session.addPublicKeyIdentity(keyPair);
                hasKey = true;
            }
            if (!hasKey) {
                throw new SshSecurityException("SSH private key is invalid for credential " + target.credentialId());
            }
            AuthFuture authFuture = session.auth();
            authFuture.verify(properties.getSsh().getConnectTimeoutMillis(), TimeUnit.MILLISECONDS);
        } catch (GeneralSecurityException e) {
            throw new IOException("Failed to parse SSH private key", e);
        }
    }

    private void sleepBeforeRetry(int attempt) {
        try {
            Thread.sleep(RETRY_BASE_DELAY_MILLIS * attempt);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new SshSecurityException("Interrupted while retrying SSH connection", interrupted);
        }
    }

    private boolean isTransientHandshakeFailure(Throwable throwable) {
        Throwable cursor = throwable;
        while (cursor != null) {
            String normalized = compactDiagnostic(cursor).toLowerCase(Locale.ROOT);
            if (normalized.contains("maxstartups")
                || normalized.contains("exceeded maxstartups")
                || normalized.contains("no identification received")
                || normalized.contains("identification exchange")
                || (normalized.contains("end of connection") && normalized.contains("identification"))
                || normalized.contains("kexinit")
                || normalized.contains("key exchange failed")) {
                return true;
            }
            cursor = cursor.getCause();
        }
        return false;
    }

    private String compactDiagnostic(Throwable throwable) {
        if (throwable == null) {
            return "";
        }
        String message = throwable.getMessage();
        String value = StringUtils.hasText(message) ? message.trim() : throwable.toString();
        if (!StringUtils.hasText(value)) {
            return "";
        }
        return value.length() > 220 ? value.substring(0, 220) + "..." : value;
    }

    private void release(SshConnectionKey key, PooledConnection connection) {
        int refs = connection.release();
        if (refs > 0) {
            return;
        }

        int ttl = Math.max(1, properties.getSsh().getConnectionIdleTtlSeconds());
        ScheduledFuture<?> task = scheduler.schedule(() -> {
            if (connection.currentRefs() > 0) {
                return;
            }
            if (pool.remove(key, connection)) {
                connection.forceClose();
            }
        }, ttl, TimeUnit.SECONDS);
        connection.setIdleCloseTask(task);
    }

    public final class SshConnectionLease implements AutoCloseable {

        private final SshConnectionPool owner;
        private final SshConnectionKey key;
        private final PooledConnection connection;
        private final ResolvedSshCredential target;
        private boolean closed;

        private SshConnectionLease(SshConnectionPool owner,
                                   SshConnectionKey key,
                                   PooledConnection connection,
                                   ResolvedSshCredential target) {
            this.owner = owner;
            this.key = key;
            this.connection = connection;
            this.target = target;
        }

        public ChannelShell openShellChannel(String term, int cols, int rows) throws IOException {
            return connection.openShellChannel(
                StringUtils.hasText(term) ? term.trim() : target.term(),
                cols,
                rows,
                properties.getSsh().getConnectTimeoutMillis()
            );
        }

        public ChannelExec openExecChannel(String command) throws IOException {
            if (!StringUtils.hasText(command)) {
                throw new SshSecurityException("SSH command must not be blank");
            }
            return connection.openExecChannel(command, properties.getSsh().getConnectTimeoutMillis());
        }

        @Override
        public synchronized void close() {
            if (closed) {
                return;
            }
            closed = true;
            owner.release(key, connection);
        }
    }

    private static final class PooledConnection {

        private final SshClient client;
        private final ClientSession session;
        private final AtomicInteger refs = new AtomicInteger(0);
        private final Object lock = new Object();
        private volatile ScheduledFuture<?> idleCloseTask;

        private PooledConnection(SshClient client, ClientSession session) {
            this.client = client;
            this.session = session;
        }

        private boolean isConnected() {
            return session != null
                && session.isOpen()
                && session.getSessionState().containsAll(AUTHED_STATE);
        }

        private void retain() {
            synchronized (lock) {
                cancelIdleTask();
                refs.incrementAndGet();
            }
        }

        private int release() {
            synchronized (lock) {
                int value = refs.decrementAndGet();
                if (value < 0) {
                    refs.set(0);
                    return 0;
                }
                return value;
            }
        }

        private int currentRefs() {
            return refs.get();
        }

        private ChannelShell openShellChannel(String term, int cols, int rows, int openTimeoutMillis) throws IOException {
            PtyChannelConfiguration config = new PtyChannelConfiguration();
            config.setPtyType(StringUtils.hasText(term) ? term : "xterm-256color");
            config.setPtyColumns(Math.max(1, cols));
            config.setPtyLines(Math.max(1, rows));
            config.setPtyWidth(0);
            config.setPtyHeight(0);

            ChannelShell shell = session.createShellChannel(config, Map.of());
            try {
                shell.open().verify(openTimeoutMillis, TimeUnit.MILLISECONDS);
                return shell;
            } catch (IOException | RuntimeException e) {
                closeQuietly(shell);
                if (e instanceof IOException ioException) {
                    throw ioException;
                }
                throw new IOException("Failed to open SSH shell channel", e);
            }
        }

        private ChannelExec openExecChannel(String command, int openTimeoutMillis) throws IOException {
            ChannelExec exec = session.createExecChannel(command);
            try {
                exec.open().verify(openTimeoutMillis, TimeUnit.MILLISECONDS);
                return exec;
            } catch (IOException | RuntimeException e) {
                closeQuietly(exec);
                if (e instanceof IOException ioException) {
                    throw ioException;
                }
                throw new IOException("Failed to open SSH exec channel", e);
            }
        }

        private void setIdleCloseTask(ScheduledFuture<?> task) {
            synchronized (lock) {
                cancelIdleTask();
                idleCloseTask = task;
            }
        }

        private void cancelIdleTask() {
            ScheduledFuture<?> task = idleCloseTask;
            if (task != null) {
                task.cancel(false);
                idleCloseTask = null;
            }
        }

        private void forceClose() {
            synchronized (lock) {
                cancelIdleTask();
                closeQuietly(session);
                forceCloseClient(client);
            }
        }
    }

    private static void closeQuietly(org.apache.sshd.common.Closeable closeable) {
        if (closeable == null) {
            return;
        }
        try {
            closeable.close();
        } catch (IOException ignored) {
        }
    }

    private static void stopQuietly(SshClient client) {
        if (client == null) {
            return;
        }
        try {
            client.stop();
        } catch (RuntimeException ignored) {
        }
    }

    private static void forceCloseClient(SshClient client) {
        if (client == null) {
            return;
        }
        try {
            client.stop();
        } catch (RuntimeException ignored) {
        }
        try {
            client.close(true);
        } catch (RuntimeException ignored) {
        }
    }

    private record SshConnectionKey(String host, int port, String username, String credentialId) {

        @Override
        public boolean equals(Object obj) {
            if (this == obj) {
                return true;
            }
            if (!(obj instanceof SshConnectionKey other)) {
                return false;
            }
            return Objects.equals(host, other.host)
                && port == other.port
                && Objects.equals(username, other.username)
                && Objects.equals(credentialId, other.credentialId);
        }

        @Override
        public int hashCode() {
            return Objects.hash(host, port, username, credentialId);
        }
    }
}

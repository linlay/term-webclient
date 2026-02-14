package com.linlay.ptyjava.service.ssh;

import com.linlay.ptyjava.config.TerminalProperties;
import com.linlay.ptyjava.model.ssh.SshAuthType;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import net.schmizz.sshj.SSHClient;
import net.schmizz.sshj.connection.channel.direct.Session;
import net.schmizz.sshj.userauth.keyprovider.KeyProvider;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class SshConnectionPool {

    private final TerminalProperties properties;
    private final TofuHostKeyVerifier hostKeyVerifier;
    private final ConcurrentMap<SshConnectionKey, PooledConnection> pool = new ConcurrentHashMap<>();
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
        PooledConnection connection = pool.compute(key, (k, existing) -> {
            if (existing != null && existing.isConnected()) {
                return existing;
            }
            if (existing != null) {
                existing.forceClose();
            }
            return connect(target);
        });

        connection.retain();
        return new SshConnectionLease(this, key, connection);
    }

    private PooledConnection connect(ResolvedSshCredential target) {
        try {
            SSHClient client = new SSHClient();
            client.setConnectTimeout(properties.getSsh().getConnectTimeoutMillis());
            client.setTimeout(properties.getSsh().getConnectTimeoutMillis());
            client.addHostKeyVerifier(hostKeyVerifier);
            client.connect(target.host(), target.port());
            authenticate(client, target);
            return new PooledConnection(client);
        } catch (IOException e) {
            throw new SshSecurityException("Failed to connect SSH target", e);
        }
    }

    private void authenticate(SSHClient client, ResolvedSshCredential target) throws IOException {
        if (target.authType() == SshAuthType.PASSWORD) {
            if (!StringUtils.hasText(target.password())) {
                throw new SshSecurityException("SSH password is missing for credential " + target.credentialId());
            }
            client.authPassword(target.username(), target.password());
            return;
        }

        if (!StringUtils.hasText(target.privateKey())) {
            throw new SshSecurityException("SSH private key is missing for credential " + target.credentialId());
        }

        Path keyPath = null;
        try {
            keyPath = Files.createTempFile("pty-ssh-key-", ".pem");
            Files.writeString(keyPath, target.privateKey(), StandardCharsets.UTF_8);

            KeyProvider keyProvider;
            if (StringUtils.hasText(target.privateKeyPassphrase())) {
                keyProvider = client.loadKeys(keyPath.toString(), target.privateKeyPassphrase());
            } else {
                keyProvider = client.loadKeys(keyPath.toString());
            }

            client.authPublickey(target.username(), keyProvider);
        } finally {
            if (keyPath != null) {
                try {
                    Files.deleteIfExists(keyPath);
                } catch (IOException ignored) {
                }
            }
        }
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
        private boolean closed;

        private SshConnectionLease(SshConnectionPool owner, SshConnectionKey key, PooledConnection connection) {
            this.owner = owner;
            this.key = key;
            this.connection = connection;
        }

        public Session openSession() throws IOException {
            return connection.openSession();
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

        private final SSHClient client;
        private final AtomicInteger refs = new AtomicInteger(0);
        private final Object lock = new Object();
        private volatile ScheduledFuture<?> idleCloseTask;

        private PooledConnection(SSHClient client) {
            this.client = client;
        }

        private boolean isConnected() {
            return client.isConnected() && client.isAuthenticated();
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

        private Session openSession() throws IOException {
            return client.startSession();
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
                try {
                    client.disconnect();
                } catch (IOException ignored) {
                }
                try {
                    client.close();
                } catch (IOException ignored) {
                }
            }
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

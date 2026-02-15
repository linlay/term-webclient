package com.linlay.ptyjava.service.ssh;

import com.linlay.ptyjava.model.ssh.SshPreflightResponse;
import java.time.Duration;
import java.time.Instant;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class SshPreflightService {

    private final SshCredentialStore credentialStore;
    private final SshConnectionPool connectionPool;

    public SshPreflightService(SshCredentialStore credentialStore,
                               SshConnectionPool connectionPool) {
        this.credentialStore = credentialStore;
        this.connectionPool = connectionPool;
    }

    public SshPreflightResponse preflight(String credentialId) {
        if (!StringUtils.hasText(credentialId)) {
            throw new SshSecurityException("credentialId is required");
        }

        Instant started = Instant.now();
        ResolvedSshCredential target = credentialStore.resolveCredential(credentialId, null, null, null, null);

        try (SshConnectionPool.SshConnectionLease lease = connectionPool.acquire(target)) {
            long durationMs = Duration.between(started, Instant.now()).toMillis();
            return new SshPreflightResponse(
                credentialId,
                true,
                "SSH preflight succeeded",
                durationMs
            );
        } catch (SshCredentialNotFoundException ex) {
            throw ex;
        } catch (RuntimeException ex) {
            long durationMs = Duration.between(started, Instant.now()).toMillis();
            return new SshPreflightResponse(
                credentialId,
                false,
                SshErrorMapper.toUserMessage(ex, "SSH preflight failed"),
                durationMs
            );
        }
    }
}

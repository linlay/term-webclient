package com.linlay.termjava.model.ssh;

import java.time.Instant;

public record SshCredentialResponse(
    String credentialId,
    String host,
    int port,
    String username,
    SshAuthType authType,
    Instant createdAt
) {
}

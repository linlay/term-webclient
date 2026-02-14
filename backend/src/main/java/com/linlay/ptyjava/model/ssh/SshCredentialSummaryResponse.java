package com.linlay.ptyjava.model.ssh;

import java.time.Instant;

public record SshCredentialSummaryResponse(
    String credentialId,
    String host,
    int port,
    String username,
    SshAuthType authType,
    Instant createdAt
) {
}

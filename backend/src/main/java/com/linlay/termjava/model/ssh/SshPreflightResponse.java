package com.linlay.termjava.model.ssh;

public record SshPreflightResponse(
    String credentialId,
    boolean success,
    String message,
    long durationMs
) {
}

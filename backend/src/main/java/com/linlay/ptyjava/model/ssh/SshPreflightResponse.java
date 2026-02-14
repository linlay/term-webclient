package com.linlay.ptyjava.model.ssh;

public record SshPreflightResponse(
    String credentialId,
    boolean success,
    String message,
    long durationMs
) {
}

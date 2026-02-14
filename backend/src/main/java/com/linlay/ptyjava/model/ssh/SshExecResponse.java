package com.linlay.ptyjava.model.ssh;

public record SshExecResponse(
    String stdout,
    String stderr,
    int exitCode,
    long durationMs,
    boolean timedOut,
    boolean stdoutTruncated,
    boolean stderrTruncated
) {
}

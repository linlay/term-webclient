package com.linlay.ptyjava.model;

import java.time.Instant;

public record CommandFrame(
    String commandId,
    String source,
    String command,
    double boundaryConfidence,
    Instant startedAt,
    Instant endedAt,
    Long durationMs,
    Integer exitCode,
    String status
) {
}

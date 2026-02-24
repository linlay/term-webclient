package com.linlay.termjava.model;

import java.time.Instant;

public record SessionMetaState(
    String sessionId,
    SessionType sessionType,
    String connectionState,
    long lastSeq,
    int attachedClients,
    Integer lastExitCode,
    int commandCount,
    boolean truncated,
    String lastError,
    String lastWorkdir,
    Instant startedAt,
    Instant lastActivityAt,
    Instant updatedAt
) {
}

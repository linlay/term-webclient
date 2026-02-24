package com.linlay.termjava.model;

import java.time.Instant;

public record SessionTabViewResponse(
    String sessionId,
    String wsUrl,
    String title,
    String toolId,
    SessionType sessionType,
    String workdir,
    String fileRootPath,
    Instant startedAt,
    String connectionState
) {
}

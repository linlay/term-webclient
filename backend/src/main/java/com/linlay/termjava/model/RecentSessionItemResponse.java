package com.linlay.termjava.model;

import java.time.Instant;

public record RecentSessionItemResponse(
    String toolId,
    String title,
    SessionType sessionType,
    String workdir,
    Instant lastUsedAt,
    CreateSessionRequest request
) {
}

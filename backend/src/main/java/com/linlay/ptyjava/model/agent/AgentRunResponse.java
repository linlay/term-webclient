package com.linlay.ptyjava.model.agent;

import java.time.Instant;
import java.util.List;

public record AgentRunResponse(
    String runId,
    String sessionId,
    String instruction,
    AgentRunStatus status,
    String message,
    Instant createdAt,
    Instant updatedAt,
    List<AgentStepResponse> steps
) {
}

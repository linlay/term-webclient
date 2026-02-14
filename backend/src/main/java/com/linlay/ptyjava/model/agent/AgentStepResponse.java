package com.linlay.ptyjava.model.agent;

import java.time.Instant;
import java.util.Map;

public record AgentStepResponse(
    int stepIndex,
    String tool,
    String title,
    AgentStepStatus status,
    boolean highRisk,
    Map<String, Object> arguments,
    String resultSummary,
    String error,
    Instant createdAt,
    Instant updatedAt
) {
}

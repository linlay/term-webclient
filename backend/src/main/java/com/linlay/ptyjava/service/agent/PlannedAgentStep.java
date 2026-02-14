package com.linlay.ptyjava.service.agent;

import java.util.Map;

public record PlannedAgentStep(
    String tool,
    String title,
    Map<String, Object> arguments,
    boolean highRisk
) {
}

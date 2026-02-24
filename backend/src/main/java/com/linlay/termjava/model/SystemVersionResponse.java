package com.linlay.termjava.model;

public record SystemVersionResponse(
    String name,
    String version,
    String gitSha,
    String buildTime
) {
}

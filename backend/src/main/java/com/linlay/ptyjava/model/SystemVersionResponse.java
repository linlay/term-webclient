package com.linlay.ptyjava.model;

public record SystemVersionResponse(
    String name,
    String version,
    String gitSha,
    String buildTime
) {
}

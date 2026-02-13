package com.linlay.ptyjava.model;

import java.time.Instant;

public record CreateSessionResponse(String sessionId, String wsUrl, Instant startedAt) {
}

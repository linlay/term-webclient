package com.linlay.termjava.model;

import java.time.Instant;

public record SessionEventView(
    long eventSeq,
    Instant timestamp,
    String type,
    String source,
    String commandId,
    Double boundaryConfidence,
    Long outputSeq,
    Integer cols,
    Integer rows,
    Integer exitCode,
    String data
) {
}

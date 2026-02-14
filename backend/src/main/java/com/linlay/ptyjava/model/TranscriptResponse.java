package com.linlay.ptyjava.model;

public record TranscriptResponse(
    String sessionId,
    long fromSeq,
    long toSeq,
    int chunkCount,
    boolean truncated,
    boolean ansiStripped,
    String transcript
) {
}

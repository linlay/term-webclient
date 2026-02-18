package com.linlay.ptyjava.model;

public record ScreenTextResponse(
    String sessionId,
    long lastSeq,
    int cols,
    int rows,
    String text
) {
}

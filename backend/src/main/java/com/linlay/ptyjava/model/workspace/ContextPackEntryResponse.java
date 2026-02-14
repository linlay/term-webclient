package com.linlay.ptyjava.model.workspace;

public record ContextPackEntryResponse(
    String path,
    boolean exists,
    boolean truncated,
    int bytes,
    String content,
    String error
) {
}

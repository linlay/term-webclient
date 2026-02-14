package com.linlay.ptyjava.model;

import java.util.List;

public record SessionSnapshotResponse(
    String sessionId,
    long fromSeq,
    long toSeq,
    List<TerminalOutputChunk> chunks,
    boolean truncated
) {
}

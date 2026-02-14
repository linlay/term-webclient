package com.linlay.ptyjava.model.workspace;

import java.time.Instant;
import java.util.List;

public record ContextPackResponse(
    Instant generatedAt,
    String workspaceRoot,
    boolean truncated,
    List<ContextPackEntryResponse> entries,
    String gitDiff
) {
}

package com.linlay.termjava.model;

public record TerminalClientResponse(
    String id,
    String label,
    String defaultWorkdir
) {
}

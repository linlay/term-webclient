package com.linlay.ptyjava.model;

public record TerminalClientResponse(
    String id,
    String label,
    String defaultWorkdir
) {
}

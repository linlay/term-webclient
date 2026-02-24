package com.linlay.termjava.model.file;

public record FileTreeEntryResponse(
    String name,
    String path,
    FileEntryType type,
    long size,
    long mtime,
    boolean readable,
    boolean writable
) {
}

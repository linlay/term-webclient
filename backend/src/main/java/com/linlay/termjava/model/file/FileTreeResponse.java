package com.linlay.termjava.model.file;

import java.util.List;

public record FileTreeResponse(
    String currentPath,
    String parentPath,
    List<FileTreeEntryResponse> entries
) {
}

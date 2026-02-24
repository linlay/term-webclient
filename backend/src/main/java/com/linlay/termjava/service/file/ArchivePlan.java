package com.linlay.termjava.service.file;

import java.util.List;

public record ArchivePlan(long totalBytes, List<ArchiveEntrySource> entries) {
}

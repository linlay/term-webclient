package com.linlay.termjava.service.file;

import java.io.InputStream;

public record ArchiveEntrySource(
    String archivePath,
    long size,
    IOSupplier<InputStream> openStream
) {
}

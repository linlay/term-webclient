package com.linlay.termjava.service.file;

import java.io.InputStream;

public record FileDownloadHandle(
    String path,
    String fileName,
    long size,
    long modifiedTime,
    InputStream inputStream,
    AutoCloseable closeable
) implements AutoCloseable {

    @Override
    public void close() {
        if (closeable == null) {
            return;
        }
        try {
            closeable.close();
        } catch (Exception ignored) {
        }
    }
}

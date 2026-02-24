package com.linlay.termjava.model.file;

public record FileUploadItemResponse(
    String fileName,
    String status,
    String savedPath,
    long size,
    String error
) {
}

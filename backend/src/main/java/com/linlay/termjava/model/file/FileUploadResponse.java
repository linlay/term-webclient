package com.linlay.termjava.model.file;

import java.util.List;

public record FileUploadResponse(List<FileUploadItemResponse> results) {
}

package com.linlay.termjava.service.file;

import com.linlay.termjava.model.file.FileMkdirResponse;
import com.linlay.termjava.model.file.FileTreeResponse;
import com.linlay.termjava.model.file.FileUploadItemResponse;
import com.linlay.termjava.model.file.UploadConflictPolicy;
import java.io.IOException;
import java.io.InputStream;
import java.util.List;

public interface FileGateway {

    String rootPath();

    FileTreeResponse tree(String path);

    FileMkdirResponse mkdir(String parentPath, String name);

    FileUploadItemResponse upload(String targetPath,
                                  String fileName,
                                  InputStream inputStream,
                                  long declaredSize,
                                  UploadConflictPolicy conflictPolicy) throws IOException;

    FileDownloadHandle openDownload(String path) throws IOException;

    ArchivePlan planArchive(List<String> paths) throws IOException;
}

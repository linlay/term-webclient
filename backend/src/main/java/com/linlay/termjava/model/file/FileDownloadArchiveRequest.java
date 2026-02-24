package com.linlay.termjava.model.file;

import java.util.List;

public class FileDownloadArchiveRequest {

    private List<String> paths;
    private String archiveName;

    public List<String> getPaths() {
        return paths;
    }

    public void setPaths(List<String> paths) {
        this.paths = paths;
    }

    public String getArchiveName() {
        return archiveName;
    }

    public void setArchiveName(String archiveName) {
        this.archiveName = archiveName;
    }
}

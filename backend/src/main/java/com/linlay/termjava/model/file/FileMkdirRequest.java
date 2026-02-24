package com.linlay.termjava.model.file;

public class FileMkdirRequest {

    private String parentPath;
    private String name;

    public String getParentPath() {
        return parentPath;
    }

    public void setParentPath(String parentPath) {
        this.parentPath = parentPath;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }
}

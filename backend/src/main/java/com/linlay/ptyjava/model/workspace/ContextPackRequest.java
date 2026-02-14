package com.linlay.ptyjava.model.workspace;

import java.util.ArrayList;
import java.util.List;

public class ContextPackRequest {

    private List<String> paths = new ArrayList<>();
    private Boolean includeGitDiff = Boolean.TRUE;
    private Integer maxBytes;

    public List<String> getPaths() {
        return paths;
    }

    public void setPaths(List<String> paths) {
        this.paths = paths;
    }

    public Boolean getIncludeGitDiff() {
        return includeGitDiff;
    }

    public void setIncludeGitDiff(Boolean includeGitDiff) {
        this.includeGitDiff = includeGitDiff;
    }

    public Integer getMaxBytes() {
        return maxBytes;
    }

    public void setMaxBytes(Integer maxBytes) {
        this.maxBytes = maxBytes;
    }
}

package com.linlay.termjava.model;

import java.util.List;

public record WorkdirBrowseResponse(String rootPath, String currentPath, List<WorkdirEntry> entries) {
}

package com.linlay.termjava.model.agent;

import java.util.ArrayList;
import java.util.List;

public class CreateAgentRunRequest {

    private String instruction;
    private List<String> selectedPaths = new ArrayList<>();
    private Boolean includeGitDiff = Boolean.TRUE;

    public String getInstruction() {
        return instruction;
    }

    public void setInstruction(String instruction) {
        this.instruction = instruction;
    }

    public List<String> getSelectedPaths() {
        return selectedPaths;
    }

    public void setSelectedPaths(List<String> selectedPaths) {
        this.selectedPaths = selectedPaths;
    }

    public Boolean getIncludeGitDiff() {
        return includeGitDiff;
    }

    public void setIncludeGitDiff(Boolean includeGitDiff) {
        this.includeGitDiff = includeGitDiff;
    }
}

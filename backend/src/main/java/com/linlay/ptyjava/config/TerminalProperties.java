package com.linlay.ptyjava.config;

import java.util.ArrayList;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "terminal")
public class TerminalProperties {

    private String defaultCommand = "codex";
    private List<String> defaultArgs = new ArrayList<>();
    private String defaultWorkdir = ".";
    private String workdirBrowseRoot = System.getProperty("user.home", ".");
    private List<String> allowedOrigins = new ArrayList<>(List.of("http://*", "https://*"));
    private int sessionIdleTimeoutSeconds = 60;
    private int wsDisconnectGraceSeconds = 30;
    private int maxCols = 500;
    private int maxRows = 200;

    public String getDefaultCommand() {
        return defaultCommand;
    }

    public void setDefaultCommand(String defaultCommand) {
        this.defaultCommand = defaultCommand;
    }

    public List<String> getDefaultArgs() {
        return defaultArgs;
    }

    public void setDefaultArgs(List<String> defaultArgs) {
        this.defaultArgs = defaultArgs;
    }

    public String getDefaultWorkdir() {
        return defaultWorkdir;
    }

    public void setDefaultWorkdir(String defaultWorkdir) {
        this.defaultWorkdir = defaultWorkdir;
    }

    public String getWorkdirBrowseRoot() {
        return workdirBrowseRoot;
    }

    public void setWorkdirBrowseRoot(String workdirBrowseRoot) {
        this.workdirBrowseRoot = workdirBrowseRoot;
    }

    public int getSessionIdleTimeoutSeconds() {
        return sessionIdleTimeoutSeconds;
    }

    public List<String> getAllowedOrigins() {
        return allowedOrigins;
    }

    public void setAllowedOrigins(List<String> allowedOrigins) {
        if (allowedOrigins == null || allowedOrigins.isEmpty()) {
            this.allowedOrigins = new ArrayList<>(List.of("http://*", "https://*"));
            return;
        }
        this.allowedOrigins = new ArrayList<>(allowedOrigins);
    }

    public void setSessionIdleTimeoutSeconds(int sessionIdleTimeoutSeconds) {
        this.sessionIdleTimeoutSeconds = sessionIdleTimeoutSeconds;
    }

    public int getWsDisconnectGraceSeconds() {
        return wsDisconnectGraceSeconds;
    }

    public void setWsDisconnectGraceSeconds(int wsDisconnectGraceSeconds) {
        this.wsDisconnectGraceSeconds = wsDisconnectGraceSeconds;
    }

    public int getMaxCols() {
        return maxCols;
    }

    public void setMaxCols(int maxCols) {
        this.maxCols = maxCols;
    }

    public int getMaxRows() {
        return maxRows;
    }

    public void setMaxRows(int maxRows) {
        this.maxRows = maxRows;
    }
}

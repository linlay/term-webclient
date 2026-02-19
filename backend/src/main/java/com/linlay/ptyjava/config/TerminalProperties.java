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
    private int detachedSessionTtlSeconds = 3600;
    private int ringBufferMaxBytes = 4 * 1024 * 1024;
    private int ringBufferMaxChunks = 4096;
    private int maxCols = 500;
    private int maxRows = 200;
    private int sessionEventMaxEntries = 2048;
    private int commandFrameMaxEntries = 256;
    private int transcriptMaxChars = 200_000;
    private AuthProperties auth = new AuthProperties();
    private AgentProperties agent = new AgentProperties();
    private SshProperties ssh = new SshProperties();
    private List<CliClientProperties> cliClients = new ArrayList<>();

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

    public void setSessionIdleTimeoutSeconds(int sessionIdleTimeoutSeconds) {
        this.sessionIdleTimeoutSeconds = sessionIdleTimeoutSeconds;
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

    public int getWsDisconnectGraceSeconds() {
        return wsDisconnectGraceSeconds;
    }

    public void setWsDisconnectGraceSeconds(int wsDisconnectGraceSeconds) {
        this.wsDisconnectGraceSeconds = wsDisconnectGraceSeconds;
    }

    public int getDetachedSessionTtlSeconds() {
        return detachedSessionTtlSeconds;
    }

    public void setDetachedSessionTtlSeconds(int detachedSessionTtlSeconds) {
        this.detachedSessionTtlSeconds = detachedSessionTtlSeconds;
    }

    public int getRingBufferMaxBytes() {
        return ringBufferMaxBytes;
    }

    public void setRingBufferMaxBytes(int ringBufferMaxBytes) {
        this.ringBufferMaxBytes = ringBufferMaxBytes;
    }

    public int getRingBufferMaxChunks() {
        return ringBufferMaxChunks;
    }

    public void setRingBufferMaxChunks(int ringBufferMaxChunks) {
        this.ringBufferMaxChunks = ringBufferMaxChunks;
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

    public int getSessionEventMaxEntries() {
        return sessionEventMaxEntries;
    }

    public void setSessionEventMaxEntries(int sessionEventMaxEntries) {
        this.sessionEventMaxEntries = sessionEventMaxEntries;
    }

    public int getCommandFrameMaxEntries() {
        return commandFrameMaxEntries;
    }

    public void setCommandFrameMaxEntries(int commandFrameMaxEntries) {
        this.commandFrameMaxEntries = commandFrameMaxEntries;
    }

    public int getTranscriptMaxChars() {
        return transcriptMaxChars;
    }

    public void setTranscriptMaxChars(int transcriptMaxChars) {
        this.transcriptMaxChars = transcriptMaxChars;
    }

    public AuthProperties getAuth() {
        return auth;
    }

    public void setAuth(AuthProperties auth) {
        this.auth = auth;
    }

    public AgentProperties getAgent() {
        return agent;
    }

    public void setAgent(AgentProperties agent) {
        this.agent = agent;
    }

    public SshProperties getSsh() {
        return ssh;
    }

    public void setSsh(SshProperties ssh) {
        this.ssh = ssh;
    }

    public List<CliClientProperties> getCliClients() {
        return cliClients;
    }

    public void setCliClients(List<CliClientProperties> cliClients) {
        if (cliClients == null) {
            this.cliClients = new ArrayList<>();
            return;
        }
        this.cliClients = new ArrayList<>(cliClients);
    }

    public static class AuthProperties {

        private boolean enabled = false;
        private String username = "admin";
        private String passwordHash = "";
        private String passwordHashBcrypt = "";
        private int sessionTtlSeconds = 12 * 3600;
        private boolean loginRateLimitEnabled = true;
        private int loginRateLimitWindowSeconds = 60;
        private int loginRateLimitMaxAttempts = 10;

        public boolean isEnabled() {
            return enabled;
        }

        public void setEnabled(boolean enabled) {
            this.enabled = enabled;
        }

        public String getUsername() {
            return username;
        }

        public void setUsername(String username) {
            this.username = username;
        }

        public String getPasswordHash() {
            return passwordHash;
        }

        public void setPasswordHash(String passwordHash) {
            this.passwordHash = passwordHash;
        }

        public String getPasswordHashBcrypt() {
            return passwordHashBcrypt;
        }

        public void setPasswordHashBcrypt(String passwordHashBcrypt) {
            this.passwordHashBcrypt = passwordHashBcrypt;
        }

        public int getSessionTtlSeconds() {
            return sessionTtlSeconds;
        }

        public void setSessionTtlSeconds(int sessionTtlSeconds) {
            this.sessionTtlSeconds = sessionTtlSeconds;
        }

        public boolean isLoginRateLimitEnabled() {
            return loginRateLimitEnabled;
        }

        public void setLoginRateLimitEnabled(boolean loginRateLimitEnabled) {
            this.loginRateLimitEnabled = loginRateLimitEnabled;
        }

        public int getLoginRateLimitWindowSeconds() {
            return loginRateLimitWindowSeconds;
        }

        public void setLoginRateLimitWindowSeconds(int loginRateLimitWindowSeconds) {
            this.loginRateLimitWindowSeconds = loginRateLimitWindowSeconds;
        }

        public int getLoginRateLimitMaxAttempts() {
            return loginRateLimitMaxAttempts;
        }

        public void setLoginRateLimitMaxAttempts(int loginRateLimitMaxAttempts) {
            this.loginRateLimitMaxAttempts = loginRateLimitMaxAttempts;
        }
    }

    public static class AgentProperties {

        private boolean enabled = true;
        private int stepTimeoutSeconds = 15;
        private int maxStepResultChars = 8000;
        private int maxContextPackBytes = 256 * 1024;

        public boolean isEnabled() {
            return enabled;
        }

        public void setEnabled(boolean enabled) {
            this.enabled = enabled;
        }

        public int getStepTimeoutSeconds() {
            return stepTimeoutSeconds;
        }

        public void setStepTimeoutSeconds(int stepTimeoutSeconds) {
            this.stepTimeoutSeconds = stepTimeoutSeconds;
        }

        public int getMaxStepResultChars() {
            return maxStepResultChars;
        }

        public void setMaxStepResultChars(int maxStepResultChars) {
            this.maxStepResultChars = maxStepResultChars;
        }

        public int getMaxContextPackBytes() {
            return maxContextPackBytes;
        }

        public void setMaxContextPackBytes(int maxContextPackBytes) {
            this.maxContextPackBytes = maxContextPackBytes;
        }
    }

    public static class SshProperties {

        private boolean enabled = true;
        private int defaultPort = 22;
        private String defaultTerm = "xterm-256color";
        private int connectTimeoutMillis = 10000;
        private int connectionIdleTtlSeconds = 3600;
        private int execDefaultTimeoutSeconds = 120;
        private int execMaxOutputBytes = 1024 * 1024;
        private String credentialsFile = "data/ssh-credentials.json";
        private String knownHostsFile = System.getProperty("user.home", ".") + "/.pty-web/known-hosts.json";
        private String masterKey;
        private String masterKeyEnv = "TERMINAL_SSH_MASTER_KEY";

        public boolean isEnabled() {
            return enabled;
        }

        public void setEnabled(boolean enabled) {
            this.enabled = enabled;
        }

        public int getDefaultPort() {
            return defaultPort;
        }

        public void setDefaultPort(int defaultPort) {
            this.defaultPort = defaultPort;
        }

        public String getDefaultTerm() {
            return defaultTerm;
        }

        public void setDefaultTerm(String defaultTerm) {
            this.defaultTerm = defaultTerm;
        }

        public int getConnectTimeoutMillis() {
            return connectTimeoutMillis;
        }

        public void setConnectTimeoutMillis(int connectTimeoutMillis) {
            this.connectTimeoutMillis = connectTimeoutMillis;
        }

        public int getConnectionIdleTtlSeconds() {
            return connectionIdleTtlSeconds;
        }

        public void setConnectionIdleTtlSeconds(int connectionIdleTtlSeconds) {
            this.connectionIdleTtlSeconds = connectionIdleTtlSeconds;
        }

        public int getExecDefaultTimeoutSeconds() {
            return execDefaultTimeoutSeconds;
        }

        public void setExecDefaultTimeoutSeconds(int execDefaultTimeoutSeconds) {
            this.execDefaultTimeoutSeconds = execDefaultTimeoutSeconds;
        }

        public int getExecMaxOutputBytes() {
            return execMaxOutputBytes;
        }

        public void setExecMaxOutputBytes(int execMaxOutputBytes) {
            this.execMaxOutputBytes = execMaxOutputBytes;
        }

        public String getCredentialsFile() {
            return credentialsFile;
        }

        public void setCredentialsFile(String credentialsFile) {
            this.credentialsFile = credentialsFile;
        }

        public String getKnownHostsFile() {
            return knownHostsFile;
        }

        public void setKnownHostsFile(String knownHostsFile) {
            this.knownHostsFile = knownHostsFile;
        }

        public String getMasterKey() {
            return masterKey;
        }

        public void setMasterKey(String masterKey) {
            this.masterKey = masterKey;
        }

        public String getMasterKeyEnv() {
            return masterKeyEnv;
        }

        public void setMasterKeyEnv(String masterKeyEnv) {
            this.masterKeyEnv = masterKeyEnv;
        }
    }

    public static class CliClientProperties {

        private String id;
        private String label;
        private String command;
        private List<String> args = new ArrayList<>();
        private String workdir = ".";
        private java.util.Map<String, String> env = new java.util.HashMap<>();
        private List<String> preCommands = new ArrayList<>();
        private String shell = "/bin/zsh";

        public String getId() {
            return id;
        }

        public void setId(String id) {
            this.id = id;
        }

        public String getLabel() {
            return label;
        }

        public void setLabel(String label) {
            this.label = label;
        }

        public String getCommand() {
            return command;
        }

        public void setCommand(String command) {
            this.command = command;
        }

        public List<String> getArgs() {
            return args;
        }

        public void setArgs(List<String> args) {
            if (args == null) {
                this.args = new ArrayList<>();
                return;
            }
            this.args = new ArrayList<>(args);
        }

        public String getWorkdir() {
            return workdir;
        }

        public void setWorkdir(String workdir) {
            this.workdir = workdir;
        }

        public java.util.Map<String, String> getEnv() {
            return env;
        }

        public void setEnv(java.util.Map<String, String> env) {
            if (env == null) {
                this.env = new java.util.HashMap<>();
                return;
            }
            this.env = new java.util.HashMap<>(env);
        }

        public List<String> getPreCommands() {
            return preCommands;
        }

        public void setPreCommands(List<String> preCommands) {
            if (preCommands == null) {
                this.preCommands = new ArrayList<>();
                return;
            }
            this.preCommands = new ArrayList<>(preCommands);
        }

        public String getShell() {
            return shell;
        }

        public void setShell(String shell) {
            this.shell = shell;
        }
    }
}

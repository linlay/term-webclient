package com.linlay.ptyjava.config;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import lombok.Data;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

@Getter
@Setter
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
    private AppAuthProperties appAuth = new AppAuthProperties();
    private AgentProperties agent = new AgentProperties();
    private SshProperties ssh = new SshProperties();
    private List<CliClientProperties> cliClients = new ArrayList<>();

    public void setAllowedOrigins(List<String> allowedOrigins) {
        if (allowedOrigins == null || allowedOrigins.isEmpty()) {
            this.allowedOrigins = new ArrayList<>(List.of("http://*", "https://*"));
            return;
        }
        this.allowedOrigins = new ArrayList<>(allowedOrigins);
    }

    public void setAppAuth(AppAuthProperties appAuth) {
        this.appAuth = appAuth == null ? new AppAuthProperties() : appAuth;
    }

    public void setCliClients(List<CliClientProperties> cliClients) {
        if (cliClients == null) {
            this.cliClients = new ArrayList<>();
            return;
        }
        this.cliClients = new ArrayList<>(cliClients);
    }

    @Data
    public static class AuthProperties {
        private boolean enabled = false;
        private String username = "admin";
        private String passwordHash = "";
        private String passwordHashBcrypt = "";
        private int sessionTtlSeconds = 12 * 3600;
        private boolean loginRateLimitEnabled = true;
        private int loginRateLimitWindowSeconds = 60;
        private int loginRateLimitMaxAttempts = 10;
    }

    @Data
    public static class AppAuthProperties {
        private boolean enabled = true;
        private String localPublicKey = "";
        private String jwksUri = "";
        private String issuer = "";
        private int jwksCacheSeconds = 300;
        private String audience = "";
        private int clockSkewSeconds = 30;
    }

    @Data
    public static class AgentProperties {
        private boolean enabled = true;
        private int stepTimeoutSeconds = 15;
        private int maxStepResultChars = 8000;
        private int maxContextPackBytes = 256 * 1024;
    }

    @Data
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
    }

    @Getter
    @Setter
    public static class CliClientProperties {
        private String id;
        private String label;
        private String command;
        private List<String> args = new ArrayList<>();
        private String workdir = ".";
        private Map<String, String> env = new HashMap<>();
        private List<String> preCommands = new ArrayList<>();
        private String shell = "/bin/zsh";

        public void setArgs(List<String> args) {
            if (args == null) {
                this.args = new ArrayList<>();
                return;
            }
            this.args = new ArrayList<>(args);
        }

        public void setEnv(Map<String, String> env) {
            if (env == null) {
                this.env = new HashMap<>();
                return;
            }
            this.env = new HashMap<>(env);
        }

        public void setPreCommands(List<String> preCommands) {
            if (preCommands == null) {
                this.preCommands = new ArrayList<>();
                return;
            }
            this.preCommands = new ArrayList<>(preCommands);
        }
    }
}

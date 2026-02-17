package com.linlay.ptyjava.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.linlay.ptyjava.config.TerminalProperties;
import com.linlay.ptyjava.model.CreateSessionRequest;
import com.linlay.ptyjava.model.CreateSessionResponse;
import com.linlay.ptyjava.model.SessionContextResponse;
import com.linlay.ptyjava.model.SessionSnapshotResponse;
import com.linlay.ptyjava.model.SessionTabViewResponse;
import com.linlay.ptyjava.model.SessionType;
import com.linlay.ptyjava.model.SshSessionRequest;
import com.linlay.ptyjava.model.TerminalOutputChunk;
import com.linlay.ptyjava.model.TerminalSession;
import com.linlay.ptyjava.model.TranscriptResponse;
import com.linlay.ptyjava.service.TerminalOutputRingBuffer.OutputChunk;
import com.linlay.ptyjava.service.TerminalOutputRingBuffer.Snapshot;
import com.linlay.ptyjava.service.ssh.ResolvedSshCredential;
import com.linlay.ptyjava.service.ssh.SshConnectionPool;
import com.linlay.ptyjava.service.ssh.SshCredentialStore;
import com.linlay.ptyjava.service.ssh.SshShellRuntime;
import com.pty4j.PtyProcess;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

@Service
public class TerminalSessionService {

    private static final Logger log = LoggerFactory.getLogger(TerminalSessionService.class);
    private static final int DEFAULT_COLS = 120;
    private static final int DEFAULT_ROWS = 30;
    private static final Pattern ANSI_ESCAPE = Pattern.compile("\\u001B\\[[;?0-9]*[ -/]*[@-~]");

    private final TerminalProperties properties;
    private final PtyProcessLauncher processLauncher;
    private final SshCredentialStore sshCredentialStore;
    private final SshConnectionPool sshConnectionPool;
    private final ObjectMapper objectMapper;

    private final ConcurrentMap<String, TerminalSession> sessions = new ConcurrentHashMap<>();
    private final ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(2);

    public TerminalSessionService(TerminalProperties properties,
                                  PtyProcessLauncher processLauncher,
                                  SshCredentialStore sshCredentialStore,
                                  SshConnectionPool sshConnectionPool,
                                  ObjectMapper objectMapper) {
        this.properties = properties;
        this.processLauncher = processLauncher;
        this.sshCredentialStore = sshCredentialStore;
        this.sshConnectionPool = sshConnectionPool;
        this.objectMapper = objectMapper;
    }

    public CreateSessionResponse createSession(CreateSessionRequest request) {
        SessionType sessionType = resolveSessionType(request);
        String sessionId = UUID.randomUUID().toString();

        try {
            SessionCreateParams params = normalize(request, sessionType);
            TerminalRuntime runtime = createRuntime(request, params, sessionType);
            ExecutorService ioExecutor = Executors.newSingleThreadExecutor(r -> {
                Thread t = new Thread(r, "terminal-read-" + sessionId);
                t.setDaemon(true);
                return t;
            });

            SessionContextTracker contextTracker = new SessionContextTracker(
                sessionId,
                sessionType,
                properties.getSessionEventMaxEntries(),
                properties.getCommandFrameMaxEntries(),
                params.workdir()
            );

            TerminalSession session = new TerminalSession(
                sessionId,
                sessionType,
                params.title(),
                params.toolId(),
                params.workdir(),
                runtime,
                ioExecutor,
                new TerminalOutputRingBuffer(properties.getRingBufferMaxBytes(), properties.getRingBufferMaxChunks()),
                contextTracker,
                Instant.now()
            );

            sessions.put(sessionId, session);
            startReadLoop(session);
            return new CreateSessionResponse(sessionId, "/ws/" + sessionId, session.getStartedAt());
        } catch (IOException e) {
            throw new RuntimeException("Failed to start terminal runtime", e);
        }
    }

    public void attachWebSocket(String sessionId, String clientId, WebSocketSession wsSession, long lastSeenSeq) {
        TerminalSession session = getRequired(sessionId);

        synchronized (session) {
            cancelKillTask(session);
            session.setDetachedAt(null);

            WebSocketSession previous = session.getAttachedClients().put(clientId, wsSession);
            if (previous != null && previous.isOpen() && !previous.getId().equals(wsSession.getId())) {
                try {
                    previous.close(CloseStatus.NORMAL);
                } catch (IOException ignored) {
                }
            }
            session.touchLastActiveAt();
            session.getContextTracker().onAttachedClientsChanged(session.getAttachedClients().size());
        }

        replayBufferedOutput(session, wsSession, lastSeenSeq);
    }

    public void detachWebSocket(String sessionId, String clientId, WebSocketSession wsSession) {
        TerminalSession session = sessions.get(sessionId);
        if (session == null) {
            return;
        }

        synchronized (session) {
            if (!StringUtils.hasText(clientId)) {
                session.getAttachedClients().entrySet().removeIf(entry -> entry.getValue().getId().equals(wsSession.getId()));
            } else {
                WebSocketSession existing = session.getAttachedClients().get(clientId);
                if (existing != null && existing.getId().equals(wsSession.getId())) {
                    session.getAttachedClients().remove(clientId, existing);
                }
            }

            if (session.getAttachedClients().isEmpty()) {
                session.setDetachedAt(Instant.now());
                scheduleKillTask(session, properties.getDetachedSessionTtlSeconds());
            }
            session.getContextTracker().onAttachedClientsChanged(session.getAttachedClients().size());
        }
    }

    public void writeInput(String sessionId, String data) {
        writeInputInternal(sessionId, data, "manual");
    }

    public void writeInputFromAgent(String sessionId, String data) {
        writeInputInternal(sessionId, data, "agent");
    }

    public void registerManagedCommand(String sessionId, String commandId, String command) {
        TerminalSession session = getRequired(sessionId);
        session.getContextTracker().registerManagedCommand(commandId, command);
    }

    public void resize(String sessionId, int cols, int rows) {
        validateSize(cols, rows);
        TerminalSession session = getRequired(sessionId);
        try {
            session.getRuntime().resize(cols, rows);
            session.touchLastActiveAt();
            session.getContextTracker().onResize(cols, rows);
        } catch (IOException e) {
            throw new InvalidSessionRequestException("Failed to resize session");
        }
    }

    public SessionSnapshotResponse getSnapshot(String sessionId, long afterSeq) {
        TerminalSession session = getRequired(sessionId);
        Snapshot snapshot = session.getRingBuffer().snapshotAfter(afterSeq);
        List<TerminalOutputChunk> chunks = snapshot.chunks().stream()
            .map(chunk -> new TerminalOutputChunk(chunk.seq(), new String(chunk.data(), StandardCharsets.UTF_8)))
            .toList();

        long fromSeq = chunks.isEmpty() ? snapshot.firstAvailableSeq() : chunks.get(0).seq();
        long toSeq = chunks.isEmpty() ? snapshot.latestSeq() : chunks.get(chunks.size() - 1).seq();

        return new SessionSnapshotResponse(sessionId, fromSeq, toSeq, chunks, snapshot.truncated());
    }

    public TranscriptResponse getTranscript(String sessionId, long afterSeq, boolean stripAnsi) {
        TerminalSession session = getRequired(sessionId);
        Snapshot snapshot = session.getRingBuffer().snapshotAfter(afterSeq);

        StringBuilder transcript = new StringBuilder();
        for (OutputChunk chunk : snapshot.chunks()) {
            transcript.append(new String(chunk.data(), StandardCharsets.UTF_8));
        }

        String text = transcript.toString();
        if (stripAnsi) {
            text = ANSI_ESCAPE.matcher(text).replaceAll("");
        }

        boolean truncated = snapshot.truncated();
        int maxChars = Math.max(1000, properties.getTranscriptMaxChars());
        if (text.length() > maxChars) {
            text = text.substring(text.length() - maxChars);
            truncated = true;
        }

        long fromSeq = snapshot.chunks().isEmpty() ? snapshot.firstAvailableSeq() : snapshot.chunks().get(0).seq();
        long toSeq = snapshot.chunks().isEmpty() ? snapshot.latestSeq() : snapshot.chunks().get(snapshot.chunks().size() - 1).seq();

        return new TranscriptResponse(
            sessionId,
            fromSeq,
            toSeq,
            snapshot.chunks().size(),
            truncated,
            stripAnsi,
            text
        );
    }

    public SessionContextResponse getContext(String sessionId, int commandLimit, int eventLimit) {
        TerminalSession session = getRequired(sessionId);
        return session.getContextTracker().snapshot(commandLimit, eventLimit);
    }

    public SessionContextResponse getContext(String sessionId) {
        return getContext(sessionId, 100, 200);
    }

    public void closeSession(String sessionId, String reason, boolean sendExit) {
        closeSession(sessionId, reason, sendExit, null);
    }

    public boolean exists(String sessionId) {
        return sessions.containsKey(sessionId);
    }

    public List<SessionTabViewResponse> listSessions() {
        return sessions.values().stream()
            .sorted(Comparator.comparing(TerminalSession::getStartedAt))
            .map(this::toSessionTabView)
            .toList();
    }

    private void writeInputInternal(String sessionId, String data, String source) {
        TerminalSession session = getRequired(sessionId);
        if (data == null) {
            return;
        }

        session.getContextTracker().onInput(data, source);

        try {
            session.getRuntime().inputStream().write(data.getBytes(StandardCharsets.UTF_8));
            session.getRuntime().inputStream().flush();
            session.touchLastActiveAt();
        } catch (IOException e) {
            session.getContextTracker().onError("Failed writing to terminal process");
            broadcastPayload(session, Map.of("type", "error", "message", "Failed writing to terminal process"));
            closeSession(sessionId, "write error", true);
        }
    }

    private void closeSession(String sessionId, String reason, boolean sendExit, Integer exitCodeOverride) {
        TerminalSession session = sessions.remove(sessionId);
        if (session != null) {
            closeInternal(session, reason, sendExit, exitCodeOverride);
        }
    }

    private TerminalRuntime createRuntime(CreateSessionRequest request,
                                          SessionCreateParams params,
                                          SessionType sessionType) throws IOException {
        if (sessionType == SessionType.SSH_SHELL) {
            SshSessionRequest sshRequest = request == null ? null : request.getSsh();
            if (sshRequest == null) {
                throw new InvalidSessionRequestException("ssh config is required for SSH_SHELL session");
            }

            ResolvedSshCredential credential = sshCredentialStore.resolveCredential(
                sshRequest.getCredentialId(),
                sshRequest.getHost(),
                sshRequest.getPort(),
                sshRequest.getUsername(),
                sshRequest.getTerm()
            );
            return SshShellRuntime.open(sshConnectionPool, credential, params.cols(), params.rows());
        }

        PtyProcess process = processLauncher.start(params.command(), params.env(), params.workdir(), params.cols(), params.rows());
        return new PtyTerminalRuntime(process);
    }

    private SessionType resolveSessionType(CreateSessionRequest request) {
        SessionType requested = request == null ? null : request.getSessionType();
        return SessionType.normalize(requested);
    }

    private void startReadLoop(TerminalSession session) {
        session.getIoExecutor().submit(() -> {
            byte[] buffer = new byte[8192];
            try {
                int read;
                while ((read = session.getRuntime().outputStream().read(buffer)) != -1) {
                    if (read <= 0) {
                        continue;
                    }

                    byte[] output = new byte[read];
                    System.arraycopy(buffer, 0, output, 0, read);

                    long seq = session.getNextSeq().incrementAndGet();
                    session.getRingBuffer().append(seq, output);
                    session.touchLastActiveAt();
                    String outputText = new String(output, StandardCharsets.UTF_8);
                    session.getContextTracker().onOutput(seq, outputText);
                    broadcastOutput(session, seq, output);
                }

                int exitCode = session.getRuntime().awaitExit();
                closeSession(session.getSessionId(), "runtime exited", true, exitCode);
            } catch (Exception e) {
                if (!session.getClosed().get()) {
                    log.warn("Terminal stream read failed for session {}", session.getSessionId(), e);
                    session.getContextTracker().onError("Terminal stream error");
                    broadcastPayload(session, Map.of("type", "error", "message", "Terminal stream error"));
                    closeSession(session.getSessionId(), "stream read error", true);
                }
            }
        });
    }

    private void closeInternal(TerminalSession session, String reason, boolean sendExit, Integer exitCodeOverride) {
        if (!session.getClosed().compareAndSet(false, true)) {
            return;
        }

        cancelKillTask(session);

        Integer exitCode = exitCodeOverride;
        if (sendExit) {
            if (exitCode == null) {
                exitCode = session.getRuntime().exitCodeOrNull();
            }
            broadcastPayload(session, Map.of("type", "exit", "exitCode", exitCode == null ? -1 : exitCode));
        }

        session.getContextTracker().onSessionClosed(exitCode);

        session.getRuntime().close();
        session.getIoExecutor().shutdownNow();

        session.getAttachedClients().values().forEach(ws -> {
            if (ws != null && ws.isOpen()) {
                try {
                    ws.close(CloseStatus.NORMAL);
                } catch (IOException ignored) {
                }
            }
        });
        session.getAttachedClients().clear();

        log.info("Closed session {}: {}", session.getSessionId(), reason);
    }

    private void replayBufferedOutput(TerminalSession session, WebSocketSession wsSession, long lastSeenSeq) {
        session.getWsSendLock().lock();
        try {
            Snapshot snapshot = session.getRingBuffer().snapshotAfter(lastSeenSeq);
            if (snapshot.truncated()) {
                session.getContextTracker().onTruncated();
                sendMessage(wsSession, Map.of(
                    "type", "truncated",
                    "requestedAfterSeq", lastSeenSeq,
                    "firstAvailableSeq", snapshot.firstAvailableSeq(),
                    "latestSeq", snapshot.latestSeq()
                ));
            }

            for (OutputChunk chunk : snapshot.chunks()) {
                sendMessage(wsSession, Map.of(
                    "type", "output",
                    "seq", chunk.seq(),
                    "data", new String(chunk.data(), StandardCharsets.UTF_8)
                ));
            }
        } finally {
            session.getWsSendLock().unlock();
        }
    }

    private void broadcastOutput(TerminalSession session, long seq, byte[] output) {
        broadcastPayload(session, Map.of(
            "type", "output",
            "seq", seq,
            "data", new String(output, StandardCharsets.UTF_8)
        ));
    }

    private void broadcastPayload(TerminalSession session, Map<String, Object> payload) {
        String json = serialize(payload, session.getSessionId());
        if (json == null) {
            return;
        }

        session.getWsSendLock().lock();
        try {
            session.getAttachedClients().forEach((clientId, wsSession) -> {
                if (wsSession == null || !wsSession.isOpen()) {
                    session.getAttachedClients().remove(clientId, wsSession);
                    return;
                }
                try {
                    wsSession.sendMessage(new TextMessage(json));
                } catch (IOException e) {
                    log.debug("Failed to send websocket message for session {} client {}", session.getSessionId(), clientId, e);
                }
            });
        } finally {
            session.getWsSendLock().unlock();
        }
    }

    private void sendMessage(WebSocketSession wsSession, Map<String, Object> payload) {
        if (wsSession == null || !wsSession.isOpen()) {
            return;
        }

        String json = serialize(payload, "single-client");
        if (json == null) {
            return;
        }

        try {
            wsSession.sendMessage(new TextMessage(json));
        } catch (IOException ignored) {
        }
    }

    private String serialize(Map<String, Object> payload, String sessionId) {
        try {
            return objectMapper.writeValueAsString(payload);
        } catch (JsonProcessingException e) {
            log.debug("Failed to serialize websocket payload for session {}", sessionId, e);
            return null;
        }
    }

    private void scheduleKillTask(TerminalSession session, int seconds) {
        cancelKillTask(session);
        if (seconds <= 0) {
            return;
        }

        ScheduledFuture<?> task = scheduler.schedule(
            () -> closeSession(session.getSessionId(), "detached ttl exceeded", true),
            seconds,
            TimeUnit.SECONDS
        );
        session.setKillTask(task);
    }

    private void cancelKillTask(TerminalSession session) {
        ScheduledFuture<?> task = session.getKillTask();
        if (task != null) {
            task.cancel(false);
            session.setKillTask(null);
        }
    }

    private TerminalSession getRequired(String sessionId) {
        TerminalSession session = sessions.get(sessionId);
        if (session == null) {
            throw new SessionNotFoundException(sessionId);
        }
        return session;
    }

    private SessionTabViewResponse toSessionTabView(TerminalSession session) {
        String state = session.getContextTracker().snapshot(1, 1).meta().connectionState();
        return new SessionTabViewResponse(
            session.getSessionId(),
            "/ws/" + session.getSessionId(),
            session.getTitle(),
            session.getToolId(),
            session.getSessionType(),
            session.getWorkdir(),
            session.getStartedAt(),
            state
        );
    }

    private SessionCreateParams normalize(CreateSessionRequest request, SessionType sessionType) {
        CreateSessionRequest effective = request == null ? new CreateSessionRequest() : request;

        int cols = effective.getCols() == null ? DEFAULT_COLS : effective.getCols();
        int rows = effective.getRows() == null ? DEFAULT_ROWS : effective.getRows();
        validateSize(cols, rows);

        if (sessionType == SessionType.SSH_SHELL) {
            String title = StringUtils.hasText(effective.getTabTitle()) ? effective.getTabTitle().trim() : "ssh";
            String toolId = StringUtils.hasText(effective.getToolId()) ? effective.getToolId().trim() : "ssh";
            return new SessionCreateParams(List.of(), Map.of(), ".", cols, rows, title, toolId);
        }

        if (StringUtils.hasText(effective.getClientId())) {
            return normalizeCliClientSession(effective, cols, rows);
        }

        String command = StringUtils.hasText(effective.getCommand()) ? effective.getCommand() : properties.getDefaultCommand();
        if (!StringUtils.hasText(command)) {
            throw new InvalidSessionRequestException("command must not be blank");
        }

        List<String> args = effective.getArgs() == null ? properties.getDefaultArgs() : effective.getArgs();
        List<String> fullCommand = new ArrayList<>();
        fullCommand.add(command);
        if (args != null) {
            fullCommand.addAll(args);
        }

        String workdir = StringUtils.hasText(effective.getWorkdir()) ? effective.getWorkdir() : properties.getDefaultWorkdir();
        File workdirFile = new File(workdir);
        if (!workdirFile.exists() || !workdirFile.isDirectory()) {
            throw new InvalidSessionRequestException("workdir must be an existing directory");
        }

        Map<String, String> env = new HashMap<>(System.getenv());
        if (effective.getEnv() != null) {
            env.putAll(effective.getEnv());
        }
        env.putIfAbsent("TERM", "xterm-256color");

        String title = StringUtils.hasText(effective.getTabTitle()) ? effective.getTabTitle().trim() : command.trim();
        String toolId = StringUtils.hasText(effective.getToolId()) ? effective.getToolId().trim() : "terminal";
        return new SessionCreateParams(fullCommand, env, workdir, cols, rows, title, toolId);
    }

    private SessionCreateParams normalizeCliClientSession(CreateSessionRequest effective, int cols, int rows) {
        String clientId = effective.getClientId().trim();
        TerminalProperties.CliClientProperties cliClient = resolveCliClient(clientId);
        String command = StringUtils.trimWhitespace(cliClient.getCommand());
        if (!StringUtils.hasText(command)) {
            throw new InvalidSessionRequestException("cli client command must not be blank: " + clientId);
        }

        List<String> args = cliClient.getArgs() == null ? List.of() : cliClient.getArgs();
        List<String> fullCommand = new ArrayList<>();
        fullCommand.add(command);
        fullCommand.addAll(args);

        String workdir = StringUtils.hasText(effective.getWorkdir())
            ? effective.getWorkdir()
            : (StringUtils.hasText(cliClient.getWorkdir()) ? cliClient.getWorkdir() : properties.getDefaultWorkdir());
        validateWorkdir(workdir);

        Map<String, String> env = new HashMap<>(System.getenv());
        if (cliClient.getEnv() != null) {
            env.putAll(cliClient.getEnv());
        }
        if (effective.getEnv() != null) {
            env.putAll(effective.getEnv());
        }
        env.putIfAbsent("TERM", "xterm-256color");

        List<String> preCommands = cliClient.getPreCommands() == null ? List.of() : cliClient.getPreCommands().stream()
            .map(StringUtils::trimWhitespace)
            .filter(StringUtils::hasText)
            .toList();
        if (!preCommands.isEmpty()) {
            String shell = StringUtils.hasText(cliClient.getShell()) ? cliClient.getShell().trim() : "/bin/zsh";
            String script = String.join("; ", preCommands) + "; exec " + shellJoin(fullCommand);
            fullCommand = List.of(shell, "-lc", script);
        }

        String defaultTitle = StringUtils.hasText(cliClient.getLabel()) ? cliClient.getLabel().trim() : clientId;
        String title = StringUtils.hasText(effective.getTabTitle()) ? effective.getTabTitle().trim() : defaultTitle;
        String toolId = StringUtils.hasText(effective.getToolId()) ? effective.getToolId().trim() : clientId;

        return new SessionCreateParams(fullCommand, env, workdir, cols, rows, title, toolId);
    }

    private TerminalProperties.CliClientProperties resolveCliClient(String clientId) {
        for (TerminalProperties.CliClientProperties cliClient : properties.getCliClients()) {
            if (cliClient == null || !StringUtils.hasText(cliClient.getId())) {
                continue;
            }
            if (clientId.equals(cliClient.getId().trim())) {
                return cliClient;
            }
        }
        throw new InvalidSessionRequestException("Unknown cli client: " + clientId);
    }

    private void validateWorkdir(String workdir) {
        File workdirFile = new File(workdir);
        if (!workdirFile.exists() || !workdirFile.isDirectory()) {
            throw new InvalidSessionRequestException("workdir must be an existing directory");
        }
    }

    private String shellJoin(List<String> argv) {
        List<String> quoted = new ArrayList<>();
        for (String arg : argv) {
            quoted.add(shellQuote(arg));
        }
        return String.join(" ", quoted);
    }

    private String shellQuote(String value) {
        String raw = value == null ? "" : value;
        return "'" + raw.replace("'", "'\\''") + "'";
    }

    private void validateSize(int cols, int rows) {
        if (cols <= 0 || rows <= 0) {
            throw new InvalidSessionRequestException("cols and rows must be greater than 0");
        }
        if (cols > properties.getMaxCols() || rows > properties.getMaxRows()) {
            throw new InvalidSessionRequestException("cols/rows exceed server limits");
        }
    }

    private record SessionCreateParams(List<String> command,
                                       Map<String, String> env,
                                       String workdir,
                                       int cols,
                                       int rows,
                                       String title,
                                       String toolId) {
    }
}

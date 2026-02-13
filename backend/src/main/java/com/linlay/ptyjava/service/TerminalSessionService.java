package com.linlay.ptyjava.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.linlay.ptyjava.config.TerminalProperties;
import com.linlay.ptyjava.model.CreateSessionRequest;
import com.linlay.ptyjava.model.CreateSessionResponse;
import com.linlay.ptyjava.model.TerminalSession;
import com.pty4j.PtyProcess;
import com.pty4j.WinSize;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
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
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

@Service
public class TerminalSessionService {

    private static final Logger log = LoggerFactory.getLogger(TerminalSessionService.class);
    private static final int DEFAULT_COLS = 120;
    private static final int DEFAULT_ROWS = 30;

    private final TerminalProperties properties;
    private final PtyProcessLauncher processLauncher;
    private final ObjectMapper objectMapper;
    private final ConcurrentMap<String, TerminalSession> sessions = new ConcurrentHashMap<>();
    private final ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(2);

    public TerminalSessionService(TerminalProperties properties,
                                  PtyProcessLauncher processLauncher,
                                  ObjectMapper objectMapper) {
        this.properties = properties;
        this.processLauncher = processLauncher;
        this.objectMapper = objectMapper;
    }

    public CreateSessionResponse createSession(CreateSessionRequest request) {
        SessionCreateParams params = normalize(request);
        String sessionId = UUID.randomUUID().toString();

        try {
            PtyProcess process = processLauncher.start(params.command(), params.env(), params.workdir(), params.cols(), params.rows());
            ExecutorService ioExecutor = Executors.newSingleThreadExecutor(r -> {
                Thread t = new Thread(r, "pty-read-" + sessionId);
                t.setDaemon(true);
                return t;
            });
            TerminalSession session = new TerminalSession(
                sessionId,
                process,
                process.getOutputStream(),
                process.getInputStream(),
                ioExecutor,
                Instant.now()
            );

            sessions.put(sessionId, session);
            startReadLoop(session);
            scheduleSessionTimeout(session, properties.getSessionIdleTimeoutSeconds());

            return new CreateSessionResponse(sessionId, "/ws/" + sessionId, session.getStartedAt());
        } catch (IOException e) {
            throw new RuntimeException("Failed to start PTY process", e);
        }
    }

    public void attachWebSocket(String sessionId, WebSocketSession wsSession) {
        TerminalSession session = getRequired(sessionId);
        synchronized (session) {
            WebSocketSession existing = session.getWsSession();
            if (existing != null && existing.isOpen() && !existing.getId().equals(wsSession.getId())) {
                throw new InvalidSessionRequestException("Session already has an active WebSocket connection");
            }
            cancelGcTask(session);
            session.setWsSession(wsSession);
        }
    }

    public void detachWebSocket(String sessionId, WebSocketSession wsSession) {
        TerminalSession session = sessions.get(sessionId);
        if (session == null) {
            return;
        }
        synchronized (session) {
            WebSocketSession current = session.getWsSession();
            if (current != null && current.getId().equals(wsSession.getId())) {
                session.setWsSession(null);
                scheduleSessionTimeout(session, properties.getWsDisconnectGraceSeconds());
            }
        }
    }

    public void writeInput(String sessionId, String data) {
        TerminalSession session = getRequired(sessionId);
        if (data == null) {
            return;
        }
        try {
            session.getProcessIn().write(data.getBytes(StandardCharsets.UTF_8));
            session.getProcessIn().flush();
        } catch (IOException e) {
            sendMessage(session, Map.of("type", "error", "message", "Failed writing to terminal process"));
            closeSession(sessionId, "write error", true);
        }
    }

    public void resize(String sessionId, int cols, int rows) {
        validateSize(cols, rows);
        TerminalSession session = getRequired(sessionId);
        session.getProcess().setWinSize(new WinSize(cols, rows));
    }

    public void closeSession(String sessionId, String reason, boolean sendExit) {
        TerminalSession session = sessions.remove(sessionId);
        if (session != null) {
            closeInternal(session, reason, sendExit, null);
        }
    }

    public boolean exists(String sessionId) {
        return sessions.containsKey(sessionId);
    }

    private void startReadLoop(TerminalSession session) {
        session.getIoExecutor().submit(() -> {
            byte[] buffer = new byte[8192];
            try {
                int read;
                while ((read = session.getProcessOut().read(buffer)) != -1) {
                    if (read > 0) {
                        String data = new String(buffer, 0, read, StandardCharsets.UTF_8);
                        sendMessage(session, Map.of("type", "output", "data", data));
                    }
                }
                int exitCode = session.getProcess().waitFor();
                closeSession(session.getSessionId(), "process exited", false);
                sendMessage(session, Map.of("type", "exit", "exitCode", exitCode));
            } catch (Exception e) {
                if (!session.getClosed().get()) {
                    log.warn("Terminal stream read failed for session {}", session.getSessionId(), e);
                    sendMessage(session, Map.of("type", "error", "message", "Terminal stream error"));
                    closeSession(session.getSessionId(), "stream read error", true);
                }
            }
        });
    }

    private void closeInternal(TerminalSession session, String reason, boolean sendExit, Integer exitCodeOverride) {
        if (!session.getClosed().compareAndSet(false, true)) {
            return;
        }

        cancelGcTask(session);

        try {
            session.getProcessIn().close();
        } catch (IOException ignored) {
        }

        try {
            session.getProcessOut().close();
        } catch (IOException ignored) {
        }

        try {
            session.getProcess().destroyForcibly();
        } catch (Exception ex) {
            log.debug("Failed to destroy process for session {}", session.getSessionId(), ex);
        }

        session.getIoExecutor().shutdownNow();

        if (sendExit) {
            Integer exitCode = exitCodeOverride;
            if (exitCode == null) {
                try {
                    exitCode = session.getProcess().exitValue();
                } catch (IllegalThreadStateException e) {
                    exitCode = -1;
                }
            }
            sendMessage(session, Map.of("type", "exit", "exitCode", exitCode));
        }

        log.info("Closed session {}: {}", session.getSessionId(), reason);
    }

    private void scheduleSessionTimeout(TerminalSession session, int seconds) {
        cancelGcTask(session);
        if (seconds <= 0) {
            return;
        }
        ScheduledFuture<?> task = scheduler.schedule(
            () -> closeSession(session.getSessionId(), "session timeout", true),
            seconds,
            TimeUnit.SECONDS
        );
        session.setGcTask(task);
    }

    private void cancelGcTask(TerminalSession session) {
        ScheduledFuture<?> task = session.getGcTask();
        if (task != null) {
            task.cancel(false);
            session.setGcTask(null);
        }
    }

    private void sendMessage(TerminalSession session, Map<String, Object> payload) {
        WebSocketSession ws = session.getWsSession();
        if (ws == null || !ws.isOpen()) {
            return;
        }

        String json;
        try {
            json = objectMapper.writeValueAsString(payload);
        } catch (JsonProcessingException e) {
            log.debug("Failed to serialize websocket payload for session {}", session.getSessionId(), e);
            return;
        }

        session.getWsSendLock().lock();
        try {
            if (ws.isOpen()) {
                ws.sendMessage(new TextMessage(json));
            }
        } catch (IOException e) {
            log.debug("Failed to send websocket message for session {}", session.getSessionId(), e);
        } finally {
            session.getWsSendLock().unlock();
        }
    }

    private TerminalSession getRequired(String sessionId) {
        TerminalSession session = sessions.get(sessionId);
        if (session == null) {
            throw new SessionNotFoundException(sessionId);
        }
        return session;
    }

    private SessionCreateParams normalize(CreateSessionRequest request) {
        CreateSessionRequest effective = request == null ? new CreateSessionRequest() : request;

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

        int cols = effective.getCols() == null ? DEFAULT_COLS : effective.getCols();
        int rows = effective.getRows() == null ? DEFAULT_ROWS : effective.getRows();
        validateSize(cols, rows);

        Map<String, String> env = new HashMap<>(System.getenv());
        if (effective.getEnv() != null) {
            env.putAll(effective.getEnv());
        }
        env.putIfAbsent("TERM", "xterm-256color");

        return new SessionCreateParams(fullCommand, env, workdir, cols, rows);
    }

    private void validateSize(int cols, int rows) {
        if (cols <= 0 || rows <= 0) {
            throw new InvalidSessionRequestException("cols and rows must be greater than 0");
        }
        if (cols > properties.getMaxCols() || rows > properties.getMaxRows()) {
            throw new InvalidSessionRequestException("cols/rows exceed server limits");
        }
    }

    private record SessionCreateParams(List<String> command, Map<String, String> env, String workdir, int cols, int rows) {
    }
}

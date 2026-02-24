package com.linlay.termjava.service;

import com.linlay.termjava.model.CommandFrame;
import com.linlay.termjava.model.SessionContextResponse;
import com.linlay.termjava.model.SessionEventView;
import com.linlay.termjava.model.SessionMetaState;
import com.linlay.termjava.model.SessionType;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.locks.ReentrantLock;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class SessionContextTracker {

    private static final int MAX_EVENT_DATA_CHARS = 1600;
    private static final Pattern AGENT_BEGIN_PATTERN = Pattern.compile("__PTY_AGENT_BEGIN_([A-Za-z0-9\\-]+)__");
    private static final Pattern AGENT_END_PATTERN = Pattern.compile("__PTY_AGENT_END_([A-Za-z0-9\\-]+)__:([-]?[0-9]+)");

    private final String sessionId;
    private final SessionType sessionType;
    private final int maxEvents;
    private final int maxCommands;
    private final ReentrantLock lock = new ReentrantLock();
    private final Deque<SessionEventView> events = new ArrayDeque<>();
    private final Deque<CommandFrame> commands = new ArrayDeque<>();
    private final Map<String, MutableCommandState> managedCommands = new HashMap<>();
    private final AtomicLong eventSeq = new AtomicLong(0L);
    private final StringBuilder manualInputBuffer = new StringBuilder();
    private final StringBuilder outputLineBuffer = new StringBuilder();

    private final Instant startedAt;
    private Instant lastActivityAt;
    private Instant updatedAt;
    private String connectionState = "created";
    private long lastSeq;
    private int attachedClients;
    private Integer lastExitCode;
    private boolean truncated;
    private String lastError = "";
    private String lastWorkdir = ".";

    public SessionContextTracker(String sessionId,
                                 SessionType sessionType,
                                 int maxEvents,
                                 int maxCommands,
                                 String initialWorkdir) {
        this.sessionId = sessionId;
        this.sessionType = sessionType;
        this.maxEvents = Math.max(64, maxEvents);
        this.maxCommands = Math.max(16, maxCommands);
        this.startedAt = Instant.now();
        this.lastActivityAt = startedAt;
        this.updatedAt = startedAt;
        if (initialWorkdir != null && !initialWorkdir.isBlank()) {
            this.lastWorkdir = initialWorkdir;
        }
    }

    public void onAttachedClientsChanged(int attachedClients) {
        lock.lock();
        try {
            this.attachedClients = Math.max(attachedClients, 0);
            if (this.attachedClients > 0) {
                connectionState = "connected";
            } else if (!"exited".equals(connectionState)) {
                connectionState = "detached";
            }
            touch();
        } finally {
            lock.unlock();
        }
    }

    public void onInput(String data, String source) {
        if (data == null || data.isEmpty()) {
            return;
        }

        lock.lock();
        try {
            addEvent(new SessionEventView(
                eventSeq.incrementAndGet(),
                Instant.now(),
                "input",
                source,
                null,
                null,
                null,
                null,
                null,
                null,
                abbreviate(data)
            ));

            if ("manual".equals(source)) {
                processManualInput(data);
            }
            touch();
        } finally {
            lock.unlock();
        }
    }

    public void onOutput(long outputSeq, String data) {
        if (data == null || data.isEmpty()) {
            return;
        }

        lock.lock();
        try {
            lastSeq = Math.max(lastSeq, outputSeq);
            addEvent(new SessionEventView(
                eventSeq.incrementAndGet(),
                Instant.now(),
                "output",
                "runtime",
                null,
                null,
                outputSeq,
                null,
                null,
                null,
                abbreviate(data)
            ));
            parseManagedMarkers(data);
            touch();
        } finally {
            lock.unlock();
        }
    }

    public void onResize(int cols, int rows) {
        lock.lock();
        try {
            addEvent(new SessionEventView(
                eventSeq.incrementAndGet(),
                Instant.now(),
                "resize",
                "runtime",
                null,
                null,
                null,
                cols,
                rows,
                null,
                "cols=" + cols + ", rows=" + rows
            ));
            touch();
        } finally {
            lock.unlock();
        }
    }

    public void onTruncated() {
        lock.lock();
        try {
            truncated = true;
            addEvent(new SessionEventView(
                eventSeq.incrementAndGet(),
                Instant.now(),
                "truncated",
                "runtime",
                null,
                null,
                null,
                null,
                null,
                null,
                "output history truncated"
            ));
            touch();
        } finally {
            lock.unlock();
        }
    }

    public void onError(String message) {
        lock.lock();
        try {
            lastError = message == null ? "" : message;
            addEvent(new SessionEventView(
                eventSeq.incrementAndGet(),
                Instant.now(),
                "error",
                "runtime",
                null,
                null,
                null,
                null,
                null,
                null,
                abbreviate(lastError)
            ));
            touch();
        } finally {
            lock.unlock();
        }
    }

    public void registerManagedCommand(String commandId, String command) {
        lock.lock();
        try {
            MutableCommandState state = new MutableCommandState();
            state.commandId = commandId;
            state.command = command;
            state.source = "agent";
            state.boundaryConfidence = 1.0;
            state.status = "PENDING";
            managedCommands.put(commandId, state);
            touch();
        } finally {
            lock.unlock();
        }
    }

    public void onSessionClosed(Integer exitCode) {
        lock.lock();
        try {
            connectionState = "exited";
            lastExitCode = exitCode;
            if (!managedCommands.isEmpty()) {
                Instant now = Instant.now();
                for (MutableCommandState state : managedCommands.values()) {
                    if (state.startedAt == null) {
                        state.startedAt = now;
                    }
                    state.endedAt = now;
                    state.status = "ABORTED";
                    state.exitCode = exitCode == null ? -1 : exitCode;
                    pushCommand(state.toFrame());
                }
                managedCommands.clear();
            }

            addEvent(new SessionEventView(
                eventSeq.incrementAndGet(),
                Instant.now(),
                "session.exit",
                "runtime",
                null,
                null,
                null,
                null,
                null,
                exitCode,
                "session exited"
            ));
            touch();
        } finally {
            lock.unlock();
        }
    }

    public SessionContextResponse snapshot(int commandLimit, int eventLimit) {
        lock.lock();
        try {
            List<CommandFrame> commandList = tail(commands, Math.max(1, commandLimit));
            List<SessionEventView> eventList = tail(events, Math.max(1, eventLimit));

            SessionMetaState meta = new SessionMetaState(
                sessionId,
                sessionType,
                connectionState,
                lastSeq,
                attachedClients,
                lastExitCode,
                commands.size(),
                truncated,
                lastError,
                lastWorkdir,
                startedAt,
                lastActivityAt,
                updatedAt
            );

            String summary = buildSummary(meta, commandList);
            return new SessionContextResponse(sessionId, meta, commandList, eventList, summary);
        } finally {
            lock.unlock();
        }
    }

    private void processManualInput(String data) {
        for (int i = 0; i < data.length(); i++) {
            char ch = data.charAt(i);
            if (ch == '\r') {
                continue;
            }
            if (ch == '\b' || ch == 127) {
                if (manualInputBuffer.length() > 0) {
                    manualInputBuffer.setLength(manualInputBuffer.length() - 1);
                }
                continue;
            }
            if (ch == '\n') {
                finalizeManualCommand();
                continue;
            }
            if (!Character.isISOControl(ch)) {
                manualInputBuffer.append(ch);
            }
        }
    }

    private void finalizeManualCommand() {
        String command = manualInputBuffer.toString().trim();
        manualInputBuffer.setLength(0);
        if (command.isEmpty()) {
            return;
        }

        Instant now = Instant.now();
        String commandId = "manual-" + UUID.randomUUID();
        CommandFrame frame = new CommandFrame(
            commandId,
            "manual",
            command,
            0.35,
            now,
            now,
            0L,
            null,
            "UNKNOWN"
        );
        pushCommand(frame);

        addEvent(new SessionEventView(
            eventSeq.incrementAndGet(),
            now,
            "command.start",
            "manual",
            commandId,
            0.35,
            null,
            null,
            null,
            null,
            abbreviate(command)
        ));
        addEvent(new SessionEventView(
            eventSeq.incrementAndGet(),
            now,
            "command.end",
            "manual",
            commandId,
            0.35,
            null,
            null,
            null,
            null,
            "manual boundary"
        ));

        if (command.equals("cd")) {
            lastWorkdir = "~";
        } else if (command.startsWith("cd ")) {
            lastWorkdir = command.substring(3).trim();
        }
    }

    private void parseManagedMarkers(String chunk) {
        outputLineBuffer.append(chunk);
        int idx;
        while ((idx = outputLineBuffer.indexOf("\n")) >= 0) {
            String line = outputLineBuffer.substring(0, idx).replace("\r", "");
            outputLineBuffer.delete(0, idx + 1);
            parseMarkerLine(line);
        }
    }

    private void parseMarkerLine(String line) {
        Matcher beginMatcher = AGENT_BEGIN_PATTERN.matcher(line);
        if (beginMatcher.find()) {
            String commandId = beginMatcher.group(1);
            Instant now = Instant.now();

            MutableCommandState state = managedCommands.computeIfAbsent(commandId, key -> {
                MutableCommandState created = new MutableCommandState();
                created.commandId = commandId;
                created.command = "(agent managed)";
                created.source = "agent";
                created.boundaryConfidence = 1.0;
                created.status = "RUNNING";
                return created;
            });
            if (state.startedAt == null) {
                state.startedAt = now;
            }
            state.status = "RUNNING";

            addEvent(new SessionEventView(
                eventSeq.incrementAndGet(),
                now,
                "command.start",
                "agent",
                commandId,
                1.0,
                null,
                null,
                null,
                null,
                abbreviate(state.command)
            ));
            return;
        }

        Matcher endMatcher = AGENT_END_PATTERN.matcher(line);
        if (!endMatcher.find()) {
            return;
        }

        String commandId = endMatcher.group(1);
        int exitCode;
        try {
            exitCode = Integer.parseInt(endMatcher.group(2));
        } catch (NumberFormatException ex) {
            exitCode = -1;
        }

        Instant now = Instant.now();
        MutableCommandState state = managedCommands.remove(commandId);
        if (state == null) {
            state = new MutableCommandState();
            state.commandId = commandId;
            state.command = "(agent managed)";
            state.source = "agent";
            state.boundaryConfidence = 1.0;
        }
        if (state.startedAt == null) {
            state.startedAt = now;
        }
        state.endedAt = now;
        state.exitCode = exitCode;
        state.status = exitCode == 0 ? "COMPLETED" : "FAILED";
        pushCommand(state.toFrame());

        addEvent(new SessionEventView(
            eventSeq.incrementAndGet(),
            now,
            "command.end",
            "agent",
            commandId,
            1.0,
            null,
            null,
            null,
            exitCode,
            "exitCode=" + exitCode
        ));

        if (state.command != null && state.command.startsWith("cd ")) {
            lastWorkdir = state.command.substring(3).trim();
        }
    }

    private void pushCommand(CommandFrame frame) {
        commands.addLast(frame);
        while (commands.size() > maxCommands) {
            commands.removeFirst();
        }
    }

    private void addEvent(SessionEventView event) {
        events.addLast(event);
        while (events.size() > maxEvents) {
            events.removeFirst();
        }
    }

    private <T> List<T> tail(Deque<T> deque, int limit) {
        List<T> all = new ArrayList<>(deque);
        if (all.size() <= limit) {
            return all;
        }
        return all.subList(all.size() - limit, all.size());
    }

    private void touch() {
        Instant now = Instant.now();
        updatedAt = now;
        lastActivityAt = now;
    }

    private String abbreviate(String value) {
        if (value == null) {
            return "";
        }
        if (value.length() <= MAX_EVENT_DATA_CHARS) {
            return value;
        }
        return value.substring(0, MAX_EVENT_DATA_CHARS) + "...(truncated)";
    }

    private String buildSummary(SessionMetaState meta, List<CommandFrame> commandList) {
        StringBuilder sb = new StringBuilder();
        sb.append("sessionType=").append(meta.sessionType())
            .append(", state=").append(meta.connectionState())
            .append(", attachedClients=").append(meta.attachedClients())
            .append(", lastSeq=").append(meta.lastSeq())
            .append(", commands=").append(meta.commandCount());
        if (meta.lastExitCode() != null) {
            sb.append(", lastExitCode=").append(meta.lastExitCode());
        }
        if (meta.truncated()) {
            sb.append(", outputTruncated=true");
        }
        if (!commandList.isEmpty()) {
            CommandFrame latest = commandList.get(commandList.size() - 1);
            sb.append(", latestCommand=")
                .append(latest.command())
                .append(" [")
                .append(latest.status())
                .append("]");
            if (latest.endedAt() != null && latest.startedAt() != null) {
                sb.append(", latestDurationMs=")
                    .append(Duration.between(latest.startedAt(), latest.endedAt()).toMillis());
            }
        }
        return sb.toString();
    }

    private static class MutableCommandState {
        private String commandId;
        private String source;
        private String command;
        private double boundaryConfidence;
        private Instant startedAt;
        private Instant endedAt;
        private Integer exitCode;
        private String status;

        private CommandFrame toFrame() {
            Long durationMs = null;
            if (startedAt != null && endedAt != null) {
                durationMs = Duration.between(startedAt, endedAt).toMillis();
            }
            return new CommandFrame(
                commandId,
                source,
                command,
                boundaryConfidence,
                startedAt,
                endedAt,
                durationMs,
                exitCode,
                status
            );
        }
    }
}

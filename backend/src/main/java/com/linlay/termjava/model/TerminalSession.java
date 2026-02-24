package com.linlay.termjava.model;

import com.linlay.termjava.service.TerminalOutputRingBuffer;
import com.linlay.termjava.service.TerminalRuntime;
import com.linlay.termjava.service.SessionContextTracker;
import com.linlay.termjava.service.TerminalScreenTextTracker;
import java.time.Instant;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.locks.ReentrantLock;
import org.springframework.web.socket.WebSocketSession;

public class TerminalSession {

    private final String sessionId;
    private final SessionType sessionType;
    private final String title;
    private final String toolId;
    private final String workdir;
    private final FileSessionBinding fileSessionBinding;
    private final TerminalRuntime runtime;
    private final ExecutorService ioExecutor;
    private final TerminalOutputRingBuffer ringBuffer;
    private final SessionContextTracker contextTracker;
    private final TerminalScreenTextTracker screenTextTracker;
    private final AtomicLong nextSeq = new AtomicLong(0L);
    private final AtomicBoolean closed = new AtomicBoolean(false);
    private final ReentrantLock wsSendLock = new ReentrantLock();
    private final Instant startedAt;
    private final ConcurrentMap<String, WebSocketSession> attachedClients = new ConcurrentHashMap<>();

    private volatile Instant lastActiveAt;
    private volatile Instant detachedAt;
    private volatile ScheduledFuture<?> killTask;

    public TerminalSession(String sessionId,
                           SessionType sessionType,
                           String title,
                           String toolId,
                           String workdir,
                           FileSessionBinding fileSessionBinding,
                           TerminalRuntime runtime,
                           ExecutorService ioExecutor,
                           TerminalOutputRingBuffer ringBuffer,
                           SessionContextTracker contextTracker,
                           TerminalScreenTextTracker screenTextTracker,
                           Instant startedAt) {
        this.sessionId = sessionId;
        this.sessionType = sessionType;
        this.title = title;
        this.toolId = toolId;
        this.workdir = workdir;
        this.fileSessionBinding = fileSessionBinding;
        this.runtime = runtime;
        this.ioExecutor = ioExecutor;
        this.ringBuffer = ringBuffer;
        this.contextTracker = contextTracker;
        this.screenTextTracker = screenTextTracker;
        this.startedAt = startedAt;
        this.lastActiveAt = startedAt;
    }

    public String getSessionId() {
        return sessionId;
    }

    public SessionType getSessionType() {
        return sessionType;
    }

    public String getTitle() {
        return title;
    }

    public String getToolId() {
        return toolId;
    }

    public String getWorkdir() {
        return workdir;
    }

    public FileSessionBinding getFileSessionBinding() {
        return fileSessionBinding;
    }

    public TerminalRuntime getRuntime() {
        return runtime;
    }

    public ExecutorService getIoExecutor() {
        return ioExecutor;
    }

    public TerminalOutputRingBuffer getRingBuffer() {
        return ringBuffer;
    }

    public SessionContextTracker getContextTracker() {
        return contextTracker;
    }

    public TerminalScreenTextTracker getScreenTextTracker() {
        return screenTextTracker;
    }

    public AtomicLong getNextSeq() {
        return nextSeq;
    }

    public AtomicBoolean getClosed() {
        return closed;
    }

    public ReentrantLock getWsSendLock() {
        return wsSendLock;
    }

    public Instant getStartedAt() {
        return startedAt;
    }

    public ConcurrentMap<String, WebSocketSession> getAttachedClients() {
        return attachedClients;
    }

    public Instant getLastActiveAt() {
        return lastActiveAt;
    }

    public void touchLastActiveAt() {
        this.lastActiveAt = Instant.now();
    }

    public Instant getDetachedAt() {
        return detachedAt;
    }

    public void setDetachedAt(Instant detachedAt) {
        this.detachedAt = detachedAt;
    }

    public ScheduledFuture<?> getKillTask() {
        return killTask;
    }

    public void setKillTask(ScheduledFuture<?> killTask) {
        this.killTask = killTask;
    }
}

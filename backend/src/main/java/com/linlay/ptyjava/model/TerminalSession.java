package com.linlay.ptyjava.model;

import com.pty4j.PtyProcess;
import java.io.InputStream;
import java.io.OutputStream;
import java.time.Instant;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.locks.ReentrantLock;
import org.springframework.web.socket.WebSocketSession;

public class TerminalSession {

    private final String sessionId;
    private final PtyProcess process;
    private final OutputStream processIn;
    private final InputStream processOut;
    private final ExecutorService ioExecutor;
    private final AtomicBoolean closed = new AtomicBoolean(false);
    private final ReentrantLock wsSendLock = new ReentrantLock();
    private final Instant startedAt;

    private volatile WebSocketSession wsSession;
    private volatile ScheduledFuture<?> gcTask;

    public TerminalSession(String sessionId,
                           PtyProcess process,
                           OutputStream processIn,
                           InputStream processOut,
                           ExecutorService ioExecutor,
                           Instant startedAt) {
        this.sessionId = sessionId;
        this.process = process;
        this.processIn = processIn;
        this.processOut = processOut;
        this.ioExecutor = ioExecutor;
        this.startedAt = startedAt;
    }

    public String getSessionId() {
        return sessionId;
    }

    public PtyProcess getProcess() {
        return process;
    }

    public OutputStream getProcessIn() {
        return processIn;
    }

    public InputStream getProcessOut() {
        return processOut;
    }

    public ExecutorService getIoExecutor() {
        return ioExecutor;
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

    public WebSocketSession getWsSession() {
        return wsSession;
    }

    public void setWsSession(WebSocketSession wsSession) {
        this.wsSession = wsSession;
    }

    public ScheduledFuture<?> getGcTask() {
        return gcTask;
    }

    public void setGcTask(ScheduledFuture<?> gcTask) {
        this.gcTask = gcTask;
    }
}

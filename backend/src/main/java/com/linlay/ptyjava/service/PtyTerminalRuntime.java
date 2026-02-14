package com.linlay.ptyjava.service;

import com.pty4j.PtyProcess;
import com.pty4j.WinSize;
import java.io.InputStream;
import java.io.OutputStream;

public class PtyTerminalRuntime implements TerminalRuntime {

    private final PtyProcess process;

    public PtyTerminalRuntime(PtyProcess process) {
        this.process = process;
    }

    @Override
    public InputStream outputStream() {
        return process.getInputStream();
    }

    @Override
    public OutputStream inputStream() {
        return process.getOutputStream();
    }

    @Override
    public void resize(int cols, int rows) {
        process.setWinSize(new WinSize(cols, rows));
    }

    @Override
    public int awaitExit() throws Exception {
        return process.waitFor();
    }

    @Override
    public Integer exitCodeOrNull() {
        try {
            return process.exitValue();
        } catch (IllegalThreadStateException e) {
            return null;
        }
    }

    @Override
    public void close() {
        try {
            process.destroyForcibly();
        } catch (Exception ignored) {
        }
    }
}

package com.linlay.ptyjava.service;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

public interface TerminalRuntime {

    InputStream outputStream();

    OutputStream inputStream();

    void resize(int cols, int rows) throws IOException;

    int awaitExit() throws Exception;

    Integer exitCodeOrNull();

    void close();
}

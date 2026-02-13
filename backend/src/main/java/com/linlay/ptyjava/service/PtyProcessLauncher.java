package com.linlay.ptyjava.service;

import com.pty4j.PtyProcess;
import java.io.IOException;
import java.util.List;
import java.util.Map;

public interface PtyProcessLauncher {

    PtyProcess start(List<String> command, Map<String, String> env, String workdir, int cols, int rows) throws IOException;
}

package com.linlay.ptyjava.service;

import com.pty4j.PtyProcess;
import com.pty4j.WinSize;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class Pty4jProcessLauncher implements PtyProcessLauncher {

    @Override
    public PtyProcess start(List<String> command, Map<String, String> env, String workdir, int cols, int rows) throws IOException {
        PtyProcess process = PtyProcess.exec(command.toArray(new String[0]), env, workdir);
        process.setWinSize(new WinSize(cols, rows));
        return process;
    }
}

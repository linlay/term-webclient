package com.linlay.ptyjava.service.ssh;

import com.linlay.ptyjava.service.TerminalRuntime;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.EnumSet;
import org.apache.sshd.client.channel.ChannelShell;
import org.apache.sshd.client.channel.ClientChannelEvent;

public class SshShellRuntime implements TerminalRuntime {

    private final SshConnectionPool.SshConnectionLease lease;
    private final ChannelShell shell;

    private SshShellRuntime(SshConnectionPool.SshConnectionLease lease, ChannelShell shell) {
        this.lease = lease;
        this.shell = shell;
    }

    public static SshShellRuntime open(SshConnectionPool connectionPool,
                                       ResolvedSshCredential target,
                                       int cols,
                                       int rows) {
        SshConnectionPool.SshConnectionLease lease = null;
        ChannelShell shell = null;
        try {
            lease = connectionPool.acquire(target);
            shell = lease.openShellChannel(target.term(), cols, rows);
            return new SshShellRuntime(lease, shell);
        } catch (Exception e) {
            if (shell != null) {
                shell.close(false);
            }
            if (lease != null) {
                lease.close();
            }
            String message = SshErrorMapper.toUserMessage(e, "Failed to create SSH shell runtime");
            throw new SshSecurityException(message, e);
        }
    }

    @Override
    public InputStream outputStream() {
        return shell.getInvertedOut();
    }

    @Override
    public OutputStream inputStream() {
        return shell.getInvertedIn();
    }

    @Override
    public void resize(int cols, int rows) throws IOException {
        shell.sendWindowChange(cols, rows, 0, 0);
    }

    @Override
    public int awaitExit() throws Exception {
        shell.waitFor(EnumSet.of(ClientChannelEvent.CLOSED), 0L);
        Integer exitStatus = shell.getExitStatus();
        return exitStatus == null ? 0 : exitStatus;
    }

    @Override
    public Integer exitCodeOrNull() {
        return shell.getExitStatus();
    }

    @Override
    public void close() {
        shell.close(false);
        lease.close();
    }
}

package com.linlay.ptyjava.service.ssh;

import com.linlay.ptyjava.service.TerminalRuntime;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.util.Map;
import net.schmizz.sshj.connection.channel.direct.Session;

public class SshShellRuntime implements TerminalRuntime {

    private final SshConnectionPool.SshConnectionLease lease;
    private final Session session;
    private final Session.Shell shell;

    private SshShellRuntime(SshConnectionPool.SshConnectionLease lease, Session session, Session.Shell shell) {
        this.lease = lease;
        this.session = session;
        this.shell = shell;
    }

    public static SshShellRuntime open(SshConnectionPool connectionPool,
                                       ResolvedSshCredential target,
                                       int cols,
                                       int rows) {
        try {
            SshConnectionPool.SshConnectionLease lease = connectionPool.acquire(target);
            Session session = lease.openSession();
            session.allocatePTY(target.term(), cols, rows, 0, 0, Map.of());
            Session.Shell shell = session.startShell();
            return new SshShellRuntime(lease, session, shell);
        } catch (Exception e) {
            String message = SshErrorMapper.toUserMessage(e, "Failed to create SSH shell runtime");
            throw new SshSecurityException(message, e);
        }
    }

    @Override
    public InputStream outputStream() {
        return shell.getInputStream();
    }

    @Override
    public OutputStream inputStream() {
        return shell.getOutputStream();
    }

    @Override
    public void resize(int cols, int rows) throws IOException {
        try {
            Method method = shell.getClass().getMethod("changeWindowDimensions", int.class, int.class, int.class, int.class);
            method.invoke(shell, cols, rows, 0, 0);
        } catch (NoSuchMethodException ignored) {
            // Older SSH channel implementations may not support runtime resize.
        } catch (ReflectiveOperationException e) {
            throw new IOException("Failed to resize SSH shell", e);
        }
    }

    @Override
    public int awaitExit() throws Exception {
        shell.join();
        return 0;
    }

    @Override
    public Integer exitCodeOrNull() {
        return null;
    }

    @Override
    public void close() {
        try {
            shell.close();
        } catch (IOException ignored) {
        }
        try {
            session.close();
        } catch (IOException ignored) {
        }
        lease.close();
    }
}

package com.linlay.termjava.model;

import org.springframework.util.StringUtils;

public record FileSessionBinding(
    SessionType sessionType,
    String rootPath,
    String workdir,
    SshBinding ssh
) {

    public FileSessionBinding {
        if (!StringUtils.hasText(rootPath)) {
            throw new IllegalArgumentException("rootPath must not be blank");
        }
    }

    public static FileSessionBinding local(String rootPath, String workdir) {
        return new FileSessionBinding(SessionType.LOCAL_PTY, rootPath, workdir, null);
    }

    public static FileSessionBinding ssh(String rootPath,
                                         String workdir,
                                         String credentialId,
                                         String host,
                                         int port,
                                         String username,
                                         String initialCwd) {
        return new FileSessionBinding(
            SessionType.SSH_SHELL,
            rootPath,
            workdir,
            new SshBinding(credentialId, host, port, username, initialCwd)
        );
    }

    public record SshBinding(
        String credentialId,
        String host,
        int port,
        String username,
        String initialCwd
    ) {
    }
}

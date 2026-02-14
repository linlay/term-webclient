package com.linlay.ptyjava.service.ssh;

import com.linlay.ptyjava.model.ssh.SshAuthType;

public record ResolvedSshCredential(
    String credentialId,
    String host,
    int port,
    String username,
    String term,
    SshAuthType authType,
    String password,
    String privateKey,
    String privateKeyPassphrase
) {
}

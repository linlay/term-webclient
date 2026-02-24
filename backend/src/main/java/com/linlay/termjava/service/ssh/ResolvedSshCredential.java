package com.linlay.termjava.service.ssh;

import com.linlay.termjava.model.ssh.SshAuthType;

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

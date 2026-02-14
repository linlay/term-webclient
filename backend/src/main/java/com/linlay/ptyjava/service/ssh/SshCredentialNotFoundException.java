package com.linlay.ptyjava.service.ssh;

public class SshCredentialNotFoundException extends RuntimeException {

    public SshCredentialNotFoundException(String credentialId) {
        super("SSH credential not found: " + credentialId);
    }
}

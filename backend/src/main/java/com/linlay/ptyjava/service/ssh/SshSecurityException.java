package com.linlay.ptyjava.service.ssh;

public class SshSecurityException extends RuntimeException {

    public SshSecurityException(String message) {
        super(message);
    }

    public SshSecurityException(String message, Throwable cause) {
        super(message, cause);
    }
}

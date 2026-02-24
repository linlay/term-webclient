package com.linlay.termjava.auth;

public class AuthUnauthorizedException extends RuntimeException {

    public AuthUnauthorizedException(String message) {
        super(message);
    }

    public AuthUnauthorizedException(String message, Throwable cause) {
        super(message, cause);
    }
}

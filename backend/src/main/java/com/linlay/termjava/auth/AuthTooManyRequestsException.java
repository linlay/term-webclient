package com.linlay.termjava.auth;

public class AuthTooManyRequestsException extends RuntimeException {

    public AuthTooManyRequestsException(String message) {
        super(message);
    }
}

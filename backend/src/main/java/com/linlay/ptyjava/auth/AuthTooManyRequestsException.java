package com.linlay.ptyjava.auth;

public class AuthTooManyRequestsException extends RuntimeException {

    public AuthTooManyRequestsException(String message) {
        super(message);
    }
}

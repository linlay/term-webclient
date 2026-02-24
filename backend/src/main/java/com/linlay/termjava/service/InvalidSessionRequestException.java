package com.linlay.termjava.service;

public class InvalidSessionRequestException extends RuntimeException {

    public InvalidSessionRequestException(String message) {
        super(message);
    }
}

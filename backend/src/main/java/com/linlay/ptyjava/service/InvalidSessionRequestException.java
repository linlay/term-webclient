package com.linlay.ptyjava.service;

public class InvalidSessionRequestException extends RuntimeException {

    public InvalidSessionRequestException(String message) {
        super(message);
    }
}

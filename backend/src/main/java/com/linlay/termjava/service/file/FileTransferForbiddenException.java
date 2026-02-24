package com.linlay.termjava.service.file;

public class FileTransferForbiddenException extends RuntimeException {

    public FileTransferForbiddenException(String message) {
        super(message);
    }
}

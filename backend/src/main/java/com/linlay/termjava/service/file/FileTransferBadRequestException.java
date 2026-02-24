package com.linlay.termjava.service.file;

public class FileTransferBadRequestException extends RuntimeException {

    public FileTransferBadRequestException(String message) {
        super(message);
    }

    public FileTransferBadRequestException(String message, Throwable cause) {
        super(message, cause);
    }
}

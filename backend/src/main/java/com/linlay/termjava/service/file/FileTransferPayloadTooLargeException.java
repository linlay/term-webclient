package com.linlay.termjava.service.file;

public class FileTransferPayloadTooLargeException extends RuntimeException {

    public FileTransferPayloadTooLargeException(String message) {
        super(message);
    }
}

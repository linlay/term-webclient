package com.linlay.ptyjava.service.agent;

public class AgentOperationException extends RuntimeException {

    public AgentOperationException(String message) {
        super(message);
    }

    public AgentOperationException(String message, Throwable cause) {
        super(message, cause);
    }
}

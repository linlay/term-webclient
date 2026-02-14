package com.linlay.ptyjava.service.agent;

public class AgentRunNotFoundException extends RuntimeException {

    public AgentRunNotFoundException(String runId) {
        super("Agent run not found: " + runId);
    }
}

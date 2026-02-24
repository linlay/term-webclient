package com.linlay.termjava.model;

public enum SessionType {
    LOCAL_PTY,
    SSH_SHELL;

    public static SessionType normalize(SessionType value) {
        return value == null ? LOCAL_PTY : value;
    }
}

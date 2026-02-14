package com.linlay.ptyjava.model.auth;

public record AuthStatusResponse(
    boolean enabled,
    boolean authenticated,
    String username
) {
}

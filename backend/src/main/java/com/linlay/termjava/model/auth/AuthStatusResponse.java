package com.linlay.termjava.model.auth;

public record AuthStatusResponse(
    boolean enabled,
    boolean authenticated,
    String username
) {
}

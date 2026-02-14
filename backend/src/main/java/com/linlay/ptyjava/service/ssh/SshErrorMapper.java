package com.linlay.ptyjava.service.ssh;

import java.util.Locale;

public final class SshErrorMapper {

    private SshErrorMapper() {
    }

    public static String toUserMessage(Throwable throwable, String fallback) {
        if (throwable == null) {
            return fallback;
        }

        Throwable cursor = throwable;
        while (cursor != null) {
            String message = cursor.getMessage();
            if (message != null) {
                String normalized = message.toLowerCase(Locale.ROOT);
                if (normalized.contains("no identification received")) {
                    return "SSH handshake failed: target port is not an SSH service, or a gateway closed the connection before SSH identification.";
                }
                if (normalized.contains("auth fail") || normalized.contains("authentication failed")) {
                    return "SSH authentication failed: please verify username and credential secret.";
                }
                if (normalized.contains("connection refused")) {
                    return "SSH connection refused by target host/port.";
                }
                if (normalized.contains("timed out") || normalized.contains("timeout")) {
                    return "SSH connection timed out while reaching target host.";
                }
                if (normalized.contains("unknownhost") || normalized.contains("unresolved")) {
                    return "SSH target host cannot be resolved.";
                }
            }
            cursor = cursor.getCause();
        }

        return fallback;
    }
}

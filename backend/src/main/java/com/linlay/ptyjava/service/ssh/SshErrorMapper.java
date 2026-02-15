package com.linlay.ptyjava.service.ssh;

import java.util.Locale;

public final class SshErrorMapper {

    private static final String HANDSHAKE_CLOSE_MESSAGE =
        "SSH handshake failed before server identification. Possible causes: non-SSH target port, gateway/proxy closure, or SSH server throttling unauthenticated sessions (MaxStartups).";
    private static final String MAX_STARTUPS_MESSAGE =
        "SSH server is throttling new unauthenticated sessions (MaxStartups exceeded). Retry shortly, or increase MaxStartups on the SSH server.";

    private SshErrorMapper() {
    }

    public static String toUserMessage(Throwable throwable, String fallback) {
        if (throwable == null) {
            return fallback;
        }

        String deepestDetail = null;
        Throwable cursor = throwable;
        while (cursor != null) {
            String message = cursor.getMessage();
            if (hasText(message)) {
                String compactMessage = compact(message);
                deepestDetail = compactMessage;
                String normalizedMessage = compactMessage.toLowerCase(Locale.ROOT);
                if (normalizedMessage.startsWith("ssh handshake failed:")
                    || normalizedMessage.startsWith("ssh authentication failed:")
                    || normalizedMessage.startsWith("ssh connection refused")
                    || normalizedMessage.startsWith("ssh connection timed out")
                    || normalizedMessage.startsWith("ssh target host cannot be resolved")) {
                    return compactMessage;
                }
            } else if (hasText(cursor.toString())) {
                deepestDetail = compact(cursor.toString());
            }

            String normalizedDiagnostic = diagnostic(cursor).toLowerCase(Locale.ROOT);
            if (normalizedDiagnostic.contains("repeatedly closed during identification exchange")) {
                return HANDSHAKE_CLOSE_MESSAGE;
            }
            if (normalizedDiagnostic.contains("no identification received")
                || (normalizedDiagnostic.contains("end of connection") && normalizedDiagnostic.contains("identification"))
                || (normalizedDiagnostic.contains("closed connection") && normalizedDiagnostic.contains("identification exchange"))
                || normalizedDiagnostic.contains("server closed connection during identification exchange")) {
                return HANDSHAKE_CLOSE_MESSAGE;
            }
            if (normalizedDiagnostic.contains("maxstartups") || normalizedDiagnostic.contains("exceeded maxstartups")) {
                return MAX_STARTUPS_MESSAGE;
            }
            if (normalizedDiagnostic.contains("auth fail")
                || normalizedDiagnostic.contains("authentication failed")
                || normalizedDiagnostic.contains("no more authentication methods available")
                || normalizedDiagnostic.contains("authentications that can continue")) {
                return "SSH authentication failed: please verify username and credential secret.";
            }
            if (normalizedDiagnostic.contains("connection refused")) {
                return "SSH connection refused by target host/port.";
            }
            if (normalizedDiagnostic.contains("timed out")
                || normalizedDiagnostic.contains("timeout")
                || normalizedDiagnostic.contains("key exchange timeout")
                || normalizedDiagnostic.contains("connect timed out")) {
                return "SSH connection timed out while reaching target host.";
            }
            if (normalizedDiagnostic.contains("unknownhost")
                || normalizedDiagnostic.contains("unknown host")
                || normalizedDiagnostic.contains("unresolved")
                || normalizedDiagnostic.contains("cannot resolve")) {
                return "SSH target host cannot be resolved.";
            }
            cursor = cursor.getCause();
        }

        if (hasText(deepestDetail) && !deepestDetail.equalsIgnoreCase(fallback)) {
            return fallback + ": " + deepestDetail;
        }
        return fallback;
    }

    private static String diagnostic(Throwable throwable) {
        String message = compact(throwable.getMessage());
        String rendered = compact(throwable.toString());
        if (!hasText(rendered)) {
            return message;
        }
        if (!hasText(message) || rendered.equals(message)) {
            return rendered;
        }
        return message + " " + rendered;
    }

    private static String compact(String value) {
        if (!hasText(value)) {
            return "";
        }
        String compacted = value.replace('\r', ' ').replace('\n', ' ').trim();
        if (compacted.length() > 220) {
            return compacted.substring(0, 220) + "...";
        }
        return compacted;
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }
}

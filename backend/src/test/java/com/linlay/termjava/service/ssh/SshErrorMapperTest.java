package com.linlay.termjava.service.ssh;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class SshErrorMapperTest {

    @Test
    void mapsNoIdentificationReceivedToHandshakeMessage() {
        RuntimeException ex = new RuntimeException("Received end of connection, but no identification received.");

        String message = SshErrorMapper.toUserMessage(ex, "Failed to create SSH shell runtime");

        assertEquals(
            "SSH handshake failed before server identification. Possible causes: non-SSH target port, gateway/proxy closure, or SSH server throttling unauthenticated sessions (MaxStartups).",
            message
        );
    }

    @Test
    void mapsEndOfConnectionIdentificationVariantToHandshakeMessage() {
        RuntimeException ex = new RuntimeException("Transport ended with end of connection before SSH identification exchange.");

        String message = SshErrorMapper.toUserMessage(ex, "Failed to create SSH shell runtime");

        assertEquals(
            "SSH handshake failed before server identification. Possible causes: non-SSH target port, gateway/proxy closure, or SSH server throttling unauthenticated sessions (MaxStartups).",
            message
        );
    }

    @Test
    void mapsServerClosedDuringIdentificationExchangeVariantToHandshakeMessage() {
        RuntimeException ex = new RuntimeException("Server closed connection during identification exchange");

        String message = SshErrorMapper.toUserMessage(ex, "Failed to create SSH shell runtime");

        assertEquals(
            "SSH handshake failed before server identification. Possible causes: non-SSH target port, gateway/proxy closure, or SSH server throttling unauthenticated sessions (MaxStartups).",
            message
        );
    }

    @Test
    void mapsMaxStartupsThrottleToDedicatedMessage() {
        RuntimeException ex = new RuntimeException("Exceeded MaxStartups");

        String message = SshErrorMapper.toUserMessage(ex, "Failed to create SSH shell runtime");

        assertEquals(
            "SSH server is throttling new unauthenticated sessions (MaxStartups exceeded). Retry shortly, or increase MaxStartups on the SSH server.",
            message
        );
    }

    @Test
    void mapsRepeatedIdentificationClosureToHandshakeMessage() {
        RuntimeException ex = new RuntimeException("SSH handshake repeatedly closed during identification exchange after 3 attempts");

        String message = SshErrorMapper.toUserMessage(ex, "Failed to create SSH shell runtime");

        assertEquals(
            "SSH handshake failed before server identification. Possible causes: non-SSH target port, gateway/proxy closure, or SSH server throttling unauthenticated sessions (MaxStartups).",
            message
        );
    }

    @Test
    void preservesAlreadyMappedSshMessages() {
        RuntimeException ex = new RuntimeException("SSH authentication failed: please verify username and credential secret.");

        String message = SshErrorMapper.toUserMessage(ex, "SSH preflight failed");

        assertEquals("SSH authentication failed: please verify username and credential secret.", message);
    }

    @Test
    void fallbackIncludesDeepestErrorDetail() {
        RuntimeException ex = new RuntimeException("Failed to connect SSH target", new RuntimeException("Connection aborted by peer"));

        String message = SshErrorMapper.toUserMessage(ex, "Failed to create SSH shell runtime");

        assertEquals("Failed to create SSH shell runtime: Connection aborted by peer", message);
    }

    @Test
    void mapsMinaAuthContinuationFailureToAuthMessage() {
        RuntimeException ex = new RuntimeException("No more authentication methods available");

        String message = SshErrorMapper.toUserMessage(ex, "SSH preflight failed");

        assertEquals("SSH authentication failed: please verify username and credential secret.", message);
    }

    @Test
    void mapsMinaUnknownHostDiagnosticToHostResolutionMessage() {
        RuntimeException ex = new RuntimeException("java.net.UnknownHostException: invalid.example");

        String message = SshErrorMapper.toUserMessage(ex, "SSH preflight failed");

        assertEquals("SSH target host cannot be resolved.", message);
    }

    @Test
    void mapsMinaKeyExchangeTimeoutToTimeoutMessage() {
        RuntimeException ex = new RuntimeException("Key exchange timeout");

        String message = SshErrorMapper.toUserMessage(ex, "SSH preflight failed");

        assertEquals("SSH connection timed out while reaching target host.", message);
    }
}

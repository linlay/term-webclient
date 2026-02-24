package com.linlay.termjava.service.ssh;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.linlay.termjava.config.TerminalProperties;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class TofuHostKeyVerifierTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @TempDir
    Path tempDir;

    @Test
    void acceptsAndPersistsFirstSeenHostKey() throws Exception {
        TerminalProperties props = baseProps();
        TofuHostKeyVerifier verifier = new TofuHostKeyVerifier(objectMapper, props);
        KeyPair keyPair = generateRsaKeyPair();

        boolean accepted = verifier.verify("example.internal", 22, keyPair.getPublic());

        assertTrue(accepted);
        Path path = Path.of(props.getSsh().getKnownHostsFile());
        assertTrue(Files.exists(path));

        JsonNode root = objectMapper.readTree(Files.readString(path));
        assertEquals(1, root.path("version").asInt());
        assertEquals("example.internal", root.path("entries").get(0).path("host").asText());
        assertEquals(22, root.path("entries").get(0).path("port").asInt());
        assertTrue(root.path("entries").get(0).path("fingerprintSha256").asText().startsWith("SHA256:"));
    }

    @Test
    void rejectsChangedHostKeyForSameHostAndPort() throws Exception {
        TerminalProperties props = baseProps();
        TofuHostKeyVerifier verifier = new TofuHostKeyVerifier(objectMapper, props);
        KeyPair first = generateRsaKeyPair();
        KeyPair second = generateRsaKeyPair();

        assertTrue(verifier.verify("example.internal", 22, first.getPublic()));
        assertFalse(verifier.verify("example.internal", 22, second.getPublic()));
    }

    @Test
    void acceptsSameKeyOnRepeatVerification() throws Exception {
        TerminalProperties props = baseProps();
        TofuHostKeyVerifier verifier = new TofuHostKeyVerifier(objectMapper, props);
        KeyPair keyPair = generateRsaKeyPair();

        assertTrue(verifier.verify("example.internal", 22, keyPair.getPublic()));
        assertTrue(verifier.verify("example.internal", 22, keyPair.getPublic()));
    }

    private TerminalProperties baseProps() {
        TerminalProperties props = new TerminalProperties();
        props.getSsh().setKnownHostsFile(tempDir.resolve("known-hosts.json").toString());
        return props;
    }

    private static KeyPair generateRsaKeyPair() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        return generator.generateKeyPair();
    }
}

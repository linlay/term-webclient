package com.linlay.ptyjava.service.ssh;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.linlay.ptyjava.config.TerminalProperties;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.locks.ReentrantLock;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

@Component
public class TofuHostKeyVerifier {

    private final ObjectMapper objectMapper;
    private final TerminalProperties properties;
    private final ReentrantLock lock = new ReentrantLock();

    public TofuHostKeyVerifier(ObjectMapper objectMapper, TerminalProperties properties) {
        this.objectMapper = objectMapper;
        this.properties = properties;
    }

    public boolean verify(String hostname, int port, PublicKey key) {
        String normalizedHost = StringUtils.hasText(hostname) ? hostname.trim() : "";
        if (!StringUtils.hasText(normalizedHost) || port <= 0 || key == null) {
            return false;
        }

        String fingerprint = fingerprintSha256(key);

        lock.lock();
        try {
            KnownHostFile file = readFile();
            KnownHostEntry existing = file.entries.stream()
                .filter(item -> Objects.equals(item.host, normalizedHost) && item.port == port)
                .findFirst()
                .orElse(null);

            if (existing == null) {
                KnownHostEntry entry = new KnownHostEntry();
                entry.host = normalizedHost;
                entry.port = port;
                entry.fingerprintSha256 = fingerprint;
                file.entries.add(entry);
                writeFile(file);
                return true;
            }

            return Objects.equals(existing.fingerprintSha256, fingerprint);
        } finally {
            lock.unlock();
        }
    }

    private String fingerprintSha256(PublicKey key) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(key.getEncoded());
            return "SHA256:" + Base64.getEncoder().encodeToString(hash);
        } catch (Exception e) {
            throw new SshSecurityException("Failed to compute host key fingerprint", e);
        }
    }

    private KnownHostFile readFile() {
        Path path = knownHostsPath();
        if (!Files.exists(path)) {
            return new KnownHostFile();
        }

        try {
            String text = Files.readString(path, StandardCharsets.UTF_8);
            if (!StringUtils.hasText(text)) {
                return new KnownHostFile();
            }
            KnownHostFile file = objectMapper.readValue(text, KnownHostFile.class);
            if (file.entries == null) {
                file.entries = new ArrayList<>();
            }
            return file;
        } catch (IOException e) {
            throw new SshSecurityException("Failed to read known hosts file", e);
        }
    }

    private void writeFile(KnownHostFile file) {
        Path path = knownHostsPath();
        try {
            if (path.getParent() != null) {
                Files.createDirectories(path.getParent());
            }
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(path.toFile(), file);
        } catch (IOException e) {
            throw new SshSecurityException("Failed to persist known hosts file", e);
        }
    }

    private Path knownHostsPath() {
        return Path.of(properties.getSsh().getKnownHostsFile());
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private static class KnownHostFile {
        public int version = 1;
        public List<KnownHostEntry> entries = new ArrayList<>();
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private static class KnownHostEntry {
        public String host;
        public int port;
        public String fingerprintSha256;
    }
}

package com.linlay.ptyjava.service.ssh;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.linlay.ptyjava.config.TerminalProperties;
import com.linlay.ptyjava.model.ssh.CreateSshCredentialRequest;
import com.linlay.ptyjava.model.ssh.SshAuthType;
import com.linlay.ptyjava.model.ssh.SshCredentialResponse;
import com.linlay.ptyjava.model.ssh.SshCredentialSummaryResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.locks.ReentrantLock;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class SshCredentialStore {

    private static final int GCM_TAG_BITS = 128;
    private static final int GCM_IV_BYTES = 12;

    private final TerminalProperties properties;
    private final ObjectMapper objectMapper;
    private final ReentrantLock lock = new ReentrantLock();
    private final SecureRandom secureRandom = new SecureRandom();

    public SshCredentialStore(TerminalProperties properties, ObjectMapper objectMapper) {
        this.properties = properties;
        this.objectMapper = objectMapper;
    }

    public SshCredentialResponse createCredential(CreateSshCredentialRequest request) {
        if (!properties.getSsh().isEnabled()) {
            throw new SshSecurityException("SSH is disabled");
        }

        validateCreateRequest(request);
        String credentialId = UUID.randomUUID().toString();
        int port = request.getPort() == null ? properties.getSsh().getDefaultPort() : request.getPort();
        SshAuthType authType = StringUtils.hasText(request.getPrivateKey()) ? SshAuthType.PRIVATE_KEY : SshAuthType.PASSWORD;
        Instant createdAt = Instant.now();

        SecretPayload payload = new SecretPayload();
        payload.password = request.getPassword();
        payload.privateKey = request.getPrivateKey();
        payload.privateKeyPassphrase = request.getPrivateKeyPassphrase();

        StoredCredential stored = new StoredCredential();
        stored.credentialId = credentialId;
        stored.host = request.getHost().trim();
        stored.port = port;
        stored.username = request.getUsername().trim();
        stored.authType = authType;
        stored.createdAt = createdAt;
        stored.encryptedSecret = encrypt(secretToJson(payload));

        lock.lock();
        try {
            CredentialFile file = loadFile();
            file.credentials.add(stored);
            persist(file);
        } finally {
            lock.unlock();
        }

        return new SshCredentialResponse(
            credentialId,
            stored.host,
            stored.port,
            stored.username,
            stored.authType,
            createdAt
        );
    }

    public ResolvedSshCredential resolveCredential(String credentialId,
                                                   String overrideHost,
                                                   Integer overridePort,
                                                   String overrideUsername,
                                                   String overrideTerm) {
        if (!StringUtils.hasText(credentialId)) {
            throw new SshSecurityException("credentialId is required");
        }

        lock.lock();
        try {
            CredentialFile file = loadFile();
            StoredCredential match = file.credentials.stream()
                .filter(item -> Objects.equals(item.credentialId, credentialId))
                .findFirst()
                .orElseThrow(() -> new SshCredentialNotFoundException(credentialId));

            SecretPayload payload = secretFromJson(decrypt(match.encryptedSecret));
            String host = StringUtils.hasText(overrideHost) ? overrideHost.trim() : match.host;
            int port = overridePort == null ? match.port : overridePort;
            String username = StringUtils.hasText(overrideUsername) ? overrideUsername.trim() : match.username;
            String term = StringUtils.hasText(overrideTerm) ? overrideTerm.trim() : properties.getSsh().getDefaultTerm();

            if (!StringUtils.hasText(host) || !StringUtils.hasText(username)) {
                throw new SshSecurityException("Resolved SSH target is missing host or username");
            }

            return new ResolvedSshCredential(
                match.credentialId,
                host,
                port,
                username,
                term,
                match.authType,
                payload.password,
                payload.privateKey,
                payload.privateKeyPassphrase
            );
        } finally {
            lock.unlock();
        }
    }

    public List<SshCredentialSummaryResponse> listCredentials() {
        lock.lock();
        try {
            CredentialFile file = loadFile();
            return file.credentials.stream()
                .map(item -> new SshCredentialSummaryResponse(
                    item.credentialId,
                    item.host,
                    item.port,
                    item.username,
                    item.authType,
                    item.createdAt
                ))
                .toList();
        } finally {
            lock.unlock();
        }
    }

    private void validateCreateRequest(CreateSshCredentialRequest request) {
        if (request == null) {
            throw new SshSecurityException("request must not be null");
        }
        if (!StringUtils.hasText(request.getHost())) {
            throw new SshSecurityException("host must not be blank");
        }
        if (!StringUtils.hasText(request.getUsername())) {
            throw new SshSecurityException("username must not be blank");
        }

        boolean hasPassword = StringUtils.hasText(request.getPassword());
        boolean hasPrivateKey = StringUtils.hasText(request.getPrivateKey());
        if (hasPassword == hasPrivateKey) {
            throw new SshSecurityException("Provide exactly one auth secret: password or privateKey");
        }

        if (request.getPort() != null && (request.getPort() <= 0 || request.getPort() > 65535)) {
            throw new SshSecurityException("port must be between 1 and 65535");
        }
    }

    private CredentialFile loadFile() {
        Path path = credentialFilePath();
        if (!Files.exists(path)) {
            return new CredentialFile();
        }

        try {
            String text = Files.readString(path, StandardCharsets.UTF_8);
            if (!StringUtils.hasText(text)) {
                return new CredentialFile();
            }
            CredentialFile file = objectMapper.readValue(text, CredentialFile.class);
            if (file.credentials == null) {
                file.credentials = new ArrayList<>();
            }
            return file;
        } catch (IOException e) {
            throw new SshSecurityException("Failed to read credential store", e);
        }
    }

    private void persist(CredentialFile file) {
        Path path = credentialFilePath();
        try {
            if (path.getParent() != null) {
                Files.createDirectories(path.getParent());
            }
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(path.toFile(), file);
        } catch (IOException e) {
            throw new SshSecurityException("Failed to persist credential store", e);
        }
    }

    private String secretToJson(SecretPayload payload) {
        try {
            return objectMapper.writeValueAsString(payload);
        } catch (IOException e) {
            throw new SshSecurityException("Failed to encode credential secret", e);
        }
    }

    private SecretPayload secretFromJson(String json) {
        try {
            return objectMapper.readValue(json, SecretPayload.class);
        } catch (IOException e) {
            throw new SshSecurityException("Failed to decode credential secret", e);
        }
    }

    private String encrypt(String plaintext) {
        try {
            byte[] iv = new byte[GCM_IV_BYTES];
            secureRandom.nextBytes(iv);

            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, masterKey(), new GCMParameterSpec(GCM_TAG_BITS, iv));
            byte[] cipherText = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));

            byte[] merged = new byte[iv.length + cipherText.length];
            System.arraycopy(iv, 0, merged, 0, iv.length);
            System.arraycopy(cipherText, 0, merged, iv.length, cipherText.length);
            return Base64.getEncoder().encodeToString(merged);
        } catch (GeneralSecurityException e) {
            throw new SshSecurityException("Credential encryption failed", e);
        }
    }

    private String decrypt(String encoded) {
        try {
            byte[] merged = Base64.getDecoder().decode(encoded);
            if (merged.length <= GCM_IV_BYTES) {
                throw new SshSecurityException("Credential payload is invalid");
            }

            byte[] iv = new byte[GCM_IV_BYTES];
            byte[] cipherText = new byte[merged.length - GCM_IV_BYTES];
            System.arraycopy(merged, 0, iv, 0, iv.length);
            System.arraycopy(merged, iv.length, cipherText, 0, cipherText.length);

            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, masterKey(), new GCMParameterSpec(GCM_TAG_BITS, iv));
            byte[] plain = cipher.doFinal(cipherText);
            return new String(plain, StandardCharsets.UTF_8);
        } catch (GeneralSecurityException | IllegalArgumentException e) {
            throw new SshSecurityException("Credential decryption failed", e);
        }
    }

    private SecretKeySpec masterKey() {
        String rawKey = properties.getSsh().getMasterKey();
        if (!StringUtils.hasText(rawKey)) {
            String envVar = properties.getSsh().getMasterKeyEnv();
            rawKey = envVar == null ? null : System.getenv(envVar);
            if (!StringUtils.hasText(rawKey)) {
                throw new SshSecurityException("Missing SSH credential master key in terminal.ssh.master-key or env: " + envVar);
            }
        }

        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] keyBytes = digest.digest(rawKey.getBytes(StandardCharsets.UTF_8));
            return new SecretKeySpec(keyBytes, "AES");
        } catch (GeneralSecurityException e) {
            throw new SshSecurityException("Failed to derive credential master key", e);
        }
    }

    private Path credentialFilePath() {
        return Path.of(properties.getSsh().getCredentialsFile());
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private static class CredentialFile {
        public int version = 1;
        public List<StoredCredential> credentials = new ArrayList<>();
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private static class StoredCredential {
        public String credentialId;
        public String host;
        public int port;
        public String username;
        public SshAuthType authType;
        public Instant createdAt;
        public String encryptedSecret;
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private static class SecretPayload {
        public String password;
        public String privateKey;
        public String privateKeyPassphrase;
    }
}

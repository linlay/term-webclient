package com.linlay.ptyjava.service.ssh;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.linlay.ptyjava.config.TerminalProperties;
import com.linlay.ptyjava.model.ssh.CreateSshCredentialRequest;
import com.linlay.ptyjava.model.ssh.SshCredentialSummaryResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class SshCredentialStoreTest {

    @Test
    void createCredentialUsesMasterKeyPropertyEvenWithoutEnv(@TempDir Path tempDir) {
        TerminalProperties props = baseProps(tempDir);
        props.getSsh().setMasterKey("local-master-key");
        props.getSsh().setMasterKeyEnv("__missing_env__");
        SshCredentialStore store = new SshCredentialStore(props, objectMapper());

        String credentialId = store.createCredential(passwordRequest()).credentialId();

        assertNotNull(credentialId);
        assertNotNull(store.resolveCredential(credentialId, null, null, null, null));
    }

    @Test
    void createCredentialFallsBackToEnvMasterKey(@TempDir Path tempDir) {
        TerminalProperties props = baseProps(tempDir);
        props.getSsh().setMasterKey(null);

        String envName = firstNonEmptyEnvName();
        assumeTrue(envName != null, "No non-empty environment variable available for test");
        props.getSsh().setMasterKeyEnv(envName);

        SshCredentialStore store = new SshCredentialStore(props, objectMapper());
        String credentialId = store.createCredential(passwordRequest()).credentialId();

        assertNotNull(credentialId);
    }

    @Test
    void createCredentialFailsWhenMasterKeyMissing(@TempDir Path tempDir) {
        TerminalProperties props = baseProps(tempDir);
        props.getSsh().setMasterKey("");
        props.getSsh().setMasterKeyEnv("__missing_env__");
        SshCredentialStore store = new SshCredentialStore(props, objectMapper());

        assertThrows(SshSecurityException.class, () -> store.createCredential(passwordRequest()));
    }

    @Test
    void listCredentialsReturnsSummariesWithoutPlainSecrets(@TempDir Path tempDir) throws Exception {
        TerminalProperties props = baseProps(tempDir);
        props.getSsh().setMasterKey("local-master-key");
        SshCredentialStore store = new SshCredentialStore(props, objectMapper());

        String credentialId = store.createCredential(passwordRequest()).credentialId();
        List<SshCredentialSummaryResponse> list = store.listCredentials();

        assertEquals(1, list.size());
        assertEquals(credentialId, list.get(0).credentialId());
        assertEquals("10.0.0.2", list.get(0).host());
        assertEquals("ubuntu", list.get(0).username());

        String persisted = Files.readString(tempDir.resolve("ssh-credentials.json"), StandardCharsets.UTF_8);
        assertFalse(persisted.contains("secret-pass"));
    }

    @Test
    void deleteCredentialRemovesPersistedEntry(@TempDir Path tempDir) throws Exception {
        TerminalProperties props = baseProps(tempDir);
        props.getSsh().setMasterKey("local-master-key");
        SshCredentialStore store = new SshCredentialStore(props, objectMapper());

        String credentialId = store.createCredential(passwordRequest()).credentialId();
        assertEquals(1, store.listCredentials().size());

        store.deleteCredential(credentialId);

        List<SshCredentialSummaryResponse> list = store.listCredentials();
        assertEquals(0, list.size());

        String persisted = Files.readString(tempDir.resolve("ssh-credentials.json"), StandardCharsets.UTF_8);
        ObjectMapper mapper = objectMapper();
        @SuppressWarnings("unchecked")
        Map<String, Object> root = mapper.readValue(persisted, Map.class);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> credentials = (List<Map<String, Object>>) root.get("credentials");
        assertEquals(0, credentials.size());
    }

    private static TerminalProperties baseProps(Path tempDir) {
        TerminalProperties props = new TerminalProperties();
        props.getSsh().setCredentialsFile(tempDir.resolve("ssh-credentials.json").toString());
        return props;
    }

    private static CreateSshCredentialRequest passwordRequest() {
        CreateSshCredentialRequest request = new CreateSshCredentialRequest();
        request.setHost("10.0.0.2");
        request.setPort(22);
        request.setUsername("ubuntu");
        request.setPassword("secret-pass");
        return request;
    }

    private static String firstNonEmptyEnvName() {
        for (Map.Entry<String, String> entry : System.getenv().entrySet()) {
            if (entry.getValue() != null && !entry.getValue().isBlank()) {
                return entry.getKey();
            }
        }
        return null;
    }

    private static ObjectMapper objectMapper() {
        return new ObjectMapper().findAndRegisterModules();
    }
}

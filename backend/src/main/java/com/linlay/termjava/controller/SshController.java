package com.linlay.termjava.controller;

import com.linlay.termjava.model.ssh.CreateSshCredentialRequest;
import com.linlay.termjava.model.ssh.SshCredentialResponse;
import com.linlay.termjava.model.ssh.SshExecRequest;
import com.linlay.termjava.model.ssh.SshExecResponse;
import com.linlay.termjava.model.ssh.SshPreflightResponse;
import com.linlay.termjava.service.ssh.SshCredentialNotFoundException;
import com.linlay.termjava.service.ssh.SshCredentialStore;
import com.linlay.termjava.service.ssh.SshExecService;
import com.linlay.termjava.service.ssh.SshPreflightService;
import com.linlay.termjava.service.ssh.SshSecurityException;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping({"/webapi/ssh", "/appapi/ssh"})
public class SshController {

    private final SshCredentialStore credentialStore;
    private final SshExecService sshExecService;
    private final SshPreflightService sshPreflightService;

    public SshController(SshCredentialStore credentialStore,
                         SshExecService sshExecService,
                         SshPreflightService sshPreflightService) {
        this.credentialStore = credentialStore;
        this.sshExecService = sshExecService;
        this.sshPreflightService = sshPreflightService;
    }

    @GetMapping("/credentials")
    public ResponseEntity<List<SshCredentialResponse>> listCredentials() {
        return ResponseEntity.ok(credentialStore.listCredentials());
    }

    @PostMapping("/credentials")
    public ResponseEntity<SshCredentialResponse> createCredential(@RequestBody CreateSshCredentialRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(credentialStore.createCredential(request));
    }

    @DeleteMapping("/credentials/{credentialId}")
    public ResponseEntity<Void> deleteCredential(@PathVariable String credentialId) {
        credentialStore.deleteCredential(credentialId);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/credentials/{credentialId}/preflight")
    public ResponseEntity<SshPreflightResponse> preflight(@PathVariable String credentialId) {
        return ResponseEntity.ok(sshPreflightService.preflight(credentialId));
    }

    @PostMapping("/exec")
    public ResponseEntity<SshExecResponse> exec(@RequestBody SshExecRequest request) {
        return ResponseEntity.ok(sshExecService.execute(request));
    }

    @ExceptionHandler(SshCredentialNotFoundException.class)
    public ResponseEntity<Map<String, String>> handleCredentialNotFound(SshCredentialNotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", ex.getMessage()));
    }

    @ExceptionHandler(SshSecurityException.class)
    public ResponseEntity<Map<String, String>> handleSecurity(SshSecurityException ex) {
        return ResponseEntity.badRequest().body(Map.of("error", ex.getMessage()));
    }

    @ExceptionHandler(RuntimeException.class)
    public ResponseEntity<Map<String, String>> handleRuntime(RuntimeException ex) {
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(Map.of("error", "ssh operation failed"));
    }
}

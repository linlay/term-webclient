package com.linlay.ptyjava.controller;

import com.linlay.ptyjava.model.ssh.CreateSshCredentialRequest;
import com.linlay.ptyjava.model.ssh.SshCredentialResponse;
import com.linlay.ptyjava.model.ssh.SshExecRequest;
import com.linlay.ptyjava.model.ssh.SshExecResponse;
import com.linlay.ptyjava.service.ssh.SshCredentialNotFoundException;
import com.linlay.ptyjava.service.ssh.SshCredentialStore;
import com.linlay.ptyjava.service.ssh.SshExecService;
import com.linlay.ptyjava.service.ssh.SshSecurityException;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/ssh")
public class SshController {

    private final SshCredentialStore credentialStore;
    private final SshExecService sshExecService;

    public SshController(SshCredentialStore credentialStore, SshExecService sshExecService) {
        this.credentialStore = credentialStore;
        this.sshExecService = sshExecService;
    }

    @PostMapping("/credentials")
    public ResponseEntity<SshCredentialResponse> createCredential(@RequestBody CreateSshCredentialRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(credentialStore.createCredential(request));
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

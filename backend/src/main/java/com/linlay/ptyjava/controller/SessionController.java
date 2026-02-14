package com.linlay.ptyjava.controller;

import com.linlay.ptyjava.model.CreateSessionRequest;
import com.linlay.ptyjava.model.CreateSessionResponse;
import com.linlay.ptyjava.model.SessionSnapshotResponse;
import com.linlay.ptyjava.service.InvalidSessionRequestException;
import com.linlay.ptyjava.service.SessionNotFoundException;
import com.linlay.ptyjava.service.TerminalSessionService;
import com.linlay.ptyjava.service.ssh.SshCredentialNotFoundException;
import com.linlay.ptyjava.service.ssh.SshSecurityException;
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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/sessions")
public class SessionController {

    private final TerminalSessionService terminalSessionService;

    public SessionController(TerminalSessionService terminalSessionService) {
        this.terminalSessionService = terminalSessionService;
    }

    @PostMapping
    public ResponseEntity<CreateSessionResponse> createSession(@RequestBody(required = false) CreateSessionRequest request) {
        CreateSessionResponse response = terminalSessionService.createSession(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    @DeleteMapping("/{sessionId}")
    public ResponseEntity<Void> closeSession(@PathVariable String sessionId) {
        if (!terminalSessionService.exists(sessionId)) {
            throw new SessionNotFoundException(sessionId);
        }
        terminalSessionService.closeSession(sessionId, "deleted by api", true);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/{sessionId}/snapshot")
    public ResponseEntity<SessionSnapshotResponse> snapshot(@PathVariable String sessionId,
                                                            @RequestParam(name = "afterSeq", defaultValue = "0") long afterSeq) {
        return ResponseEntity.ok(terminalSessionService.getSnapshot(sessionId, afterSeq));
    }

    @ExceptionHandler(InvalidSessionRequestException.class)
    public ResponseEntity<Map<String, String>> handleBadRequest(InvalidSessionRequestException ex) {
        return ResponseEntity.badRequest().body(Map.of("error", ex.getMessage()));
    }

    @ExceptionHandler(SessionNotFoundException.class)
    public ResponseEntity<Map<String, String>> handleNotFound(SessionNotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", ex.getMessage()));
    }

    @ExceptionHandler(SshCredentialNotFoundException.class)
    public ResponseEntity<Map<String, String>> handleSshCredentialNotFound(SshCredentialNotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", ex.getMessage()));
    }

    @ExceptionHandler(SshSecurityException.class)
    public ResponseEntity<Map<String, String>> handleSshSecurity(SshSecurityException ex) {
        return ResponseEntity.badRequest().body(Map.of("error", ex.getMessage()));
    }

    @ExceptionHandler(RuntimeException.class)
    public ResponseEntity<Map<String, String>> handleRuntime(RuntimeException ex) {
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(Map.of("error", "terminal session operation failed"));
    }
}

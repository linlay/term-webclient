package com.linlay.termjava.controller.workspace;

import com.linlay.termjava.model.workspace.ContextPackRequest;
import com.linlay.termjava.model.workspace.ContextPackResponse;
import com.linlay.termjava.service.workspace.InvalidWorkspaceContextRequestException;
import com.linlay.termjava.service.workspace.WorkspaceContextService;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping({"/webapi/workspace", "/appapi/workspace"})
public class WorkspaceContextController {

    private final WorkspaceContextService workspaceContextService;

    public WorkspaceContextController(WorkspaceContextService workspaceContextService) {
        this.workspaceContextService = workspaceContextService;
    }

    @PostMapping("/context-pack")
    public ResponseEntity<ContextPackResponse> contextPack(@RequestBody(required = false) ContextPackRequest request) {
        return ResponseEntity.ok(workspaceContextService.pack(request));
    }

    @ExceptionHandler(InvalidWorkspaceContextRequestException.class)
    public ResponseEntity<Map<String, String>> handleInvalidRequest(InvalidWorkspaceContextRequestException ex) {
        return ResponseEntity.badRequest().body(Map.of("error", ex.getMessage()));
    }

    @ExceptionHandler(RuntimeException.class)
    public ResponseEntity<Map<String, String>> handleRuntime(RuntimeException ex) {
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(Map.of("error", "workspace context operation failed"));
    }
}

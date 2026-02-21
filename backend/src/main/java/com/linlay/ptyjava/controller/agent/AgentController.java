package com.linlay.ptyjava.controller.agent;

import com.linlay.ptyjava.model.agent.AbortAgentRunRequest;
import com.linlay.ptyjava.model.agent.AgentRunResponse;
import com.linlay.ptyjava.model.agent.ApproveAgentRunRequest;
import com.linlay.ptyjava.model.agent.CreateAgentRunRequest;
import com.linlay.ptyjava.service.agent.AgentOperationException;
import com.linlay.ptyjava.service.agent.AgentRunNotFoundException;
import com.linlay.ptyjava.service.agent.AgentRunService;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping({"/webapi/sessions/{sessionId}/agent", "/appapi/sessions/{sessionId}/agent"})
public class AgentController {

    private final AgentRunService agentRunService;

    public AgentController(AgentRunService agentRunService) {
        this.agentRunService = agentRunService;
    }

    @PostMapping("/runs")
    public ResponseEntity<AgentRunResponse> createRun(@PathVariable String sessionId,
                                                      @RequestBody(required = false) CreateAgentRunRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(agentRunService.createRun(sessionId, request));
    }

    @GetMapping("/runs/{runId}")
    public ResponseEntity<AgentRunResponse> getRun(@PathVariable String sessionId,
                                                   @PathVariable String runId) {
        return ResponseEntity.ok(agentRunService.getRun(sessionId, runId));
    }

    @PostMapping("/runs/{runId}/approve")
    public ResponseEntity<AgentRunResponse> approve(@PathVariable String sessionId,
                                                    @PathVariable String runId,
                                                    @RequestBody(required = false) ApproveAgentRunRequest request) {
        return ResponseEntity.ok(agentRunService.approveNextStep(sessionId, runId, request));
    }

    @PostMapping("/runs/{runId}/abort")
    public ResponseEntity<AgentRunResponse> abort(@PathVariable String sessionId,
                                                  @PathVariable String runId,
                                                  @RequestBody(required = false) AbortAgentRunRequest request) {
        return ResponseEntity.ok(agentRunService.abort(sessionId, runId, request));
    }

    @ExceptionHandler(AgentRunNotFoundException.class)
    public ResponseEntity<Map<String, String>> handleNotFound(AgentRunNotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", ex.getMessage()));
    }

    @ExceptionHandler(AgentOperationException.class)
    public ResponseEntity<Map<String, String>> handleBadRequest(AgentOperationException ex) {
        return ResponseEntity.badRequest().body(Map.of("error", ex.getMessage()));
    }

    @ExceptionHandler(RuntimeException.class)
    public ResponseEntity<Map<String, String>> handleRuntime(RuntimeException ex) {
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(Map.of("error", "agent operation failed"));
    }
}

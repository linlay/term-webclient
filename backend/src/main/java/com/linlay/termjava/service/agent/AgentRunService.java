package com.linlay.termjava.service.agent;

import com.linlay.termjava.config.TerminalProperties;
import com.linlay.termjava.model.SessionContextResponse;
import com.linlay.termjava.model.agent.AbortAgentRunRequest;
import com.linlay.termjava.model.agent.AgentRunResponse;
import com.linlay.termjava.model.agent.AgentRunStatus;
import com.linlay.termjava.model.agent.AgentStepResponse;
import com.linlay.termjava.model.agent.AgentStepStatus;
import com.linlay.termjava.model.agent.ApproveAgentRunRequest;
import com.linlay.termjava.model.agent.CreateAgentRunRequest;
import com.linlay.termjava.service.TerminalSessionService;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.springframework.stereotype.Service;

@Service
public class AgentRunService {

    private final TerminalProperties properties;
    private final TerminalSessionService terminalSessionService;
    private final AgentPlanner agentPlanner;
    private final AgentToolExecutor toolExecutor;
    private final ExecutorService stepExecutor = Executors.newCachedThreadPool(r -> {
        Thread thread = new Thread(r, "agent-step");
        thread.setDaemon(true);
        return thread;
    });

    private final ConcurrentMap<String, ConcurrentMap<String, AgentRunState>> runsBySession = new ConcurrentHashMap<>();
    private final ConcurrentMap<String, String> activeRunBySession = new ConcurrentHashMap<>();

    public AgentRunService(TerminalProperties properties,
                           TerminalSessionService terminalSessionService,
                           AgentPlanner agentPlanner,
                           AgentToolExecutor toolExecutor) {
        this.properties = properties;
        this.terminalSessionService = terminalSessionService;
        this.agentPlanner = agentPlanner;
        this.toolExecutor = toolExecutor;
    }

    public AgentRunResponse createRun(String sessionId, CreateAgentRunRequest request) {
        ensureEnabled();
        if (!terminalSessionService.exists(sessionId)) {
            throw new AgentOperationException("Session not found: " + sessionId);
        }

        String activeRunId = activeRunBySession.get(sessionId);
        if (activeRunId != null) {
            throw new AgentOperationException("Another agent run is still active for this session: " + activeRunId);
        }

        String runId = UUID.randomUUID().toString();
        String instruction = request == null || request.getInstruction() == null ? "" : request.getInstruction().trim();

        SessionContextResponse context = terminalSessionService.getContext(sessionId);
        List<PlannedAgentStep> planned = new ArrayList<>(agentPlanner.plan(instruction, context));
        if (request != null && request.getSelectedPaths() != null && !request.getSelectedPaths().isEmpty()) {
            planned.add(new PlannedAgentStep(
                "workspace.context_pack",
                "Collect selected code context",
                Map.of(
                    "paths", request.getSelectedPaths(),
                    "includeGitDiff", request.getIncludeGitDiff() == null || request.getIncludeGitDiff()
                ),
                false
            ));
        }

        if (planned.isEmpty()) {
            planned.add(new PlannedAgentStep(
                "session.get_context",
                "Refresh session context",
                Map.of("commandLimit", 100, "eventLimit", 200),
                false
            ));
        }

        AgentRunState run = new AgentRunState();
        run.runId = runId;
        run.sessionId = sessionId;
        run.instruction = instruction;
        run.createdAt = Instant.now();
        run.updatedAt = run.createdAt;
        run.status = AgentRunStatus.DRAFTED;

        for (int i = 0; i < planned.size(); i++) {
            PlannedAgentStep plannedStep = planned.get(i);
            AgentStepState step = new AgentStepState();
            step.stepIndex = i + 1;
            step.tool = plannedStep.tool();
            step.title = plannedStep.title();
            step.arguments = plannedStep.arguments() == null ? Map.of() : new HashMap<>(plannedStep.arguments());
            step.status = i == 0 ? AgentStepStatus.WAITING_APPROVAL : AgentStepStatus.PENDING;
            step.highRisk = plannedStep.highRisk();
            step.createdAt = run.createdAt;
            step.updatedAt = run.createdAt;
            run.steps.add(step);
        }

        run.status = AgentRunStatus.WAITING_APPROVAL;
        run.message = "Run drafted. Approve next step to continue.";

        runsBySession.computeIfAbsent(sessionId, key -> new ConcurrentHashMap<>()).put(runId, run);
        activeRunBySession.put(sessionId, runId);
        return toResponse(run);
    }

    public AgentRunResponse getRun(String sessionId, String runId) {
        return toResponse(getRunState(sessionId, runId));
    }

    public AgentRunResponse approveNextStep(String sessionId, String runId, ApproveAgentRunRequest request) {
        AgentRunState run = getRunState(sessionId, runId);
        synchronized (run) {
            if (isTerminalStatus(run.status)) {
                return toResponse(run);
            }

            AgentStepState step = nextAwaitingApprovalStep(run);
            if (step == null) {
                run.status = AgentRunStatus.COMPLETED;
                run.message = "No pending step left.";
                run.updatedAt = Instant.now();
                releaseActiveRun(run);
                return toResponse(run);
            }

            boolean confirmRisk = request != null && Boolean.TRUE.equals(request.getConfirmRisk());
            if (step.highRisk && !confirmRisk) {
                run.message = "High-risk step requires confirmRisk=true.";
                run.updatedAt = Instant.now();
                return toResponse(run);
            }

            step.status = AgentStepStatus.EXECUTING;
            step.updatedAt = Instant.now();
            run.status = AgentRunStatus.EXECUTING_STEP;
            run.message = "Executing step " + step.stepIndex + "...";
            run.updatedAt = Instant.now();

            Future<String> future = stepExecutor.submit(() -> toolExecutor.execute(sessionId, toPlanned(step)));
            int timeoutSeconds = Math.max(1, properties.getAgent().getStepTimeoutSeconds());

            try {
                String result = future.get(timeoutSeconds, TimeUnit.SECONDS);
                step.resultSummary = result;
                step.status = AgentStepStatus.COMPLETED;
                step.updatedAt = Instant.now();

                AgentStepState next = nextPendingStep(run);
                if (next == null) {
                    run.status = AgentRunStatus.COMPLETED;
                    run.message = "Run completed.";
                    releaseActiveRun(run);
                } else {
                    next.status = AgentStepStatus.WAITING_APPROVAL;
                    next.updatedAt = Instant.now();
                    run.status = AgentRunStatus.WAITING_APPROVAL;
                    run.message = "Step " + step.stepIndex + " completed. Approve step " + next.stepIndex + ".";
                }
                run.updatedAt = Instant.now();
                return toResponse(run);
            } catch (TimeoutException ex) {
                future.cancel(true);
                step.status = AgentStepStatus.FAILED;
                step.error = "Step timed out";
                step.updatedAt = Instant.now();
                run.status = AgentRunStatus.FAILED;
                run.message = "Step timed out.";
                run.updatedAt = Instant.now();
                releaseActiveRun(run);
                return toResponse(run);
            } catch (ExecutionException ex) {
                step.status = AgentStepStatus.FAILED;
                step.error = ex.getCause() == null ? "Step failed" : ex.getCause().getMessage();
                step.updatedAt = Instant.now();
                run.status = AgentRunStatus.FAILED;
                run.message = "Step execution failed.";
                run.updatedAt = Instant.now();
                releaseActiveRun(run);
                return toResponse(run);
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
                step.status = AgentStepStatus.FAILED;
                step.error = "Step interrupted";
                step.updatedAt = Instant.now();
                run.status = AgentRunStatus.FAILED;
                run.message = "Step interrupted.";
                run.updatedAt = Instant.now();
                releaseActiveRun(run);
                return toResponse(run);
            }
        }
    }

    public AgentRunResponse abort(String sessionId, String runId, AbortAgentRunRequest request) {
        AgentRunState run = getRunState(sessionId, runId);
        synchronized (run) {
            if (!isTerminalStatus(run.status)) {
                for (AgentStepState step : run.steps) {
                    if (step.status == AgentStepStatus.PENDING || step.status == AgentStepStatus.WAITING_APPROVAL) {
                        step.status = AgentStepStatus.SKIPPED;
                        step.updatedAt = Instant.now();
                    }
                }
                run.status = AgentRunStatus.ABORTED;
                String reason = request == null ? "" : request.getReason();
                run.message = reason == null || reason.isBlank() ? "Run aborted." : "Run aborted: " + reason;
                run.updatedAt = Instant.now();
            }
            releaseActiveRun(run);
            return toResponse(run);
        }
    }

    private PlannedAgentStep toPlanned(AgentStepState step) {
        return new PlannedAgentStep(step.tool, step.title, step.arguments, step.highRisk);
    }

    private AgentRunState getRunState(String sessionId, String runId) {
        ConcurrentMap<String, AgentRunState> sessionRuns = runsBySession.get(sessionId);
        if (sessionRuns == null) {
            throw new AgentRunNotFoundException(runId);
        }
        AgentRunState run = sessionRuns.get(runId);
        if (run == null) {
            throw new AgentRunNotFoundException(runId);
        }
        return run;
    }

    private AgentStepState nextAwaitingApprovalStep(AgentRunState run) {
        for (AgentStepState step : run.steps) {
            if (step.status == AgentStepStatus.WAITING_APPROVAL) {
                return step;
            }
        }
        return null;
    }

    private AgentStepState nextPendingStep(AgentRunState run) {
        for (AgentStepState step : run.steps) {
            if (step.status == AgentStepStatus.PENDING) {
                return step;
            }
        }
        return null;
    }

    private void ensureEnabled() {
        if (!properties.getAgent().isEnabled()) {
            throw new AgentOperationException("Agent mode is disabled");
        }
    }

    private boolean isTerminalStatus(AgentRunStatus status) {
        return status == AgentRunStatus.COMPLETED
            || status == AgentRunStatus.FAILED
            || status == AgentRunStatus.ABORTED;
    }

    private void releaseActiveRun(AgentRunState run) {
        activeRunBySession.remove(run.sessionId, run.runId);
    }

    private AgentRunResponse toResponse(AgentRunState run) {
        List<AgentStepResponse> steps = run.steps.stream()
            .map(step -> new AgentStepResponse(
                step.stepIndex,
                step.tool,
                step.title,
                step.status,
                step.highRisk,
                step.arguments,
                step.resultSummary,
                step.error,
                step.createdAt,
                step.updatedAt
            ))
            .toList();

        return new AgentRunResponse(
            run.runId,
            run.sessionId,
            run.instruction,
            run.status,
            run.message,
            run.createdAt,
            run.updatedAt,
            steps
        );
    }

    private static final class AgentRunState {
        private String runId;
        private String sessionId;
        private String instruction;
        private AgentRunStatus status;
        private String message;
        private Instant createdAt;
        private Instant updatedAt;
        private final List<AgentStepState> steps = new ArrayList<>();
    }

    private static final class AgentStepState {
        private int stepIndex;
        private String tool;
        private String title;
        private AgentStepStatus status;
        private boolean highRisk;
        private Map<String, Object> arguments;
        private String resultSummary;
        private String error;
        private Instant createdAt;
        private Instant updatedAt;
    }
}

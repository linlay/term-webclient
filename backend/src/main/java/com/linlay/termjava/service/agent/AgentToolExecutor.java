package com.linlay.termjava.service.agent;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.linlay.termjava.config.TerminalProperties;
import com.linlay.termjava.model.SessionContextResponse;
import com.linlay.termjava.model.TranscriptResponse;
import com.linlay.termjava.model.workspace.ContextPackRequest;
import com.linlay.termjava.model.workspace.ContextPackResponse;
import com.linlay.termjava.service.TerminalSessionService;
import com.linlay.termjava.service.workspace.WorkspaceContextService;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class AgentToolExecutor {

    private final TerminalSessionService terminalSessionService;
    private final WorkspaceContextService workspaceContextService;
    private final ObjectMapper objectMapper;
    private final TerminalProperties properties;

    public AgentToolExecutor(TerminalSessionService terminalSessionService,
                             WorkspaceContextService workspaceContextService,
                             ObjectMapper objectMapper,
                             TerminalProperties properties) {
        this.terminalSessionService = terminalSessionService;
        this.workspaceContextService = workspaceContextService;
        this.objectMapper = objectMapper;
        this.properties = properties;
    }

    public String execute(String sessionId, PlannedAgentStep step) {
        String tool = step.tool();
        Map<String, Object> args = step.arguments() == null ? Map.of() : step.arguments();

        return switch (tool) {
            case "session.get_context" -> executeGetContext(sessionId, args);
            case "session.get_transcript" -> executeGetTranscript(sessionId, args);
            case "terminal.execute_managed" -> executeManaged(sessionId, args);
            case "terminal.send_input" -> executeSendInput(sessionId, args);
            case "workspace.context_pack" -> executeContextPack(args);
            default -> throw new AgentOperationException("Unsupported agent tool: " + tool);
        };
    }

    private String executeGetContext(String sessionId, Map<String, Object> args) {
        int commandLimit = intArg(args, "commandLimit", 100);
        int eventLimit = intArg(args, "eventLimit", 200);
        SessionContextResponse context = terminalSessionService.getContext(sessionId, commandLimit, eventLimit);
        return summarizeJson(context);
    }

    private String executeGetTranscript(String sessionId, Map<String, Object> args) {
        long afterSeq = longArg(args, "afterSeq", 0L);
        boolean stripAnsi = boolArg(args, "stripAnsi", true);
        TranscriptResponse transcript = terminalSessionService.getTranscript(sessionId, afterSeq, stripAnsi);
        return summarizeJson(transcript);
    }

    private String executeManaged(String sessionId, Map<String, Object> args) {
        String command = strArg(args, "command", "").trim();
        if (command.isEmpty()) {
            throw new AgentOperationException("terminal.execute_managed requires non-empty command");
        }

        String commandId = "agent-" + UUID.randomUUID();
        terminalSessionService.registerManagedCommand(sessionId, commandId, command);
        terminalSessionService.writeInputFromAgent(sessionId, managedPayload(commandId, command));
        return "Managed command dispatched: " + commandId;
    }

    private String executeSendInput(String sessionId, Map<String, Object> args) {
        String data = strArg(args, "data", "");
        if (data.isEmpty()) {
            throw new AgentOperationException("terminal.send_input requires non-empty data");
        }
        terminalSessionService.writeInputFromAgent(sessionId, data);
        return "Raw input sent";
    }

    private String executeContextPack(Map<String, Object> args) {
        ContextPackRequest request = new ContextPackRequest();
        request.setPaths(listArg(args, "paths"));
        request.setIncludeGitDiff(boolArg(args, "includeGitDiff", true));
        if (args.containsKey("maxBytes")) {
            request.setMaxBytes(intArg(args, "maxBytes", properties.getAgent().getMaxContextPackBytes()));
        }

        ContextPackResponse response = workspaceContextService.pack(request);
        return summarizeJson(response);
    }

    private String managedPayload(String commandId, String command) {
        String begin = "__PTY_AGENT_BEGIN_" + commandId + "__";
        String end = "__PTY_AGENT_END_" + commandId + "__";
        return "printf '" + begin + "\\n'; "
            + command
            + "; __term_agent_code=$?; printf '"
            + end
            + ":%s\\n' \"$__term_agent_code\"\n";
    }

    private String summarizeJson(Object value) {
        try {
            String json = objectMapper.writeValueAsString(value);
            int maxChars = Math.max(1000, properties.getAgent().getMaxStepResultChars());
            if (json.length() <= maxChars) {
                return json;
            }
            return json.substring(0, maxChars) + "...(truncated)";
        } catch (JsonProcessingException e) {
            throw new AgentOperationException("Failed to serialize tool result", e);
        }
    }

    private int intArg(Map<String, Object> args, String key, int defaultValue) {
        Object value = args.get(key);
        if (value == null) {
            return defaultValue;
        }
        if (value instanceof Number number) {
            return number.intValue();
        }
        try {
            return Integer.parseInt(String.valueOf(value));
        } catch (NumberFormatException ex) {
            return defaultValue;
        }
    }

    private long longArg(Map<String, Object> args, String key, long defaultValue) {
        Object value = args.get(key);
        if (value == null) {
            return defaultValue;
        }
        if (value instanceof Number number) {
            return number.longValue();
        }
        try {
            return Long.parseLong(String.valueOf(value));
        } catch (NumberFormatException ex) {
            return defaultValue;
        }
    }

    private boolean boolArg(Map<String, Object> args, String key, boolean defaultValue) {
        Object value = args.get(key);
        if (value == null) {
            return defaultValue;
        }
        if (value instanceof Boolean bool) {
            return bool;
        }
        return "true".equalsIgnoreCase(String.valueOf(value));
    }

    private String strArg(Map<String, Object> args, String key, String defaultValue) {
        Object value = args.get(key);
        return value == null ? defaultValue : String.valueOf(value);
    }

    private List<String> listArg(Map<String, Object> args, String key) {
        Object value = args.get(key);
        if (value == null) {
            return List.of();
        }
        if (value instanceof List<?> list) {
            List<String> values = new ArrayList<>();
            for (Object item : list) {
                if (item == null) {
                    continue;
                }
                values.add(String.valueOf(item));
            }
            return values;
        }
        return List.of(String.valueOf(value));
    }
}

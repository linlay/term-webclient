package com.linlay.ptyjava.service.agent;

import com.linlay.ptyjava.model.SessionContextResponse;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class MockAgentPlanner implements AgentPlanner {

    @Override
    public List<PlannedAgentStep> plan(String instruction, SessionContextResponse context) {
        String normalizedInstruction = instruction == null ? "" : instruction.trim();
        List<PlannedAgentStep> steps = new ArrayList<>();
        long lastSeq = context == null || context.meta() == null ? 0L : context.meta().lastSeq();

        steps.add(new PlannedAgentStep(
            "session.get_context",
            "Refresh session context",
            Map.of("commandLimit", 100, "eventLimit", 200),
            false
        ));

        steps.add(new PlannedAgentStep(
            "session.get_transcript",
            "Fetch latest transcript",
            Map.of("afterSeq", Math.max(0L, lastSeq - 200L), "stripAnsi", true),
            false
        ));

        String command = extractCommandPrefix(normalizedInstruction);
        if (command != null) {
            if (!command.isEmpty()) {
                steps.add(new PlannedAgentStep(
                    "terminal.execute_managed",
                    "Execute managed command",
                    Map.of("command", command),
                    looksHighRisk(command)
                ));
            }
        } else if (normalizedInstruction.toLowerCase(Locale.ROOT).startsWith("input:")) {
            String input = normalizedInstruction.substring(6);
            if (!input.isEmpty()) {
                steps.add(new PlannedAgentStep(
                    "terminal.send_input",
                    "Send raw terminal input",
                    Map.of("data", input.endsWith("\n") ? input : input + "\n"),
                    false
                ));
            }
        }

        return steps;
    }

    private String extractCommandPrefix(String instruction) {
        String lower = instruction.toLowerCase(Locale.ROOT);
        if (lower.startsWith("cmd:")) {
            return instruction.substring(4).trim();
        }
        if (lower.startsWith("command:")) {
            return instruction.substring("command:".length()).trim();
        }
        return null;
    }

    private boolean looksHighRisk(String command) {
        String normalized = command.toLowerCase(Locale.ROOT);
        return normalized.contains("rm -rf")
            || normalized.contains("mkfs")
            || normalized.contains("shutdown")
            || normalized.contains("reboot")
            || normalized.contains("dd if=");
    }
}

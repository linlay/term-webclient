package com.linlay.termjava.service.agent;

import com.linlay.termjava.model.SessionContextResponse;
import java.util.List;

/**
 * Plans agent execution steps from a user instruction and session context.
 * <p>
 * The current implementation ({@link MockAgentPlanner}) generates deterministic steps
 * based on instruction prefixes (cmd:/command:/input:). Future implementations may
 * integrate with LLM APIs to produce dynamic, context-aware plans.
 */
public interface AgentPlanner {

    List<PlannedAgentStep> plan(String instruction, SessionContextResponse context);
}

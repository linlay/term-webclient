package com.linlay.ptyjava.service.agent;

import com.linlay.ptyjava.model.SessionContextResponse;
import java.util.List;

public interface AgentPlanner {

    List<PlannedAgentStep> plan(String instruction, SessionContextResponse context);
}

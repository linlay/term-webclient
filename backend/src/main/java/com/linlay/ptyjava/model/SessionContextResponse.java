package com.linlay.ptyjava.model;

import java.util.List;

public record SessionContextResponse(
    String sessionId,
    SessionMetaState meta,
    List<CommandFrame> commands,
    List<SessionEventView> events,
    String summary
) {
}

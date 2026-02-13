package com.linlay.ptyjava.ws;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.linlay.ptyjava.service.InvalidSessionRequestException;
import com.linlay.ptyjava.service.SessionNotFoundException;
import com.linlay.ptyjava.service.TerminalSessionService;
import java.io.IOException;
import java.util.Map;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

@Component
public class TerminalWebSocketHandler extends TextWebSocketHandler {

    private final TerminalSessionService terminalSessionService;
    private final ObjectMapper objectMapper;

    public TerminalWebSocketHandler(TerminalSessionService terminalSessionService, ObjectMapper objectMapper) {
        this.terminalSessionService = terminalSessionService;
        this.objectMapper = objectMapper;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        String sessionId = extractSessionId(session);
        try {
            terminalSessionService.attachWebSocket(sessionId, session);
        } catch (SessionNotFoundException | InvalidSessionRequestException ex) {
            sendJson(session, Map.of("type", "error", "message", ex.getMessage()));
            session.close(CloseStatus.POLICY_VIOLATION);
        }
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        String sessionId = extractSessionId(session);
        JsonNode root = objectMapper.readTree(message.getPayload());
        String type = root.path("type").asText("");

        switch (type) {
            case "input" -> terminalSessionService.writeInput(sessionId, root.path("data").asText(""));
            case "resize" -> {
                int cols = root.path("cols").asInt(-1);
                int rows = root.path("rows").asInt(-1);
                try {
                    terminalSessionService.resize(sessionId, cols, rows);
                } catch (InvalidSessionRequestException ex) {
                    sendJson(session, Map.of("type", "error", "message", ex.getMessage()));
                }
            }
            case "ping" -> sendJson(session, Map.of("type", "pong"));
            default -> sendJson(session, Map.of("type", "error", "message", "Unsupported message type"));
        }
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) throws Exception {
        String sessionId = extractSessionId(session);
        terminalSessionService.detachWebSocket(sessionId, session);
        session.close(CloseStatus.SERVER_ERROR);
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
        String sessionId = extractSessionId(session);
        terminalSessionService.detachWebSocket(sessionId, session);
    }

    private String extractSessionId(WebSocketSession session) {
        String path = session.getUri() == null ? "" : session.getUri().getPath();
        int idx = path.lastIndexOf('/');
        if (idx == -1 || idx == path.length() - 1) {
            throw new InvalidSessionRequestException("missing session id in websocket path");
        }
        return path.substring(idx + 1);
    }

    private void sendJson(WebSocketSession session, Map<String, Object> payload) throws IOException {
        if (!session.isOpen()) {
            return;
        }
        session.sendMessage(new TextMessage(objectMapper.writeValueAsString(payload)));
    }
}

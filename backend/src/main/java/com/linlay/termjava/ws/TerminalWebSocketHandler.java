package com.linlay.termjava.ws;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.linlay.termjava.service.InvalidSessionRequestException;
import com.linlay.termjava.service.SessionNotFoundException;
import com.linlay.termjava.service.TerminalSessionService;
import java.io.IOException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

@Component
public class TerminalWebSocketHandler extends TextWebSocketHandler {

    private static final String CLIENT_ID_ATTR = "terminal.clientId";

    private final TerminalSessionService terminalSessionService;
    private final ObjectMapper objectMapper;

    public TerminalWebSocketHandler(TerminalSessionService terminalSessionService, ObjectMapper objectMapper) {
        this.terminalSessionService = terminalSessionService;
        this.objectMapper = objectMapper;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        String sessionId = extractSessionId(session);
        String clientId = extractQueryParam(session, "clientId", session.getId());
        long lastSeenSeq = parseLong(extractQueryParam(session, "lastSeenSeq", "0"));

        try {
            terminalSessionService.attachWebSocket(sessionId, clientId, session, lastSeenSeq);
            session.getAttributes().put(CLIENT_ID_ATTR, clientId);
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
        terminalSessionService.detachWebSocket(sessionId, clientId(session), session);
        session.close(CloseStatus.SERVER_ERROR);
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
        String sessionId = extractSessionId(session);
        terminalSessionService.detachWebSocket(sessionId, clientId(session), session);
    }

    private String extractSessionId(WebSocketSession session) {
        String path = session.getUri() == null ? "" : session.getUri().getPath();
        int idx = path.lastIndexOf('/');
        if (idx == -1 || idx == path.length() - 1) {
            throw new InvalidSessionRequestException("missing session id in websocket path");
        }
        return path.substring(idx + 1);
    }

    private String clientId(WebSocketSession session) {
        Object value = session.getAttributes().get(CLIENT_ID_ATTR);
        return value instanceof String str && !str.isBlank() ? str : session.getId();
    }

    private String extractQueryParam(WebSocketSession session, String key, String defaultValue) {
        if (session.getUri() == null || session.getUri().getRawQuery() == null) {
            return defaultValue;
        }

        Map<String, String> params = parseQueryString(session.getUri().getRawQuery());
        return params.getOrDefault(key, defaultValue);
    }

    private Map<String, String> parseQueryString(String query) {
        Map<String, String> result = new HashMap<>();
        if (query == null || query.isBlank()) {
            return result;
        }

        String[] parts = query.split("&");
        for (String part : parts) {
            if (part == null || part.isBlank()) {
                continue;
            }
            int idx = part.indexOf('=');
            String rawKey = idx >= 0 ? part.substring(0, idx) : part;
            String rawValue = idx >= 0 ? part.substring(idx + 1) : "";
            String decodedKey = URLDecoder.decode(rawKey, StandardCharsets.UTF_8);
            String decodedValue = URLDecoder.decode(rawValue, StandardCharsets.UTF_8);
            result.put(decodedKey, decodedValue);
        }
        return result;
    }

    private long parseLong(String value) {
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException ex) {
            return 0L;
        }
    }

    private void sendJson(WebSocketSession session, Map<String, Object> payload) throws IOException {
        if (!session.isOpen()) {
            return;
        }
        session.sendMessage(new TextMessage(objectMapper.writeValueAsString(payload)));
    }
}

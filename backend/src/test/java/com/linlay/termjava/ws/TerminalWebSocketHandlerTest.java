package com.linlay.termjava.ws;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.linlay.termjava.service.InvalidSessionRequestException;
import com.linlay.termjava.service.SessionNotFoundException;
import com.linlay.termjava.service.TerminalSessionService;
import java.net.URI;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

class TerminalWebSocketHandlerTest {

    @Test
    void inputMessageIsForwardedToService() throws Exception {
        TerminalSessionService service = mock(TerminalSessionService.class);
        TerminalWebSocketHandler handler = new TerminalWebSocketHandler(service, new ObjectMapper());
        WebSocketSession session = wsSession("s1");

        handler.handleTextMessage(session, new TextMessage("{\"type\":\"input\",\"data\":\"pwd\\n\"}"));

        verify(service).writeInput("s1", "pwd\n");
    }

    @Test
    void resizeMessageIsForwardedToService() throws Exception {
        TerminalSessionService service = mock(TerminalSessionService.class);
        TerminalWebSocketHandler handler = new TerminalWebSocketHandler(service, new ObjectMapper());
        WebSocketSession session = wsSession("s1");

        handler.handleTextMessage(session, new TextMessage("{\"type\":\"resize\",\"cols\":160,\"rows\":40}"));

        verify(service).resize("s1", 160, 40);
    }

    @Test
    void unsupportedMessageReturnsError() throws Exception {
        TerminalSessionService service = mock(TerminalSessionService.class);
        TerminalWebSocketHandler handler = new TerminalWebSocketHandler(service, new ObjectMapper());
        WebSocketSession session = wsSession("s1");
        ArgumentCaptor<TextMessage> messageCaptor = ArgumentCaptor.forClass(TextMessage.class);

        handler.handleTextMessage(session, new TextMessage("{\"type\":\"unknown\"}"));

        verify(session).sendMessage(messageCaptor.capture());
        String payload = messageCaptor.getValue().getPayload();
        assertTrue(payload.contains("\"type\":\"error\""));
        assertTrue(payload.contains("Unsupported message type"));
    }

    @Test
    void resizeValidationErrorReturnsError() throws Exception {
        TerminalSessionService service = mock(TerminalSessionService.class);
        TerminalWebSocketHandler handler = new TerminalWebSocketHandler(service, new ObjectMapper());
        WebSocketSession session = wsSession("s1");
        ArgumentCaptor<TextMessage> messageCaptor = ArgumentCaptor.forClass(TextMessage.class);

        doThrow(new InvalidSessionRequestException("cols and rows must be greater than 0"))
            .when(service).resize("s1", -1, -1);

        handler.handleTextMessage(session, new TextMessage("{\"type\":\"resize\",\"cols\":-1,\"rows\":-1}"));

        verify(session).sendMessage(messageCaptor.capture());
        String payload = messageCaptor.getValue().getPayload();
        assertTrue(payload.contains("\"type\":\"error\""));
        assertTrue(payload.contains("cols and rows must be greater than 0"));
    }

    @Test
    void connectWithMissingSessionIsRejected() throws Exception {
        TerminalSessionService service = mock(TerminalSessionService.class);
        TerminalWebSocketHandler handler = new TerminalWebSocketHandler(service, new ObjectMapper());
        WebSocketSession session = wsSession("missing");

        doThrow(new SessionNotFoundException("missing"))
            .when(service).attachWebSocket(eq("missing"), any(), any(), anyLong());

        handler.afterConnectionEstablished(session);

        verify(session).close(CloseStatus.POLICY_VIOLATION);
    }

    @Test
    void connectPassesClientIdAndLastSeenSeq() throws Exception {
        TerminalSessionService service = mock(TerminalSessionService.class);
        TerminalWebSocketHandler handler = new TerminalWebSocketHandler(service, new ObjectMapper());
        WebSocketSession session = mock(WebSocketSession.class);
        when(session.getUri()).thenReturn(URI.create("ws://localhost/ws/s1?clientId=tab-1&lastSeenSeq=42"));
        when(session.getAttributes()).thenReturn(new java.util.HashMap<>());
        when(session.getId()).thenReturn("ws-1");

        handler.afterConnectionEstablished(session);

        verify(service).attachWebSocket("s1", "tab-1", session, 42L);
    }

    private WebSocketSession wsSession(String sessionId) {
        WebSocketSession session = mock(WebSocketSession.class);
        when(session.getUri()).thenReturn(URI.create("ws://localhost/ws/" + sessionId));
        when(session.isOpen()).thenReturn(true);
        when(session.getAttributes()).thenReturn(new java.util.HashMap<>());
        when(session.getId()).thenReturn("ws-" + sessionId);
        return session;
    }
}

package com.linlay.termjava.service.file;

import com.linlay.termjava.model.file.FileDownloadTicketMode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class DownloadTicketService {

    private final ConcurrentMap<String, DownloadTicketPayload> tickets = new ConcurrentHashMap<>();

    public IssuedDownloadTicket issue(FileDownloadTicketMode mode,
                                      String sessionId,
                                      String actor,
                                      String path,
                                      List<String> paths,
                                      String archiveName,
                                      int ttlSeconds) {
        if (!StringUtils.hasText(sessionId)) {
            throw new IllegalArgumentException("sessionId is required");
        }
        if (mode == null) {
            throw new IllegalArgumentException("mode is required");
        }

        cleanupExpired();

        Instant expiresAt = Instant.now().plusSeconds(Math.max(1, ttlSeconds));
        String ticket = UUID.randomUUID().toString().replace("-", "");
        DownloadTicketPayload payload = new DownloadTicketPayload(
            ticket,
            mode,
            sessionId,
            StringUtils.hasText(actor) ? actor.trim() : "anonymous",
            StringUtils.hasText(path) ? path.trim() : null,
            sanitizePaths(paths),
            StringUtils.hasText(archiveName) ? archiveName.trim() : null,
            expiresAt
        );
        tickets.put(ticket, payload);
        return new IssuedDownloadTicket(ticket, expiresAt);
    }

    public DownloadTicketPayload consume(String ticket,
                                         String expectedSessionId,
                                         FileDownloadTicketMode expectedMode,
                                         String actor) {
        if (!StringUtils.hasText(ticket)) {
            throw new FileTransferForbiddenException("download ticket is required");
        }
        DownloadTicketPayload payload = tickets.remove(ticket.trim());
        if (payload == null) {
            throw new FileTransferForbiddenException("download ticket is invalid or already consumed");
        }
        if (payload.expiresAt().isBefore(Instant.now())) {
            throw new FileTransferForbiddenException("download ticket expired");
        }
        if (!payload.sessionId().equals(expectedSessionId)) {
            throw new FileTransferForbiddenException("download ticket session mismatch");
        }
        if (payload.mode() != expectedMode) {
            throw new FileTransferForbiddenException("download ticket mode mismatch");
        }
        if (StringUtils.hasText(actor) && !payload.actor().equals(actor.trim())) {
            throw new FileTransferForbiddenException("download ticket actor mismatch");
        }
        return payload;
    }

    private void cleanupExpired() {
        Instant now = Instant.now();
        for (Map.Entry<String, DownloadTicketPayload> entry : tickets.entrySet()) {
            DownloadTicketPayload payload = entry.getValue();
            if (payload == null || payload.expiresAt().isBefore(now)) {
                tickets.remove(entry.getKey(), payload);
            }
        }
    }

    private List<String> sanitizePaths(List<String> paths) {
        if (paths == null || paths.isEmpty()) {
            return List.of();
        }
        List<String> cleaned = new ArrayList<>();
        for (String path : paths) {
            if (!StringUtils.hasText(path)) {
                continue;
            }
            cleaned.add(path.trim());
        }
        return List.copyOf(cleaned);
    }

    public record IssuedDownloadTicket(String ticket, Instant expiresAt) {
    }

    public record DownloadTicketPayload(String ticket,
                                        FileDownloadTicketMode mode,
                                        String sessionId,
                                        String actor,
                                        String path,
                                        List<String> paths,
                                        String archiveName,
                                        Instant expiresAt) {
    }
}

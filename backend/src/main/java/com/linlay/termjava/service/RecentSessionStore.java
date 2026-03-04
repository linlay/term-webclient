package com.linlay.termjava.service;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.linlay.termjava.config.TerminalProperties;
import com.linlay.termjava.model.CreateSessionRequest;
import com.linlay.termjava.model.SessionType;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.concurrent.locks.ReentrantLock;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class RecentSessionStore {

    private static final int FILE_VERSION = 1;

    private final TerminalProperties properties;
    private final ObjectMapper objectMapper;
    private final ReentrantLock lock = new ReentrantLock();

    public RecentSessionStore(TerminalProperties properties, ObjectMapper objectMapper) {
        this.properties = properties;
        this.objectMapper = objectMapper;
    }

    public void record(String toolId,
                       String title,
                       SessionType sessionType,
                       String workdir,
                       CreateSessionRequest request) {
        if (request == null) {
            return;
        }
        String normalizedToolId = normalizeToolId(toolId);
        String fingerprint = fingerprint(request);
        Instant now = Instant.now();

        lock.lock();
        try {
            RecentSessionFile file = loadFile();
            List<StoredRecentSessionRecord> records = recordsByTool(file).computeIfAbsent(normalizedToolId, ignored -> new ArrayList<>());
            records.removeIf(item -> fingerprint.equals(item.fingerprint));
            records.add(0, toStoredRecord(fingerprint, normalizedToolId, title, sessionType, workdir, now, request));
            trimToLimit(records);
            persist(file);
        } finally {
            lock.unlock();
        }
    }

    public List<RecentSessionRecord> listByTool(String toolId) {
        String normalizedToolId = normalizeToolId(toolId);
        lock.lock();
        try {
            RecentSessionFile file = loadFile();
            List<StoredRecentSessionRecord> records = recordsByTool(file).getOrDefault(normalizedToolId, List.of());
            List<RecentSessionRecord> result = new ArrayList<>(records.size());
            for (StoredRecentSessionRecord item : records) {
                result.add(toRecord(item));
            }
            return result;
        } finally {
            lock.unlock();
        }
    }

    public void replaceToolRecords(String toolId, List<RecentSessionRecord> records) {
        String normalizedToolId = normalizeToolId(toolId);
        List<RecentSessionRecord> safeRecords = records == null ? List.of() : records;

        lock.lock();
        try {
            RecentSessionFile file = loadFile();
            Map<String, List<StoredRecentSessionRecord>> byTool = recordsByTool(file);
            if (safeRecords.isEmpty()) {
                byTool.remove(normalizedToolId);
                persist(file);
                return;
            }

            List<StoredRecentSessionRecord> next = new ArrayList<>();
            for (RecentSessionRecord record : safeRecords) {
                if (record == null || record.request() == null) {
                    continue;
                }
                String fingerprint = StringUtils.hasText(record.fingerprint())
                    ? record.fingerprint().trim()
                    : fingerprint(record.request());
                Instant lastUsedAt = record.lastUsedAt() == null ? Instant.now() : record.lastUsedAt();
                next.add(toStoredRecord(
                    fingerprint,
                    normalizedToolId,
                    record.title(),
                    record.sessionType(),
                    record.workdir(),
                    lastUsedAt,
                    record.request()
                ));
            }
            trimToLimit(next);
            byTool.put(normalizedToolId, next);
            persist(file);
        } finally {
            lock.unlock();
        }
    }

    private String normalizeToolId(String raw) {
        if (!StringUtils.hasText(raw)) {
            return "terminal";
        }
        return raw.trim();
    }

    private String fingerprint(CreateSessionRequest request) {
        try {
            byte[] payload = objectMapper.writeValueAsBytes(request);
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(payload));
        } catch (IOException | NoSuchAlgorithmException e) {
            throw new RuntimeException("Failed to fingerprint recent session request", e);
        }
    }

    private void trimToLimit(List<StoredRecentSessionRecord> records) {
        int max = Math.max(1, properties.getRecentSessionsPerTool());
        if (records.size() <= max) {
            return;
        }
        records.subList(max, records.size()).clear();
    }

    private StoredRecentSessionRecord toStoredRecord(String fingerprint,
                                                     String toolId,
                                                     String title,
                                                     SessionType sessionType,
                                                     String workdir,
                                                     Instant lastUsedAt,
                                                     CreateSessionRequest request) {
        StoredRecentSessionRecord stored = new StoredRecentSessionRecord();
        stored.fingerprint = fingerprint;
        stored.toolId = toolId;
        stored.title = StringUtils.hasText(title) ? title.trim() : toolId;
        stored.sessionType = sessionType == null ? SessionType.LOCAL_PTY : sessionType;
        stored.workdir = StringUtils.hasText(workdir) ? workdir.trim() : ".";
        stored.lastUsedAt = lastUsedAt;
        stored.request = cloneRequest(request);
        return stored;
    }

    private RecentSessionRecord toRecord(StoredRecentSessionRecord stored) {
        SessionType sessionType = stored.sessionType == null ? SessionType.LOCAL_PTY : stored.sessionType;
        String toolId = normalizeToolId(stored.toolId);
        String title = StringUtils.hasText(stored.title) ? stored.title.trim() : toolId;
        String workdir = StringUtils.hasText(stored.workdir) ? stored.workdir.trim() : ".";
        Instant lastUsedAt = stored.lastUsedAt == null ? Instant.EPOCH : stored.lastUsedAt;
        if (stored.request == null) {
            return new RecentSessionRecord(
                StringUtils.hasText(stored.fingerprint) ? stored.fingerprint.trim() : "",
                toolId,
                title,
                sessionType,
                workdir,
                lastUsedAt,
                null
            );
        }
        return new RecentSessionRecord(
            StringUtils.hasText(stored.fingerprint) ? stored.fingerprint.trim() : fingerprint(stored.request),
            toolId,
            title,
            sessionType,
            workdir,
            lastUsedAt,
            cloneRequest(stored.request)
        );
    }

    private CreateSessionRequest cloneRequest(CreateSessionRequest request) {
        if (request == null) {
            return null;
        }
        return objectMapper.convertValue(request, CreateSessionRequest.class);
    }

    private RecentSessionFile loadFile() {
        Path path = recentSessionFilePath();
        if (!Files.exists(path)) {
            return new RecentSessionFile();
        }
        try {
            String text = Files.readString(path, StandardCharsets.UTF_8);
            if (!StringUtils.hasText(text)) {
                return new RecentSessionFile();
            }
            RecentSessionFile file = objectMapper.readValue(text, RecentSessionFile.class);
            if (file.recordsByTool == null) {
                file.recordsByTool = new HashMap<>();
            }
            return file;
        } catch (IOException e) {
            throw new RuntimeException("Failed to read recent sessions file", e);
        }
    }

    private void persist(RecentSessionFile file) {
        Path path = recentSessionFilePath();
        try {
            if (path.getParent() != null) {
                Files.createDirectories(path.getParent());
            }
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(path.toFile(), file);
        } catch (IOException e) {
            throw new RuntimeException("Failed to persist recent sessions file", e);
        }
    }

    private Path recentSessionFilePath() {
        String configured = properties.getRecentSessionsFile();
        if (StringUtils.hasText(configured)) {
            return Path.of(configured.trim());
        }
        return Path.of("data/recent-sessions.json");
    }

    private Map<String, List<StoredRecentSessionRecord>> recordsByTool(RecentSessionFile file) {
        if (file.recordsByTool == null) {
            file.recordsByTool = new HashMap<>();
        }
        return file.recordsByTool;
    }

    public record RecentSessionRecord(
        String fingerprint,
        String toolId,
        String title,
        SessionType sessionType,
        String workdir,
        Instant lastUsedAt,
        CreateSessionRequest request
    ) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private static class RecentSessionFile {
        public int version = FILE_VERSION;
        public Map<String, List<StoredRecentSessionRecord>> recordsByTool = new HashMap<>();
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private static class StoredRecentSessionRecord {
        public String fingerprint;
        public String toolId;
        public String title;
        public SessionType sessionType;
        public String workdir;
        public Instant lastUsedAt;
        public CreateSessionRequest request;
    }
}

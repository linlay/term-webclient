package com.linlay.termjava.service.file;

import com.linlay.termjava.config.TerminalProperties;
import com.linlay.termjava.model.FileSessionBinding;
import com.linlay.termjava.model.SessionType;
import com.linlay.termjava.model.TerminalSession;
import com.linlay.termjava.model.file.FileDownloadArchiveRequest;
import com.linlay.termjava.model.file.FileDownloadTicketMode;
import com.linlay.termjava.model.file.FileDownloadTicketRequest;
import com.linlay.termjava.model.file.FileDownloadTicketResponse;
import com.linlay.termjava.model.file.FileMkdirResponse;
import com.linlay.termjava.model.file.FileTreeResponse;
import com.linlay.termjava.model.file.FileUploadItemResponse;
import com.linlay.termjava.model.file.FileUploadResponse;
import com.linlay.termjava.model.file.UploadConflictPolicy;
import com.linlay.termjava.service.TerminalSessionService;
import com.linlay.termjava.service.ssh.SshConnectionPool;
import com.linlay.termjava.service.ssh.SshCredentialStore;
import io.micrometer.core.instrument.MeterRegistry;
import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

@Service
public class FileTransferService {

    private static final Logger log = LoggerFactory.getLogger(FileTransferService.class);

    private final TerminalProperties terminalProperties;
    private final TerminalSessionService terminalSessionService;
    private final SshConnectionPool sshConnectionPool;
    private final SshCredentialStore sshCredentialStore;
    private final DownloadTicketService downloadTicketService;
    private final MeterRegistry meterRegistry;

    public FileTransferService(TerminalProperties terminalProperties,
                               TerminalSessionService terminalSessionService,
                               SshConnectionPool sshConnectionPool,
                               SshCredentialStore sshCredentialStore,
                               DownloadTicketService downloadTicketService,
                               ObjectProvider<MeterRegistry> meterRegistryProvider) {
        this.terminalProperties = terminalProperties;
        this.terminalSessionService = terminalSessionService;
        this.sshConnectionPool = sshConnectionPool;
        this.sshCredentialStore = sshCredentialStore;
        this.downloadTicketService = downloadTicketService;
        this.meterRegistry = meterRegistryProvider.getIfAvailable();
    }

    public FileTreeResponse tree(String actor, String sessionId, String path) {
        return record("tree", actor, sessionId, path, 0L, () -> resolveGateway(sessionId).tree(path));
    }

    public FileMkdirResponse mkdir(String actor, String sessionId, String parentPath, String name) {
        return record("mkdir", actor, sessionId, parentPath, 0L, () -> resolveGateway(sessionId).mkdir(parentPath, name));
    }

    public FileUploadResponse upload(String actor,
                                     String sessionId,
                                     String targetPath,
                                     UploadConflictPolicy conflictPolicy,
                                     List<MultipartFile> files) {
        ensureEnabled();
        if (files == null || files.isEmpty()) {
            throw new FileTransferBadRequestException("files must not be empty");
        }

        long maxUploadFileBytes = Math.max(1L, terminalProperties.getFiles().getMaxUploadFileBytes());
        long maxUploadRequestBytes = Math.max(maxUploadFileBytes, terminalProperties.getFiles().getMaxUploadRequestBytes());
        long declaredRequestBytes = files.stream().mapToLong(file -> Math.max(0L, file.getSize())).sum();
        if (declaredRequestBytes > maxUploadRequestBytes) {
            throw new FileTransferPayloadTooLargeException("upload request exceeds maxUploadRequestBytes");
        }

        FileGateway gateway = resolveGateway(sessionId);
        List<FileUploadItemResponse> results = new ArrayList<>();
        for (MultipartFile file : files) {
            String fileName = file == null ? "" : file.getOriginalFilename();
            long fileSize = file == null ? 0L : Math.max(0L, file.getSize());
            if (file == null || file.isEmpty() || !StringUtils.hasText(fileName)) {
                results.add(new FileUploadItemResponse(fileName, "FAILED", null, fileSize, "file is empty"));
                continue;
            }
            if (fileSize > maxUploadFileBytes) {
                results.add(new FileUploadItemResponse(fileName, "FAILED", null, fileSize, "file exceeds maxUploadFileBytes"));
                continue;
            }

            long startedAt = System.nanoTime();
            try (var inputStream = file.getInputStream()) {
                FileUploadItemResponse response = gateway.upload(targetPath, fileName, inputStream, fileSize, conflictPolicy);
                results.add(response);
                audit("upload", actor, sessionId, targetPath, fileSize, "success", startedAt, null);
            } catch (Exception ex) {
                results.add(new FileUploadItemResponse(fileName, "FAILED", null, fileSize, ex.getMessage()));
                audit("upload", actor, sessionId, targetPath, fileSize, "failed", startedAt, ex);
            }
        }

        return new FileUploadResponse(results);
    }

    public FileDownloadHandle openDownload(String actor, String sessionId, String path) {
        return record("download", actor, sessionId, path, 0L, () -> resolveGateway(sessionId).openDownload(path));
    }

    public ArchivePlan planArchive(String actor, String sessionId, List<String> paths) {
        ArchivePlan plan = record("download_archive", actor, sessionId, String.valueOf(paths), 0L,
            () -> resolveGateway(sessionId).planArchive(paths));
        long maxArchiveBytes = Math.max(1L, terminalProperties.getFiles().getMaxDownloadArchiveBytes());
        if (plan.totalBytes() > maxArchiveBytes) {
            throw new FileTransferPayloadTooLargeException("archive exceeds maxDownloadArchiveBytes");
        }
        return plan;
    }

    public FileDownloadTicketResponse createDownloadTicket(String actor,
                                                           String sessionId,
                                                           FileDownloadTicketRequest request,
                                                           String apiPrefix) {
        ensureEnabled();
        if (request == null) {
            throw new FileTransferBadRequestException("request must not be null");
        }

        FileDownloadTicketMode mode;
        try {
            mode = FileDownloadTicketMode.fromValue(request.getMode());
        } catch (IllegalArgumentException ex) {
            throw new FileTransferBadRequestException(ex.getMessage(), ex);
        }

        if (mode == FileDownloadTicketMode.SINGLE && !StringUtils.hasText(request.getPath())) {
            throw new FileTransferBadRequestException("path is required for single mode");
        }
        if (mode == FileDownloadTicketMode.ARCHIVE && (request.getPaths() == null || request.getPaths().isEmpty())) {
            throw new FileTransferBadRequestException("paths are required for archive mode");
        }

        int ttl = terminalProperties.getFiles() == null
            ? 60
            : Math.max(1, terminalProperties.getFiles().getDownloadTicketTtlSeconds());
        DownloadTicketService.IssuedDownloadTicket issued = downloadTicketService.issue(
            mode,
            sessionId,
            actor,
            request.getPath(),
            request.getPaths(),
            request.getArchiveName(),
            ttl
        );

        String normalizedApiPrefix = StringUtils.hasText(apiPrefix) ? apiPrefix.trim() : "";
        String downloadUrl;
        if (mode == FileDownloadTicketMode.SINGLE) {
            downloadUrl = normalizedApiPrefix + "/sessions/" + sessionId + "/files/download?ticket=" + issued.ticket();
        } else {
            downloadUrl = normalizedApiPrefix + "/sessions/" + sessionId + "/files/download-archive?ticket=" + issued.ticket();
        }

        return new FileDownloadTicketResponse(issued.ticket(), downloadUrl, issued.expiresAt());
    }

    public DownloadTicketService.DownloadTicketPayload consumeSingleDownloadTicket(String actor,
                                                                                   String sessionId,
                                                                                   String ticket) {
        return downloadTicketService.consume(ticket, sessionId, FileDownloadTicketMode.SINGLE, actor);
    }

    public DownloadTicketService.DownloadTicketPayload consumeArchiveDownloadTicket(String actor,
                                                                                    String sessionId,
                                                                                    String ticket) {
        return downloadTicketService.consume(ticket, sessionId, FileDownloadTicketMode.ARCHIVE, actor);
    }

    public List<String> resolveArchivePaths(FileDownloadArchiveRequest request,
                                            DownloadTicketService.DownloadTicketPayload payload) {
        if (payload != null) {
            return payload.paths();
        }
        if (request == null || request.getPaths() == null || request.getPaths().isEmpty()) {
            throw new FileTransferBadRequestException("paths must not be empty");
        }
        return request.getPaths();
    }

    public String resolveArchiveName(FileDownloadArchiveRequest request,
                                     DownloadTicketService.DownloadTicketPayload payload) {
        String archiveName = payload != null ? payload.archiveName() : (request == null ? null : request.getArchiveName());
        if (!StringUtils.hasText(archiveName)) {
            archiveName = "download.zip";
        }
        archiveName = archiveName.trim();
        if (!archiveName.toLowerCase().endsWith(".zip")) {
            archiveName += ".zip";
        }
        return archiveName;
    }

    public String resolveDownloadPath(String requestPath,
                                      DownloadTicketService.DownloadTicketPayload payload) {
        if (payload != null) {
            return payload.path();
        }
        if (!StringUtils.hasText(requestPath)) {
            throw new FileTransferBadRequestException("path is required");
        }
        return requestPath.trim();
    }

    private FileGateway resolveGateway(String sessionId) {
        ensureEnabled();
        TerminalSession session = terminalSessionService.getRequiredSession(sessionId);
        FileSessionBinding binding = session.getFileSessionBinding();
        if (binding == null || !StringUtils.hasText(binding.rootPath())) {
            throw new FileTransferBadRequestException("session does not have file binding");
        }

        if (binding.sessionType() == null || binding.sessionType() == com.linlay.termjava.model.SessionType.LOCAL_PTY) {
            return new LocalFileGateway(binding.rootPath());
        }

        if (binding.ssh() == null) {
            throw new FileTransferBadRequestException("session is missing ssh file binding");
        }
        return new SftpFileGateway(sshConnectionPool, sshCredentialStore, binding.ssh(), binding.rootPath());
    }

    private void ensureEnabled() {
        if (terminalProperties.getFiles() == null || !terminalProperties.getFiles().isEnabled()) {
            throw new FileTransferForbiddenException("file transfer is disabled");
        }
    }

    private <T> T record(String op,
                         String actor,
                         String sessionId,
                         String path,
                         long size,
                         IOCallable<T> callable) {
        long startedAt = System.nanoTime();
        try {
            T value = callable.call();
            audit(op, actor, sessionId, path, size, "success", startedAt, null);
            return value;
        } catch (RuntimeException | IOException ex) {
            audit(op, actor, sessionId, path, size, "failed", startedAt, ex);
            if (ex instanceof RuntimeException runtimeException) {
                throw runtimeException;
            }
            throw new FileTransferBadRequestException("file transfer operation failed", ex);
        }
    }

    private void audit(String op,
                       String actor,
                       String sessionId,
                       String path,
                       long size,
                       String result,
                       long startedAt,
                       Exception ex) {
        long costMs = Duration.ofNanos(System.nanoTime() - startedAt).toMillis();
        String who = StringUtils.hasText(actor) ? actor.trim() : "anonymous";
        String sessionType = resolveSessionType(sessionId);
        if (ex == null) {
            log.info("file_transfer who={} sessionId={} sessionType={} op={} path={} size={} result={} costMs={}",
                who, sessionId, sessionType, op, path, size, result, costMs);
        } else {
            log.warn("file_transfer who={} sessionId={} sessionType={} op={} path={} size={} result={} costMs={} err={}",
                who, sessionId, sessionType, op, path, size, result, costMs, ex.getMessage());
        }

        if (meterRegistry != null) {
            meterRegistry.counter("terminal.files.operations",
                "op", op,
                "result", result,
                "sessionType", sessionType
            ).increment();
            meterRegistry.timer("terminal.files.duration",
                "op", op,
                "result", result,
                "sessionType", sessionType
            )
                .record(Duration.ofMillis(costMs));
        }
    }

    private String resolveSessionType(String sessionId) {
        if (!StringUtils.hasText(sessionId)) {
            return "UNKNOWN";
        }
        try {
            TerminalSession session = terminalSessionService.getRequiredSession(sessionId);
            SessionType type = session.getSessionType();
            return type == null ? "UNKNOWN" : type.name();
        } catch (RuntimeException ignored) {
            return "UNKNOWN";
        }
    }

    @FunctionalInterface
    private interface IOCallable<T> {
        T call() throws IOException;
    }
}

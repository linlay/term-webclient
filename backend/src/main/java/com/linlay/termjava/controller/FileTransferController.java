package com.linlay.termjava.controller;

import com.linlay.termjava.model.file.FileDownloadArchiveRequest;
import com.linlay.termjava.model.file.FileDownloadTicketRequest;
import com.linlay.termjava.model.file.FileDownloadTicketResponse;
import com.linlay.termjava.model.file.FileMkdirRequest;
import com.linlay.termjava.model.file.FileMkdirResponse;
import com.linlay.termjava.model.file.FileTreeResponse;
import com.linlay.termjava.model.file.FileUploadResponse;
import com.linlay.termjava.model.file.UploadConflictPolicy;
import com.linlay.termjava.service.file.ArchiveEntrySource;
import com.linlay.termjava.service.file.ArchivePlan;
import com.linlay.termjava.service.file.DownloadTicketService;
import com.linlay.termjava.service.file.FileDownloadHandle;
import com.linlay.termjava.service.file.FileTransferBadRequestException;
import com.linlay.termjava.service.file.FileTransferForbiddenException;
import com.linlay.termjava.service.file.FileTransferNotFoundException;
import com.linlay.termjava.service.file.FileTransferPayloadTooLargeException;
import com.linlay.termjava.service.file.FileTransferService;
import com.linlay.termjava.service.file.RequestActorResolver;
import jakarta.servlet.http.HttpServletRequest;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.InputStreamResource;
import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

@RestController
@RequestMapping({"/webapi/sessions/{sessionId}/files", "/appapi/sessions/{sessionId}/files"})
public class FileTransferController {

    private static final Logger log = LoggerFactory.getLogger(FileTransferController.class);

    private final FileTransferService fileTransferService;
    private final RequestActorResolver requestActorResolver;

    public FileTransferController(FileTransferService fileTransferService,
                                  RequestActorResolver requestActorResolver) {
        this.fileTransferService = fileTransferService;
        this.requestActorResolver = requestActorResolver;
    }

    @GetMapping("/tree")
    public ResponseEntity<FileTreeResponse> tree(@PathVariable String sessionId,
                                                 @RequestParam(required = false) String path,
                                                 HttpServletRequest request) {
        String actor = requestActorResolver.resolve(request);
        return ResponseEntity.ok(fileTransferService.tree(actor, sessionId, path));
    }

    @PostMapping(value = "/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<FileUploadResponse> upload(@PathVariable String sessionId,
                                                     @RequestParam(required = false) String targetPath,
                                                     @RequestParam(required = false) String conflictPolicy,
                                                     @RequestParam("files") MultipartFile[] files,
                                                     HttpServletRequest request) {
        UploadConflictPolicy policy;
        try {
            policy = UploadConflictPolicy.fromValue(conflictPolicy);
        } catch (IllegalArgumentException ex) {
            throw new FileTransferBadRequestException(ex.getMessage(), ex);
        }

        String actor = requestActorResolver.resolve(request);
        List<MultipartFile> fileList = files == null ? List.of() : List.of(files);
        return ResponseEntity.ok(fileTransferService.upload(actor, sessionId, targetPath, policy, fileList));
    }

    @RequestMapping(value = "/download", method = RequestMethod.HEAD)
    public ResponseEntity<Void> headDownload(@PathVariable String sessionId,
                                             @RequestParam(required = false) String path,
                                             @RequestParam(required = false) String ticket,
                                             HttpServletRequest request) {
        String actor = requestActorResolver.resolveAuthenticated(request);
        DownloadTicketService.DownloadTicketPayload payload = null;
        if (StringUtils.hasText(ticket)) {
            payload = fileTransferService.consumeSingleDownloadTicket(actor, sessionId, ticket);
        }
        String resolvedPath = fileTransferService.resolveDownloadPath(path, payload);

        try (FileDownloadHandle handle = fileTransferService.openDownload(actor, sessionId, resolvedPath)) {
            HttpHeaders headers = downloadHeaders(handle.fileName(), handle.size());
            return ResponseEntity.ok().headers(headers).build();
        }
    }

    @GetMapping("/download")
    public ResponseEntity<Resource> download(@PathVariable String sessionId,
                                             @RequestParam(required = false) String path,
                                             @RequestParam(required = false) String ticket,
                                             HttpServletRequest request) throws IOException {
        String actor = requestActorResolver.resolveAuthenticated(request);
        DownloadTicketService.DownloadTicketPayload payload = null;
        if (StringUtils.hasText(ticket)) {
            payload = fileTransferService.consumeSingleDownloadTicket(actor, sessionId, ticket);
        }
        String resolvedPath = fileTransferService.resolveDownloadPath(path, payload);

        FileDownloadHandle handle = fileTransferService.openDownload(actor, sessionId, resolvedPath);
        HttpHeaders headers = downloadHeaders(handle.fileName(), handle.size());
        return ResponseEntity.ok()
            .headers(headers)
            .body(new InputStreamResource(new ManagedHandleInputStream(handle)));
    }

    @PostMapping(value = "/download-archive", produces = "application/zip")
    public ResponseEntity<StreamingResponseBody> downloadArchive(@PathVariable String sessionId,
                                                                 @RequestBody FileDownloadArchiveRequest request,
                                                                 HttpServletRequest httpServletRequest) {
        String actor = requestActorResolver.resolve(httpServletRequest);
        List<String> paths = fileTransferService.resolveArchivePaths(request, null);
        String archiveName = fileTransferService.resolveArchiveName(request, null);
        return archiveResponse(actor, sessionId, paths, archiveName);
    }

    @GetMapping(value = "/download-archive", produces = "application/zip")
    public ResponseEntity<StreamingResponseBody> downloadArchiveByTicket(@PathVariable String sessionId,
                                                                         @RequestParam String ticket,
                                                                         HttpServletRequest request) {
        String actor = requestActorResolver.resolveAuthenticated(request);
        DownloadTicketService.DownloadTicketPayload payload = fileTransferService.consumeArchiveDownloadTicket(actor, sessionId, ticket);
        List<String> paths = fileTransferService.resolveArchivePaths(null, payload);
        String archiveName = fileTransferService.resolveArchiveName(null, payload);
        return archiveResponse(actor, sessionId, paths, archiveName);
    }

    @PostMapping("/mkdir")
    public ResponseEntity<FileMkdirResponse> mkdir(@PathVariable String sessionId,
                                                   @RequestBody FileMkdirRequest request,
                                                   HttpServletRequest httpServletRequest) {
        String actor = requestActorResolver.resolve(httpServletRequest);
        if (request == null) {
            throw new FileTransferBadRequestException("request must not be null");
        }
        return ResponseEntity.ok(fileTransferService.mkdir(actor, sessionId, request.getParentPath(), request.getName()));
    }

    @PostMapping("/download-ticket")
    public ResponseEntity<FileDownloadTicketResponse> createDownloadTicket(@PathVariable String sessionId,
                                                                           @RequestBody FileDownloadTicketRequest request,
                                                                           HttpServletRequest httpServletRequest) {
        String actor = requestActorResolver.resolve(httpServletRequest);
        String apiPrefix = httpServletRequest.getRequestURI().startsWith("/appapi/") ? "/appterm/api" : "/term/api";
        FileDownloadTicketResponse response = fileTransferService.createDownloadTicket(actor, sessionId, request, apiPrefix);
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    private ResponseEntity<StreamingResponseBody> archiveResponse(String actor,
                                                                  String sessionId,
                                                                  List<String> paths,
                                                                  String archiveName) {
        ArchivePlan plan = fileTransferService.planArchive(actor, sessionId, paths);
        StreamingResponseBody body = outputStream -> {
            try (ZipOutputStream zipOutputStream = new ZipOutputStream(outputStream)) {
                for (ArchiveEntrySource entry : plan.entries()) {
                    ZipEntry zipEntry = new ZipEntry(entry.archivePath());
                    zipOutputStream.putNextEntry(zipEntry);
                    try (InputStream inputStream = entry.openStream().get()) {
                        inputStream.transferTo(zipOutputStream);
                    }
                    zipOutputStream.closeEntry();
                }
                zipOutputStream.finish();
            }
        };

        HttpHeaders headers = downloadHeaders(archiveName, plan.totalBytes());
        headers.setContentType(MediaType.parseMediaType("application/zip"));
        return ResponseEntity.ok().headers(headers).body(body);
    }

    private HttpHeaders downloadHeaders(String fileName, long size) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentDisposition(ContentDisposition.attachment().filename(fileName).build());
        if (size >= 0) {
            headers.setContentLength(size);
        }
        headers.set(HttpHeaders.CACHE_CONTROL, "no-store");
        headers.set("X-Generated-At", Instant.now().toString());
        return headers;
    }

    private static final class ManagedHandleInputStream extends FilterInputStream {

        private final FileDownloadHandle handle;

        private ManagedHandleInputStream(FileDownloadHandle handle) {
            super(handle.inputStream());
            this.handle = handle;
        }

        @Override
        public void close() throws IOException {
            IOException failure = null;
            try {
                super.close();
            } catch (IOException ex) {
                failure = ex;
            }
            try {
                handle.close();
            } catch (Exception ex) {
                if (failure == null && ex instanceof IOException ioException) {
                    failure = ioException;
                }
            }
            if (failure != null) {
                throw failure;
            }
        }
    }

    @ExceptionHandler(FileTransferBadRequestException.class)
    public ResponseEntity<Map<String, String>> handleBadRequest(FileTransferBadRequestException ex) {
        return ResponseEntity.badRequest().body(Map.of("error", ex.getMessage()));
    }

    @ExceptionHandler(FileTransferForbiddenException.class)
    public ResponseEntity<Map<String, String>> handleForbidden(FileTransferForbiddenException ex) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", ex.getMessage()));
    }

    @ExceptionHandler(FileTransferNotFoundException.class)
    public ResponseEntity<Map<String, String>> handleNotFound(FileTransferNotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", ex.getMessage()));
    }

    @ExceptionHandler(FileTransferPayloadTooLargeException.class)
    public ResponseEntity<Map<String, String>> handlePayloadTooLarge(FileTransferPayloadTooLargeException ex) {
        return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).body(Map.of("error", ex.getMessage()));
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<Map<String, String>> handleMaxUploadSizeExceeded(MaxUploadSizeExceededException ex) {
        return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE)
            .body(Map.of("error", "upload request exceeds maxUploadRequestBytes"));
    }

    @ExceptionHandler(RuntimeException.class)
    public ResponseEntity<Map<String, String>> handleRuntime(RuntimeException ex) {
        log.error("File transfer operation failed", ex);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(Map.of("error", "file transfer operation failed"));
    }
}

package com.linlay.termjava.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.head;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.linlay.termjava.config.TerminalProperties;
import com.linlay.termjava.model.file.FileDownloadArchiveRequest;
import com.linlay.termjava.model.file.FileDownloadTicketResponse;
import com.linlay.termjava.model.file.FileEntryType;
import com.linlay.termjava.model.file.FileMkdirResponse;
import com.linlay.termjava.model.file.FileTreeEntryResponse;
import com.linlay.termjava.model.file.FileTreeResponse;
import com.linlay.termjava.model.file.FileUploadItemResponse;
import com.linlay.termjava.model.file.FileUploadResponse;
import com.linlay.termjava.service.file.DownloadTicketService;
import com.linlay.termjava.service.file.FileDownloadHandle;
import com.linlay.termjava.service.file.FileTransferBadRequestException;
import com.linlay.termjava.service.file.FileTransferForbiddenException;
import com.linlay.termjava.service.file.FileTransferNotFoundException;
import com.linlay.termjava.service.file.FileTransferPayloadTooLargeException;
import com.linlay.termjava.service.file.FileTransferService;
import com.linlay.termjava.service.file.RequestActorResolver;
import java.io.ByteArrayInputStream;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(FileTransferController.class)
class FileTransferControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private FileTransferService fileTransferService;

    @MockBean
    private RequestActorResolver requestActorResolver;

    @MockBean
    private TerminalProperties terminalProperties;

    @Test
    void treeReturnsEntries() throws Exception {
        when(requestActorResolver.resolve(any())).thenReturn("web:admin");
        when(fileTransferService.tree("web:admin", "s1", null))
            .thenReturn(new FileTreeResponse(
                "/tmp",
                "/",
                List.of(new FileTreeEntryResponse("foo.txt", "/tmp/foo.txt", FileEntryType.FILE, 12L, 1700000000000L, true, true))
            ));

        mockMvc.perform(get("/webapi/sessions/s1/files/tree"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.currentPath").value("/tmp"))
            .andExpect(jsonPath("$.entries[0].name").value("foo.txt"))
            .andExpect(jsonPath("$.entries[0].type").value("FILE"));
    }

    @Test
    void uploadReturns200WithPerFileResults() throws Exception {
        when(requestActorResolver.resolve(any())).thenReturn("web:admin");
        when(fileTransferService.upload(eq("web:admin"), eq("s1"), eq("/tmp"), any(), any()))
            .thenReturn(new FileUploadResponse(List.of(
                new FileUploadItemResponse("a.txt", "SUCCESS", "/tmp/a.txt", 4L, null),
                new FileUploadItemResponse("b.txt", "FAILED", null, 2L, "io error")
            )));

        MockMultipartFile first = new MockMultipartFile("files", "a.txt", MediaType.TEXT_PLAIN_VALUE, "1234".getBytes());
        MockMultipartFile second = new MockMultipartFile("files", "b.txt", MediaType.TEXT_PLAIN_VALUE, "xx".getBytes());

        mockMvc.perform(multipart("/webapi/sessions/s1/files/upload")
                .file(first)
                .file(second)
                .param("targetPath", "/tmp")
                .param("conflictPolicy", "rename"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.results[0].status").value("SUCCESS"))
            .andExpect(jsonPath("$.results[1].status").value("FAILED"));
    }

    @Test
    void uploadReturns400ForUnsupportedConflictPolicy() throws Exception {
        when(requestActorResolver.resolve(any())).thenReturn("web:admin");

        MockMultipartFile file = new MockMultipartFile("files", "a.txt", MediaType.TEXT_PLAIN_VALUE, "1234".getBytes());

        mockMvc.perform(multipart("/webapi/sessions/s1/files/upload")
                .file(file)
                .param("targetPath", "/tmp")
                .param("conflictPolicy", "bad"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("unsupported conflictPolicy: bad"));
    }

    @Test
    void headDownloadReturnsHeaders() throws Exception {
        when(requestActorResolver.resolveAuthenticated(any())).thenReturn("web:admin");
        when(fileTransferService.resolveDownloadPath("/tmp/a.txt", null)).thenReturn("/tmp/a.txt");
        when(fileTransferService.openDownload("web:admin", "s1", "/tmp/a.txt"))
            .thenReturn(new FileDownloadHandle(
                "/tmp/a.txt",
                "a.txt",
                10L,
                1700000000000L,
                new ByteArrayInputStream(new byte[] {1, 2, 3}),
                () -> {
                }
            ));

        mockMvc.perform(head("/webapi/sessions/s1/files/download").queryParam("path", "/tmp/a.txt"))
            .andExpect(status().isOk())
            .andExpect(header().string("Content-Disposition", "attachment; filename=\"a.txt\""))
            .andExpect(header().string("Content-Length", "10"));
    }

    @Test
    void mkdirReturns403WhenPathOutsideRoot() throws Exception {
        when(requestActorResolver.resolve(any())).thenReturn("web:admin");
        when(fileTransferService.mkdir(eq("web:admin"), eq("s1"), eq("/tmp"), eq("newdir")))
            .thenThrow(new FileTransferForbiddenException("path is outside of allowed root"));

        mockMvc.perform(post("/webapi/sessions/s1/files/mkdir")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"parentPath":"/tmp","name":"newdir"}
                    """))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error").value("path is outside of allowed root"));
    }

    @Test
    void treeReturns404WhenSessionMissing() throws Exception {
        when(requestActorResolver.resolve(any())).thenReturn("web:admin");
        when(fileTransferService.tree("web:admin", "missing", null))
            .thenThrow(new FileTransferNotFoundException("session not found"));

        mockMvc.perform(get("/webapi/sessions/missing/files/tree"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error").value("session not found"));
    }

    @Test
    void archiveReturns413WhenExceedLimit() throws Exception {
        when(requestActorResolver.resolve(any())).thenReturn("web:admin");
        when(fileTransferService.resolveArchivePaths(any(FileDownloadArchiveRequest.class), eq(null)))
            .thenReturn(List.of("/tmp/a.txt"));
        when(fileTransferService.resolveArchiveName(any(FileDownloadArchiveRequest.class), eq(null)))
            .thenReturn("bundle.zip");
        when(fileTransferService.planArchive("web:admin", "s1", List.of("/tmp/a.txt")))
            .thenThrow(new FileTransferPayloadTooLargeException("archive exceeds maxDownloadArchiveBytes"));

        mockMvc.perform(post("/webapi/sessions/s1/files/download-archive")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"paths":["/tmp/a.txt"],"archiveName":"bundle.zip"}
                    """))
            .andExpect(status().isPayloadTooLarge())
            .andExpect(jsonPath("$.error").value("archive exceeds maxDownloadArchiveBytes"));
    }

    @Test
    void downloadByTicketReturns403WhenTicketInvalid() throws Exception {
        when(requestActorResolver.resolveAuthenticated(any())).thenReturn(null);
        when(fileTransferService.consumeSingleDownloadTicket(null, "s1", "bad-ticket"))
            .thenThrow(new FileTransferForbiddenException("download ticket is invalid or already consumed"));

        mockMvc.perform(get("/webapi/sessions/s1/files/download").queryParam("ticket", "bad-ticket"))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error").value("download ticket is invalid or already consumed"));
    }

    @Test
    void createDownloadTicketReturns201() throws Exception {
        when(requestActorResolver.resolve(any())).thenReturn("web:admin");
        when(fileTransferService.createDownloadTicket(eq("web:admin"), eq("s1"), any(), eq("/term/api")))
            .thenReturn(new FileDownloadTicketResponse("t1", "/term/api/sessions/s1/files/download?ticket=t1",
                Instant.parse("2026-02-24T12:00:00Z")));

        mockMvc.perform(post("/webapi/sessions/s1/files/download-ticket")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"mode":"single","path":"/tmp/a.txt"}
                    """))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.ticket").value("t1"))
            .andExpect(jsonPath("$.downloadUrl").value("/term/api/sessions/s1/files/download?ticket=t1"));
    }

    @Test
    void mkdirReturns200() throws Exception {
        when(requestActorResolver.resolve(any())).thenReturn("web:admin");
        when(fileTransferService.mkdir("web:admin", "s1", "/tmp", "newdir"))
            .thenReturn(new FileMkdirResponse("/tmp/newdir", true));

        mockMvc.perform(post("/webapi/sessions/s1/files/mkdir")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"parentPath":"/tmp","name":"newdir"}
                    """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.createdPath").value("/tmp/newdir"))
            .andExpect(jsonPath("$.created").value(true));
    }

    @Test
    void downloadReturns400WhenDirectoryRequested() throws Exception {
        when(requestActorResolver.resolveAuthenticated(any())).thenReturn("web:admin");
        when(fileTransferService.resolveDownloadPath("/tmp/dir", null)).thenReturn("/tmp/dir");
        when(fileTransferService.openDownload("web:admin", "s1", "/tmp/dir"))
            .thenThrow(new FileTransferBadRequestException("path must be a file"));

        mockMvc.perform(get("/webapi/sessions/s1/files/download").queryParam("path", "/tmp/dir"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("path must be a file"));
    }

    @Test
    void archiveByTicketResolvesPayloadAndStreamsZip() throws Exception {
        when(requestActorResolver.resolveAuthenticated(any())).thenReturn("web:admin");
        DownloadTicketService.DownloadTicketPayload payload = new DownloadTicketService.DownloadTicketPayload(
            "tk",
            com.linlay.termjava.model.file.FileDownloadTicketMode.ARCHIVE,
            "s1",
            "web:admin",
            null,
            List.of("/tmp/a.txt"),
            "bundle.zip",
            Instant.now().plusSeconds(10)
        );
        when(fileTransferService.consumeArchiveDownloadTicket("web:admin", "s1", "tk")).thenReturn(payload);
        when(fileTransferService.resolveArchivePaths(null, payload)).thenReturn(List.of("/tmp/a.txt"));
        when(fileTransferService.resolveArchiveName(null, payload)).thenReturn("bundle.zip");
        when(fileTransferService.planArchive("web:admin", "s1", List.of("/tmp/a.txt")))
            .thenReturn(new com.linlay.termjava.service.file.ArchivePlan(0L, List.of()));

        mockMvc.perform(get("/webapi/sessions/s1/files/download-archive").queryParam("ticket", "tk"))
            .andExpect(status().isOk())
            .andExpect(header().string("Content-Type", "application/zip"));
    }
}

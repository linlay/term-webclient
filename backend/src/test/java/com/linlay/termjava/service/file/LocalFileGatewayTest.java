package com.linlay.termjava.service.file;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.linlay.termjava.model.file.FileEntryType;
import com.linlay.termjava.model.file.FileTreeResponse;
import com.linlay.termjava.model.file.UploadConflictPolicy;
import java.io.ByteArrayInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class LocalFileGatewayTest {

    @Test
    void treeReturnsDirectoriesFirstAndSorted(@TempDir Path tempDir) throws Exception {
        Path root = tempDir.toRealPath();
        Files.createDirectories(root.resolve("b-dir"));
        Files.createDirectories(root.resolve("a-dir"));
        Files.writeString(root.resolve("z.txt"), "z");
        Files.writeString(root.resolve("c.txt"), "c");

        LocalFileGateway gateway = new LocalFileGateway(root.toString());
        FileTreeResponse tree = gateway.tree(null);

        assertEquals(root.toString(), tree.currentPath());
        assertEquals(List.of("a-dir", "b-dir", "c.txt", "z.txt"),
            tree.entries().stream().map(item -> item.name()).toList());
        assertEquals(FileEntryType.DIRECTORY, tree.entries().get(0).type());
        assertEquals(FileEntryType.FILE, tree.entries().get(2).type());
    }

    @Test
    void uploadConflictPolicyRenameRejectAndOverwrite(@TempDir Path tempDir) throws Exception {
        Path root = tempDir.toRealPath();
        Path dir = Files.createDirectories(root.resolve("upload"));
        Path existing = dir.resolve("demo.txt");
        Files.writeString(existing, "old");

        LocalFileGateway gateway = new LocalFileGateway(root.toString());

        var renamed = gateway.upload(
            dir.toString(),
            "demo.txt",
            new ByteArrayInputStream("new".getBytes()),
            3L,
            UploadConflictPolicy.RENAME
        );
        assertEquals("SUCCESS", renamed.status());
        assertTrue(renamed.savedPath().endsWith("demo (1).txt"));
        assertEquals("old", Files.readString(existing));

        assertThrows(FileTransferBadRequestException.class, () -> gateway.upload(
            dir.toString(),
            "demo.txt",
            new ByteArrayInputStream("new".getBytes()),
            3L,
            UploadConflictPolicy.REJECT
        ));

        var overwritten = gateway.upload(
            dir.toString(),
            "demo.txt",
            new ByteArrayInputStream("new".getBytes()),
            3L,
            UploadConflictPolicy.OVERWRITE
        );
        assertEquals("SUCCESS", overwritten.status());
        assertEquals("new", Files.readString(existing));
    }

    @Test
    void uploadRejectsSymlinkJumpOutsideRoot(@TempDir Path tempDir) throws Exception {
        Path root = tempDir.toRealPath();
        Path outside = Files.createTempDirectory("outside-root");
        Path symlink = root.resolve("escape");
        boolean symlinkCreated = tryCreateSymbolicLink(symlink, outside);
        if (!symlinkCreated) {
            // Skip assertion on systems without symlink permission.
            return;
        }

        LocalFileGateway gateway = new LocalFileGateway(root.toString());

        assertThrows(FileTransferForbiddenException.class, () -> gateway.upload(
            symlink.toString(),
            "leak.txt",
            new ByteArrayInputStream("boom".getBytes()),
            4L,
            UploadConflictPolicy.OVERWRITE
        ));
    }

    @Test
    void mkdirCreatesDirectoryInsideRoot(@TempDir Path tempDir) {
        Path root = tempDir.toAbsolutePath().normalize();
        LocalFileGateway gateway = new LocalFileGateway(root.toString());
        var response = gateway.mkdir(gateway.rootPath(), "docs");

        assertTrue(response.created());
        assertNotNull(response.createdPath());
        assertTrue(Files.isDirectory(Path.of(response.createdPath())));
    }

    @Test
    void planArchiveRecursivelyCollectsFiles(@TempDir Path tempDir) throws Exception {
        Path root = tempDir.toRealPath();
        Path nestedDir = Files.createDirectories(root.resolve("a/b"));
        Files.writeString(nestedDir.resolve("a.txt"), "aa");
        Files.writeString(root.resolve("root.txt"), "r");

        LocalFileGateway gateway = new LocalFileGateway(root.toString());
        ArchivePlan plan = gateway.planArchive(List.of(root.resolve("a").toString(), root.resolve("root.txt").toString()));

        List<String> archivePaths = plan.entries().stream().map(ArchiveEntrySource::archivePath).sorted().toList();
        assertEquals(List.of("a/b/a.txt", "root.txt"), archivePaths);
        assertFalse(plan.entries().isEmpty());
        assertEquals(3L, plan.totalBytes());
    }

    private boolean tryCreateSymbolicLink(Path link, Path target) {
        try {
            Files.createSymbolicLink(link, target);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }
}

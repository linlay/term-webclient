package com.linlay.termjava.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.linlay.termjava.config.TerminalProperties;
import com.linlay.termjava.model.WorkdirBrowseResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class WorkdirBrowseServiceTest {

    @Test
    void browseWithoutPathReturnsRootEntries(@TempDir Path tempDir) throws Exception {
        Files.createDirectories(tempDir.resolve("alpha"));
        Files.createDirectories(tempDir.resolve("beta/sub"));
        Files.createDirectories(tempDir.resolve(".hidden-dir/child"));
        Files.createDirectories(tempDir.resolve("gamma/.only-hidden"));
        Files.createFile(tempDir.resolve("ignore.txt"));
        Files.createFile(tempDir.resolve(".hidden-file"));

        WorkdirBrowseService service = new WorkdirBrowseService(baseProps(tempDir));
        WorkdirBrowseResponse response = service.browse(null);

        assertEquals(tempDir.toString(), response.rootPath());
        assertEquals(tempDir.toString(), response.currentPath());
        assertEquals(3, response.entries().size());
        assertEquals("alpha", response.entries().get(0).name());
        assertFalse(response.entries().get(0).hasChildren());
        assertEquals("beta", response.entries().get(1).name());
        assertTrue(response.entries().get(1).hasChildren());
        assertEquals("gamma", response.entries().get(2).name());
        assertFalse(response.entries().get(2).hasChildren());
    }

    @Test
    void browseWithValidPathReturnsSubdirs(@TempDir Path tempDir) throws Exception {
        Path child = Files.createDirectories(tempDir.resolve("project/src"));
        Files.createDirectories(child.resolve("main"));

        WorkdirBrowseService service = new WorkdirBrowseService(baseProps(tempDir));
        WorkdirBrowseResponse response = service.browse(child.toString());

        assertEquals(child.toString(), response.currentPath());
        assertEquals(1, response.entries().size());
        assertEquals("main", response.entries().get(0).name());
    }

    @Test
    void browseRejectsPathOutsideRoot(@TempDir Path tempDir) {
        WorkdirBrowseService service = new WorkdirBrowseService(baseProps(tempDir));
        Path outside = tempDir.getParent();
        assertThrows(InvalidWorkdirBrowseRequestException.class, () -> service.browse(outside.toString()));
    }

    @Test
    void browseRejectsNonDirectoryPath(@TempDir Path tempDir) throws Exception {
        Path file = Files.createFile(tempDir.resolve("not-dir.txt"));
        WorkdirBrowseService service = new WorkdirBrowseService(baseProps(tempDir));
        assertThrows(InvalidWorkdirBrowseRequestException.class, () -> service.browse(file.toString()));
    }

    private TerminalProperties baseProps(Path root) {
        TerminalProperties props = new TerminalProperties();
        props.setWorkdirBrowseRoot(root.toString());
        return props;
    }
}

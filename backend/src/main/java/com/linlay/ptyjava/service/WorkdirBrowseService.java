package com.linlay.ptyjava.service;

import com.linlay.ptyjava.config.TerminalProperties;
import com.linlay.ptyjava.model.WorkdirBrowseResponse;
import com.linlay.ptyjava.model.WorkdirEntry;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.stream.Stream;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class WorkdirBrowseService {

    private final Path rootPath;

    public WorkdirBrowseService(TerminalProperties terminalProperties) {
        String configuredRoot = terminalProperties.getWorkdirBrowseRoot();
        Path resolved = Path.of(configuredRoot).toAbsolutePath().normalize();
        if (!Files.exists(resolved) || !Files.isDirectory(resolved)) {
            throw new IllegalStateException("terminal.workdir-browse-root must be an existing directory");
        }
        this.rootPath = resolved;
    }

    public WorkdirBrowseResponse browse(String path) {
        Path target = resolvePath(path);
        List<WorkdirEntry> entries = listDirectoryEntries(target);
        return new WorkdirBrowseResponse(
            rootPath.toString(),
            target.toString(),
            entries
        );
    }

    private Path resolvePath(String path) {
        Path target;
        if (!StringUtils.hasText(path)) {
            target = rootPath;
        } else {
            try {
                target = Path.of(path).toAbsolutePath().normalize();
            } catch (InvalidPathException ex) {
                throw new InvalidWorkdirBrowseRequestException("path is invalid");
            }
        }

        if (!target.startsWith(rootPath)) {
            throw new InvalidWorkdirBrowseRequestException("path must be inside browse root");
        }
        if (!Files.exists(target) || !Files.isDirectory(target)) {
            throw new InvalidWorkdirBrowseRequestException("path must be an existing directory");
        }
        return target;
    }

    private List<WorkdirEntry> listDirectoryEntries(Path target) {
        try (Stream<Path> stream = Files.list(target)) {
            return stream
                .filter(Files::isDirectory)
                .sorted(Comparator.comparing(
                    path -> path.getFileName().toString().toLowerCase(Locale.ROOT)
                ))
                .map(this::toEntry)
                .toList();
        } catch (IOException ex) {
            throw new RuntimeException("failed to list directories", ex);
        }
    }

    private WorkdirEntry toEntry(Path dirPath) {
        return new WorkdirEntry(
            dirPath.getFileName().toString(),
            dirPath.toString(),
            hasSubDirectory(dirPath)
        );
    }

    private boolean hasSubDirectory(Path dirPath) {
        try (Stream<Path> stream = Files.list(dirPath)) {
            return stream.anyMatch(Files::isDirectory);
        } catch (IOException ex) {
            return false;
        }
    }
}

package com.linlay.termjava.service.workspace;

import com.linlay.termjava.config.TerminalProperties;
import com.linlay.termjava.model.workspace.ContextPackEntryResponse;
import com.linlay.termjava.model.workspace.ContextPackRequest;
import com.linlay.termjava.model.workspace.ContextPackResponse;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.springframework.stereotype.Service;

@Service
public class WorkspaceContextService {

    private static final int MAX_SINGLE_FILE_BYTES = 128 * 1024;

    private final TerminalProperties properties;
    private final Path workspaceRoot;

    public WorkspaceContextService(TerminalProperties properties) {
        this.properties = properties;
        this.workspaceRoot = detectWorkspaceRoot(Path.of("").toAbsolutePath().normalize());
    }

    public ContextPackResponse pack(ContextPackRequest request) {
        ContextPackRequest effective = request == null ? new ContextPackRequest() : request;
        int maxBytes = effective.getMaxBytes() == null
            ? properties.getAgent().getMaxContextPackBytes()
            : Math.max(4096, effective.getMaxBytes());

        int remaining = Math.max(4096, maxBytes);
        boolean truncated = false;
        List<ContextPackEntryResponse> entries = new ArrayList<>();

        List<PathWithDisplay> selected = normalizePaths(effective.getPaths());
        for (PathWithDisplay selectedPath : selected) {
            if (remaining <= 0) {
                entries.add(new ContextPackEntryResponse(
                    selectedPath.displayPath,
                    true,
                    true,
                    0,
                    "",
                    "context byte budget exhausted"
                ));
                truncated = true;
                continue;
            }

            ContextPackEntryResponse entry = readEntry(selectedPath, remaining);
            entries.add(entry);
            if (entry.truncated()) {
                truncated = true;
            }
            remaining -= Math.max(0, entry.bytes());
        }

        String gitDiff = "";
        boolean includeGitDiff = Boolean.TRUE.equals(effective.getIncludeGitDiff());
        if (includeGitDiff && remaining > 0) {
            gitDiff = readGitDiff(selected, remaining);
            if (gitDiff.length() >= remaining) {
                truncated = true;
            }
        }

        return new ContextPackResponse(
            Instant.now(),
            workspaceRoot.toString(),
            truncated,
            entries,
            gitDiff
        );
    }

    private List<PathWithDisplay> normalizePaths(List<String> rawPaths) {
        List<PathWithDisplay> results = new ArrayList<>();
        if (rawPaths == null) {
            return results;
        }

        for (String rawPath : rawPaths) {
            if (rawPath == null || rawPath.isBlank()) {
                continue;
            }
            try {
                Path path = Path.of(rawPath);
                Path absolute = path.isAbsolute()
                    ? path.toAbsolutePath().normalize()
                    : workspaceRoot.resolve(path).normalize();
                if (!absolute.startsWith(workspaceRoot)) {
                    throw new InvalidWorkspaceContextRequestException("path must be inside workspace root: " + rawPath);
                }
                String display = workspaceRoot.relativize(absolute).toString();
                if (display.isBlank()) {
                    display = ".";
                }
                results.add(new PathWithDisplay(absolute, display));
            } catch (InvalidPathException ex) {
                throw new InvalidWorkspaceContextRequestException("invalid path: " + rawPath);
            }
        }
        return results;
    }

    private ContextPackEntryResponse readEntry(PathWithDisplay selectedPath, int remainingBudget) {
        Path path = selectedPath.path;
        if (!Files.exists(path)) {
            return new ContextPackEntryResponse(selectedPath.displayPath, false, false, 0, "", "file does not exist");
        }
        if (!Files.isRegularFile(path)) {
            return new ContextPackEntryResponse(selectedPath.displayPath, true, false, 0, "", "not a regular file");
        }

        int fileBudget = Math.min(remainingBudget, MAX_SINGLE_FILE_BYTES);

        try {
            byte[] bytes = Files.readAllBytes(path);
            boolean truncated = bytes.length > fileBudget;
            int used = Math.min(bytes.length, fileBudget);
            String content = new String(bytes, 0, used, StandardCharsets.UTF_8);
            return new ContextPackEntryResponse(
                selectedPath.displayPath,
                true,
                truncated,
                used,
                content,
                ""
            );
        } catch (IOException ex) {
            return new ContextPackEntryResponse(
                selectedPath.displayPath,
                true,
                false,
                0,
                "",
                "failed to read file"
            );
        }
    }

    private String readGitDiff(List<PathWithDisplay> selectedPaths, int maxChars) {
        List<String> command = new ArrayList<>();
        command.add("git");
        command.add("-C");
        command.add(workspaceRoot.toString());
        command.add("diff");
        if (!selectedPaths.isEmpty()) {
            command.add("--");
            for (PathWithDisplay selectedPath : selectedPaths) {
                command.add(selectedPath.displayPath);
            }
        }

        Process process = null;
        try {
            process = new ProcessBuilder(command).start();
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            copyStream(process.getInputStream(), output, maxChars + 256);
            process.waitFor(4, TimeUnit.SECONDS);
            String text = output.toString(StandardCharsets.UTF_8);
            if (text.length() > maxChars) {
                return text.substring(0, maxChars);
            }
            return text;
        } catch (Exception ignored) {
            return "";
        } finally {
            if (process != null) {
                process.destroyForcibly();
            }
        }
    }

    private void copyStream(InputStream inputStream, ByteArrayOutputStream output, int maxBytes) throws IOException {
        byte[] buffer = new byte[4096];
        int read;
        while ((read = inputStream.read(buffer)) != -1) {
            if (read <= 0) {
                continue;
            }
            int available = maxBytes - output.size();
            if (available <= 0) {
                return;
            }
            output.write(buffer, 0, Math.min(available, read));
            if (output.size() >= maxBytes) {
                return;
            }
        }
    }

    private Path detectWorkspaceRoot(Path start) {
        Path current = start;
        while (current != null) {
            if (Files.exists(current.resolve(".git"))) {
                return current;
            }
            current = current.getParent();
        }
        return start;
    }

    private record PathWithDisplay(Path path, String displayPath) {
    }
}

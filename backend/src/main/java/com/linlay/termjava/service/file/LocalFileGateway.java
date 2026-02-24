package com.linlay.termjava.service.file;

import com.linlay.termjava.model.file.FileEntryType;
import com.linlay.termjava.model.file.FileMkdirResponse;
import com.linlay.termjava.model.file.FileTreeEntryResponse;
import com.linlay.termjava.model.file.FileTreeResponse;
import com.linlay.termjava.model.file.FileUploadItemResponse;
import com.linlay.termjava.model.file.UploadConflictPolicy;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import org.springframework.util.StringUtils;

public class LocalFileGateway implements FileGateway {

    private final Path configuredRoot;
    private final Path realRoot;

    public LocalFileGateway(String rootPath) {
        if (!StringUtils.hasText(rootPath)) {
            throw new IllegalArgumentException("rootPath must not be blank");
        }
        try {
            configuredRoot = Path.of(rootPath).toAbsolutePath().normalize();
            realRoot = configuredRoot.toRealPath();
        } catch (IOException | InvalidPathException ex) {
            throw new FileTransferBadRequestException("invalid local file root", ex);
        }
    }

    @Override
    public String rootPath() {
        return realRoot.toString();
    }

    @Override
    public FileTreeResponse tree(String path) {
        Path target = resolveExistingDirectory(path);
        String parentPath = null;
        Path parent = target.getParent();
        if (parent != null) {
            Path normalizedParent = parent.normalize();
            if (normalizedParent.startsWith(realRoot)) {
                parentPath = normalizedParent.toString();
            }
        }

        List<FileTreeEntryResponse> entries;
        try (var stream = Files.list(target)) {
            entries = stream
                .map(this::toEntryOrNull)
                .filter(Objects::nonNull)
                .sorted(Comparator
                    .comparing((FileTreeEntryResponse item) -> item.type() != FileEntryType.DIRECTORY)
                    .thenComparing(item -> item.name().toLowerCase(Locale.ROOT)))
                .toList();
        } catch (IOException ex) {
            throw new FileTransferBadRequestException("failed to list directory", ex);
        }

        return new FileTreeResponse(target.toString(), parentPath, entries);
    }

    @Override
    public FileMkdirResponse mkdir(String parentPath, String name) {
        validateSimpleName(name, "name");
        Path parent = resolveExistingDirectory(parentPath);
        Path target = parent.resolve(name).normalize();
        ensurePathInsideRoot(target);

        if (Files.exists(target)) {
            throw new FileTransferBadRequestException("target already exists");
        }

        try {
            Files.createDirectory(target);
            Path realTarget = target.toRealPath();
            ensurePathInsideRoot(realTarget);
            return new FileMkdirResponse(realTarget.toString(), true);
        } catch (IOException ex) {
            throw new FileTransferBadRequestException("failed to create directory", ex);
        }
    }

    @Override
    public FileUploadItemResponse upload(String targetPath,
                                         String fileName,
                                         InputStream inputStream,
                                         long declaredSize,
                                         UploadConflictPolicy conflictPolicy) throws IOException {
        validateSimpleName(fileName, "fileName");
        Path directory = resolveExistingDirectory(targetPath);
        Path destination = resolveUploadDestination(directory, fileName, conflictPolicy);
        Path temp = Files.createTempFile(directory, ".upload-", ".tmp");

        long copied;
        try {
            copied = Files.copy(inputStream, temp, StandardCopyOption.REPLACE_EXISTING);
            if (conflictPolicy == UploadConflictPolicy.OVERWRITE) {
                Files.move(temp, destination, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } else {
                Files.move(temp, destination, StandardCopyOption.ATOMIC_MOVE);
            }
        } catch (IOException ex) {
            try {
                Files.deleteIfExists(temp);
            } catch (IOException ignored) {
            }
            throw ex;
        }

        long size = copied >= 0 ? copied : Math.max(0L, declaredSize);
        return new FileUploadItemResponse(fileName, "SUCCESS", destination.toString(), size, null);
    }

    @Override
    public FileDownloadHandle openDownload(String path) throws IOException {
        Path file = resolveExistingFile(path);
        InputStream inputStream = Files.newInputStream(file);
        long size = Files.size(file);
        long mtime = Files.getLastModifiedTime(file).toMillis();
        return new FileDownloadHandle(file.toString(), file.getFileName().toString(), size, mtime, inputStream, inputStream::close);
    }

    @Override
    public ArchivePlan planArchive(List<String> paths) throws IOException {
        if (paths == null || paths.isEmpty()) {
            throw new FileTransferBadRequestException("paths must not be empty");
        }

        List<ArchiveEntrySource> entries = new ArrayList<>();
        Map<String, Path> uniqueByArchivePath = new LinkedHashMap<>();

        for (String path : paths) {
            Path target = resolveExistingPath(path);
            if (Files.isDirectory(target)) {
                collectDirectoryArchiveEntries(target, uniqueByArchivePath);
            } else if (Files.isRegularFile(target)) {
                addArchiveEntry(target, uniqueByArchivePath);
            }
        }

        long total = 0L;
        for (Map.Entry<String, Path> entry : uniqueByArchivePath.entrySet()) {
            Path file = entry.getValue();
            long size = Files.size(file);
            total = Math.addExact(total, size);
            String archivePath = entry.getKey();
            entries.add(new ArchiveEntrySource(archivePath, size, () -> Files.newInputStream(file)));
        }

        return new ArchivePlan(total, entries);
    }

    private void collectDirectoryArchiveEntries(Path directory, Map<String, Path> uniqueByArchivePath) throws IOException {
        Files.walkFileTree(directory, Set.of(), Integer.MAX_VALUE, new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) throws IOException {
                Path real = dir.toRealPath();
                ensurePathInsideRoot(real);
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
                Path real = file.toRealPath();
                ensurePathInsideRoot(real);
                if (attrs.isRegularFile()) {
                    addArchiveEntry(real, uniqueByArchivePath);
                }
                return FileVisitResult.CONTINUE;
            }
        });
    }

    private void addArchiveEntry(Path file, Map<String, Path> uniqueByArchivePath) {
        Path relative = realRoot.relativize(file);
        String archivePath = relative.toString().replace('\\', '/');
        if (!StringUtils.hasText(archivePath)) {
            archivePath = file.getFileName().toString();
        }
        uniqueByArchivePath.putIfAbsent(archivePath, file);
    }

    private FileTreeEntryResponse toEntryOrNull(Path rawPath) {
        try {
            Path realPath = rawPath.toRealPath();
            ensurePathInsideRoot(realPath);
            boolean directory = Files.isDirectory(realPath);
            long size = directory ? 0L : Files.size(realPath);
            long mtime = Files.getLastModifiedTime(realPath).toMillis();
            return new FileTreeEntryResponse(
                rawPath.getFileName() == null ? realPath.toString() : rawPath.getFileName().toString(),
                realPath.toString(),
                directory ? FileEntryType.DIRECTORY : FileEntryType.FILE,
                size,
                mtime,
                Files.isReadable(realPath),
                Files.isWritable(realPath)
            );
        } catch (IOException | RuntimeException ignored) {
            return null;
        }
    }

    private Path resolveUploadDestination(Path targetDir, String fileName, UploadConflictPolicy conflictPolicy) {
        Path base = targetDir.resolve(fileName).normalize();
        ensurePathInsideRoot(base);

        if (!Files.exists(base)) {
            return base;
        }

        if (conflictPolicy == UploadConflictPolicy.OVERWRITE) {
            return base;
        }
        if (conflictPolicy == UploadConflictPolicy.REJECT) {
            throw new FileTransferBadRequestException("file already exists: " + fileName);
        }

        String stem = fileName;
        String ext = "";
        int dot = fileName.lastIndexOf('.');
        if (dot > 0) {
            stem = fileName.substring(0, dot);
            ext = fileName.substring(dot);
        }
        int suffix = 1;
        while (true) {
            String candidateName = stem + " (" + suffix + ")" + ext;
            Path candidate = targetDir.resolve(candidateName).normalize();
            ensurePathInsideRoot(candidate);
            if (!Files.exists(candidate)) {
                return candidate;
            }
            suffix += 1;
        }
    }

    private Path resolveExistingDirectory(String path) {
        Path target = resolveExistingPath(path);
        if (!Files.isDirectory(target)) {
            throw new FileTransferBadRequestException("path must be a directory");
        }
        return target;
    }

    private Path resolveExistingFile(String path) {
        Path target = resolveExistingPath(path);
        if (!Files.isRegularFile(target)) {
            throw new FileTransferBadRequestException("path must be a file");
        }
        return target;
    }

    private Path resolveExistingPath(String path) {
        Path raw = resolveRequestedPath(path);
        if (!Files.exists(raw)) {
            throw new FileTransferNotFoundException("path not found");
        }

        try {
            Path real = raw.toRealPath();
            ensurePathInsideRoot(real);
            return real;
        } catch (IOException ex) {
            throw new FileTransferBadRequestException("invalid path", ex);
        }
    }

    private Path resolveRequestedPath(String path) {
        if (!StringUtils.hasText(path)) {
            return realRoot;
        }
        try {
            Path candidate = Path.of(path.trim());
            if (!candidate.isAbsolute()) {
                candidate = configuredRoot.resolve(candidate);
            }
            candidate = candidate.toAbsolutePath().normalize();
            ensurePathInsideRoot(candidate);
            return candidate;
        } catch (InvalidPathException ex) {
            throw new FileTransferBadRequestException("path is invalid", ex);
        }
    }

    private void ensurePathInsideRoot(Path target) {
        if (!target.normalize().startsWith(realRoot)) {
            throw new FileTransferForbiddenException("path is outside of allowed root");
        }
    }

    private void validateSimpleName(String value, String field) {
        if (!StringUtils.hasText(value)) {
            throw new FileTransferBadRequestException(field + " must not be blank");
        }
        String normalized = value.trim();
        if (normalized.equals(".") || normalized.equals("..") || normalized.contains("/") || normalized.contains("\\")) {
            throw new FileTransferBadRequestException(field + " contains invalid characters");
        }
    }
}

package com.linlay.termjava.service.file;

import com.linlay.termjava.model.FileSessionBinding;
import com.linlay.termjava.model.file.FileEntryType;
import com.linlay.termjava.model.file.FileMkdirResponse;
import com.linlay.termjava.model.file.FileTreeEntryResponse;
import com.linlay.termjava.model.file.FileTreeResponse;
import com.linlay.termjava.model.file.FileUploadItemResponse;
import com.linlay.termjava.model.file.UploadConflictPolicy;
import com.linlay.termjava.service.ssh.ResolvedSshCredential;
import com.linlay.termjava.service.ssh.SshConnectionPool;
import com.linlay.termjava.service.ssh.SshCredentialStore;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.attribute.FileTime;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.apache.sshd.sftp.client.SftpClient;
import org.apache.sshd.sftp.client.SftpClient.Attributes;
import org.apache.sshd.sftp.client.SftpClient.DirEntry;
import org.apache.sshd.sftp.common.SftpConstants;
import org.springframework.util.StringUtils;

public class SftpFileGateway implements FileGateway {

    private final SshConnectionPool sshConnectionPool;
    private final SshCredentialStore sshCredentialStore;
    private final FileSessionBinding.SshBinding sshBinding;
    private final String configuredRoot;

    public SftpFileGateway(SshConnectionPool sshConnectionPool,
                           SshCredentialStore sshCredentialStore,
                           FileSessionBinding.SshBinding sshBinding,
                           String configuredRoot) {
        this.sshConnectionPool = sshConnectionPool;
        this.sshCredentialStore = sshCredentialStore;
        this.sshBinding = sshBinding;
        this.configuredRoot = StringUtils.hasText(configuredRoot) ? configuredRoot.trim() : ".";
    }

    @Override
    public String rootPath() {
        return configuredRoot;
    }

    @Override
    public FileTreeResponse tree(String path) {
        ResolvedSshCredential credential = resolveCredential();
        try (SshConnectionPool.SshConnectionLease lease = sshConnectionPool.acquire(credential);
             SftpClient sftp = lease.openSftpClient()) {
            String root = resolveRootPath(sftp);
            String target = resolveExistingDirectory(sftp, root, path);
            String parentPath = resolveParentPath(root, target);

            List<FileTreeEntryResponse> entries = new ArrayList<>();
            for (DirEntry entry : safeReadDir(sftp, target)) {
                String name = entry.getFilename();
                if (!StringUtils.hasText(name) || ".".equals(name) || "..".equals(name)) {
                    continue;
                }

                String childPath = normalizePath(target + "/" + name);
                Attributes attributes;
                try {
                    String canonicalChild = canonicalize(sftp, childPath);
                    ensureInsideRoot(root, canonicalChild);
                    attributes = safeStat(sftp, canonicalChild);
                    entries.add(toTreeEntry(name, canonicalChild, attributes));
                } catch (RuntimeException ex) {
                    // Skip broken entries instead of failing the whole tree request.
                }
            }

            entries.sort(Comparator
                .comparing((FileTreeEntryResponse item) -> item.type() != FileEntryType.DIRECTORY)
                .thenComparing(item -> item.name().toLowerCase(Locale.ROOT)));
            return new FileTreeResponse(target, parentPath, entries);
        } catch (IOException ex) {
            throw new FileTransferBadRequestException("failed to browse sftp path", ex);
        }
    }

    @Override
    public FileMkdirResponse mkdir(String parentPath, String name) {
        validateSimpleName(name, "name");
        ResolvedSshCredential credential = resolveCredential();
        try (SshConnectionPool.SshConnectionLease lease = sshConnectionPool.acquire(credential);
             SftpClient sftp = lease.openSftpClient()) {
            String root = resolveRootPath(sftp);
            String parent = resolveExistingDirectory(sftp, root, parentPath);
            String target = normalizePath(parent + "/" + name);
            ensureInsideRoot(root, target);
            if (exists(sftp, target)) {
                throw new FileTransferBadRequestException("target already exists");
            }
            sftp.mkdir(target);
            String canonical = canonicalize(sftp, target);
            ensureInsideRoot(root, canonical);
            return new FileMkdirResponse(canonical, true);
        } catch (IOException ex) {
            throw new FileTransferBadRequestException("failed to create remote directory", ex);
        }
    }

    @Override
    public FileUploadItemResponse upload(String targetPath,
                                         String fileName,
                                         InputStream inputStream,
                                         long declaredSize,
                                         UploadConflictPolicy conflictPolicy) throws IOException {
        validateSimpleName(fileName, "fileName");
        ResolvedSshCredential credential = resolveCredential();
        try (SshConnectionPool.SshConnectionLease lease = sshConnectionPool.acquire(credential);
             SftpClient sftp = lease.openSftpClient()) {
            String root = resolveRootPath(sftp);
            String directory = resolveExistingDirectory(sftp, root, targetPath);
            String destination = resolveUploadDestination(sftp, directory, fileName, conflictPolicy);
            String temp = normalizePath(directory + "/.upload-" + UUID.randomUUID() + ".tmp");

            long copied = copyToRemoteTemp(sftp, temp, inputStream);
            moveRemote(sftp, temp, destination, conflictPolicy == UploadConflictPolicy.OVERWRITE);
            long size = copied >= 0 ? copied : Math.max(0L, declaredSize);
            return new FileUploadItemResponse(fileName, "SUCCESS", destination, size, null);
        }
    }

    @Override
    public FileDownloadHandle openDownload(String path) throws IOException {
        ResolvedSshCredential credential = resolveCredential();
        SshConnectionPool.SshConnectionLease lease = sshConnectionPool.acquire(credential);
        SftpClient sftp = null;
        try {
            sftp = lease.openSftpClient();
            String root = resolveRootPath(sftp);
            String filePath = resolveExistingFile(sftp, root, path);
            Attributes attributes = safeStat(sftp, filePath);
            InputStream inputStream = sftp.read(filePath);
            long size = Math.max(0L, attributes.getSize());
            long mtime = toEpochMillis(attributes);
            SftpClient finalSftp = sftp;
            AutoCloseable closeable = () -> closeQuietly(inputStream, finalSftp, lease);
            return new FileDownloadHandle(filePath, leafName(filePath), size, mtime, inputStream, closeable);
        } catch (Exception ex) {
            closeQuietly(sftp, lease);
            if (ex instanceof IOException ioException) {
                throw ioException;
            }
            throw new IOException("failed to open remote download stream", ex);
        }
    }

    @Override
    public ArchivePlan planArchive(List<String> paths) throws IOException {
        if (paths == null || paths.isEmpty()) {
            throw new FileTransferBadRequestException("paths must not be empty");
        }

        ResolvedSshCredential credential = resolveCredential();
        try (SshConnectionPool.SshConnectionLease lease = sshConnectionPool.acquire(credential);
             SftpClient sftp = lease.openSftpClient()) {
            String root = resolveRootPath(sftp);
            Map<String, String> filesByArchivePath = new LinkedHashMap<>();
            for (String raw : paths) {
                String pathValue = resolveExistingPath(sftp, root, raw);
                Attributes attrs = safeStat(sftp, pathValue);
                if (attrs.isDirectory()) {
                    collectDirectory(sftp, root, pathValue, filesByArchivePath);
                } else if (attrs.isRegularFile()) {
                    addArchivePath(root, pathValue, filesByArchivePath);
                }
            }

            long total = 0L;
            List<ArchiveEntrySource> entries = new ArrayList<>();
            for (Map.Entry<String, String> item : filesByArchivePath.entrySet()) {
                String archivePath = item.getKey();
                String remotePath = item.getValue();
                long size = safeStat(sftp, remotePath).getSize();
                total = Math.addExact(total, Math.max(0L, size));
                entries.add(new ArchiveEntrySource(
                    archivePath,
                    Math.max(0L, size),
                    () -> openArchiveInputStream(remotePath)
                ));
            }
            return new ArchivePlan(total, entries);
        }
    }

    private InputStream openArchiveInputStream(String remotePath) throws IOException {
        ResolvedSshCredential credential = resolveCredential();
        SshConnectionPool.SshConnectionLease lease = sshConnectionPool.acquire(credential);
        SftpClient sftp = null;
        try {
            sftp = lease.openSftpClient();
            InputStream inputStream = sftp.read(remotePath);
            SftpClient finalSftp = sftp;
            return new InputStream() {
                @Override
                public int read() throws IOException {
                    return inputStream.read();
                }

                @Override
                public int read(byte[] b, int off, int len) throws IOException {
                    return inputStream.read(b, off, len);
                }

                @Override
                public void close() throws IOException {
                    IOException failure = null;
                    try {
                        inputStream.close();
                    } catch (IOException ex) {
                        failure = ex;
                    }
                    closeQuietly(finalSftp, lease);
                    if (failure != null) {
                        throw failure;
                    }
                }
            };
        } catch (Exception ex) {
            closeQuietly(sftp, lease);
            if (ex instanceof IOException ioException) {
                throw ioException;
            }
            throw new IOException("failed to open archive stream", ex);
        }
    }

    private void collectDirectory(SftpClient sftp,
                                  String root,
                                  String directory,
                                  Map<String, String> filesByArchivePath) throws IOException {
        for (DirEntry entry : safeReadDir(sftp, directory)) {
            String name = entry.getFilename();
            if (!StringUtils.hasText(name) || ".".equals(name) || "..".equals(name)) {
                continue;
            }
            String child = canonicalize(sftp, normalizePath(directory + "/" + name));
            ensureInsideRoot(root, child);
            Attributes attrs = safeStat(sftp, child);
            if (attrs.isDirectory()) {
                collectDirectory(sftp, root, child, filesByArchivePath);
                continue;
            }
            if (!attrs.isRegularFile()) {
                continue;
            }
            addArchivePath(root, child, filesByArchivePath);
        }
    }

    private void addArchivePath(String root, String remotePath, Map<String, String> filesByArchivePath) {
        String normalizedRoot = normalizePath(root);
        String normalizedPath = normalizePath(remotePath);
        String archivePath;
        if (normalizedPath.equals(normalizedRoot)) {
            archivePath = leafName(normalizedPath);
        } else if (normalizedPath.startsWith(normalizedRoot + "/")) {
            archivePath = normalizedPath.substring(normalizedRoot.length() + 1);
        } else {
            archivePath = leafName(normalizedPath);
        }
        if (!StringUtils.hasText(archivePath)) {
            archivePath = "file-" + Instant.now().toEpochMilli();
        }
        filesByArchivePath.putIfAbsent(archivePath, normalizedPath);
    }

    private long copyToRemoteTemp(SftpClient sftp, String targetPath, InputStream inputStream) throws IOException {
        long copied = 0L;
        try (OutputStream outputStream = sftp.write(targetPath,
            SftpClient.OpenMode.Create,
            SftpClient.OpenMode.Truncate,
            SftpClient.OpenMode.Write)) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = inputStream.read(buffer)) != -1) {
                if (read <= 0) {
                    continue;
                }
                outputStream.write(buffer, 0, read);
                copied += read;
            }
            outputStream.flush();
        } catch (IOException ex) {
            safeRemove(sftp, targetPath);
            throw ex;
        }
        return copied;
    }

    private void moveRemote(SftpClient sftp, String source, String target, boolean overwrite) throws IOException {
        if (overwrite && exists(sftp, target)) {
            sftp.remove(target);
        }
        sftp.rename(source, target);
    }

    private String resolveUploadDestination(SftpClient sftp, String directory, String fileName, UploadConflictPolicy policy) throws IOException {
        String base = normalizePath(directory + "/" + fileName);
        if (!exists(sftp, base)) {
            return base;
        }
        if (policy == UploadConflictPolicy.OVERWRITE) {
            return base;
        }
        if (policy == UploadConflictPolicy.REJECT) {
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
            String candidate = normalizePath(directory + "/" + candidateName);
            if (!exists(sftp, candidate)) {
                return candidate;
            }
            suffix += 1;
        }
    }

    private String resolveExistingDirectory(SftpClient sftp, String root, String path) throws IOException {
        String target = resolveExistingPath(sftp, root, path);
        Attributes attributes = safeStat(sftp, target);
        if (!attributes.isDirectory()) {
            throw new FileTransferBadRequestException("path must be a directory");
        }
        return target;
    }

    private String resolveExistingFile(SftpClient sftp, String root, String path) throws IOException {
        String target = resolveExistingPath(sftp, root, path);
        Attributes attributes = safeStat(sftp, target);
        if (!attributes.isRegularFile()) {
            throw new FileTransferBadRequestException("path must be a file");
        }
        return target;
    }

    private String resolveExistingPath(SftpClient sftp, String root, String path) throws IOException {
        String candidate = resolveRequestedPath(root, path);
        String canonical = canonicalize(sftp, candidate);
        ensureInsideRoot(root, canonical);
        if (!exists(sftp, canonical)) {
            throw new FileTransferNotFoundException("path not found");
        }
        return canonical;
    }

    private String resolveRequestedPath(String root, String path) {
        if (!StringUtils.hasText(path)) {
            return normalizePath(root);
        }
        String raw = path.trim();
        if (raw.startsWith("/")) {
            return normalizePath(raw);
        }
        return normalizePath(root + "/" + raw);
    }

    private String resolveRootPath(SftpClient sftp) throws IOException {
        String root = canonicalize(sftp, configuredRoot);
        if (!exists(sftp, root)) {
            throw new FileTransferNotFoundException("remote root not found: " + configuredRoot);
        }
        Attributes attrs = safeStat(sftp, root);
        if (!attrs.isDirectory()) {
            throw new FileTransferBadRequestException("remote root is not a directory");
        }
        return root;
    }

    private String resolveParentPath(String root, String target) {
        String normalizedRoot = normalizePath(root);
        String normalizedTarget = normalizePath(target);
        if (normalizedTarget.equals(normalizedRoot)) {
            return null;
        }
        int idx = normalizedTarget.lastIndexOf('/');
        if (idx <= 0) {
            return null;
        }
        String parent = normalizedTarget.substring(0, idx);
        return parent.startsWith(normalizedRoot) ? parent : null;
    }

    private FileTreeEntryResponse toTreeEntry(String name, String path, Attributes attributes) {
        boolean directory = attributes.isDirectory();
        long size = directory ? 0L : Math.max(0L, attributes.getSize());
        long mtime = toEpochMillis(attributes);
        return new FileTreeEntryResponse(
            name,
            path,
            directory ? FileEntryType.DIRECTORY : FileEntryType.FILE,
            size,
            mtime,
            true,
            true
        );
    }

    private long toEpochMillis(Attributes attributes) {
        if (attributes == null) {
            return 0L;
        }
        Object value = attributes.getModifyTime();
        if (value instanceof FileTime fileTime) {
            return fileTime.toMillis();
        }
        if (value instanceof Number number) {
            return number.longValue();
        }
        return 0L;
    }

    private Iterable<DirEntry> safeReadDir(SftpClient sftp, String path) throws IOException {
        return Objects.requireNonNullElseGet(sftp.readDir(path), List::of);
    }

    private Attributes safeStat(SftpClient sftp, String path) throws IOException {
        return sftp.stat(path);
    }

    private String canonicalize(SftpClient sftp, String path) throws IOException {
        String normalized = normalizePath(path);
        try {
            String canonical = sftp.canonicalPath(normalized);
            return normalizePath(canonical);
        } catch (IOException ex) {
            // If canonicalization fails for non-existing path, keep normalized candidate.
            if (sftpStatus(ex) == SftpConstants.SSH_FX_NO_SUCH_FILE) {
                return normalized;
            }
            throw ex;
        }
    }

    private void ensureInsideRoot(String root, String path) {
        String normalizedRoot = normalizePath(root);
        String normalizedPath = normalizePath(path);
        if (normalizedPath.equals(normalizedRoot)) {
            return;
        }
        if (!normalizedPath.startsWith(normalizedRoot + "/")) {
            throw new FileTransferForbiddenException("path is outside of allowed root");
        }
    }

    private boolean exists(SftpClient sftp, String path) {
        try {
            sftp.stat(path);
            return true;
        } catch (IOException ignored) {
            return false;
        }
    }

    private int sftpStatus(IOException ex) {
        Throwable cursor = ex;
        while (cursor != null) {
            if (cursor instanceof org.apache.sshd.sftp.common.SftpException sftpException) {
                return sftpException.getStatus();
            }
            cursor = cursor.getCause();
        }
        return -1;
    }

    private String normalizePath(String path) {
        if (!StringUtils.hasText(path)) {
            return ".";
        }
        String source = path.replace('\\', '/').trim();
        boolean absolute = source.startsWith("/");

        String[] parts = source.split("/");
        List<String> stack = new ArrayList<>();
        for (String part : parts) {
            if (!StringUtils.hasText(part) || ".".equals(part)) {
                continue;
            }
            if ("..".equals(part)) {
                if (!stack.isEmpty()) {
                    stack.remove(stack.size() - 1);
                }
                continue;
            }
            stack.add(part);
        }

        String joined = String.join("/", stack);
        if (absolute) {
            return "/" + joined;
        }
        return StringUtils.hasText(joined) ? joined : ".";
    }

    private String leafName(String path) {
        String normalized = normalizePath(path);
        int idx = normalized.lastIndexOf('/');
        if (idx < 0) {
            return normalized;
        }
        return idx + 1 < normalized.length() ? normalized.substring(idx + 1) : normalized;
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

    private ResolvedSshCredential resolveCredential() {
        if (sshBinding == null) {
            throw new FileTransferBadRequestException("missing SSH file binding");
        }
        return sshCredentialStore.resolveCredential(
            sshBinding.credentialId(),
            sshBinding.host(),
            sshBinding.port(),
            sshBinding.username(),
            null
        );
    }

    private void safeRemove(SftpClient sftp, String path) {
        try {
            if (exists(sftp, path)) {
                sftp.remove(path);
            }
        } catch (IOException ignored) {
        }
    }

    private void closeQuietly(AutoCloseable... closeables) {
        for (AutoCloseable closeable : closeables) {
            if (closeable == null) {
                continue;
            }
            try {
                closeable.close();
            } catch (Exception ignored) {
            }
        }
    }
}

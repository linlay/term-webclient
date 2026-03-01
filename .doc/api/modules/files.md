# 文件传输模块 API（files）

## 覆盖范围
完整路径：

- `GET /sessions/{sessionId}/files/tree`
- `POST /sessions/{sessionId}/files/upload` (multipart/form-data)
- `HEAD /sessions/{sessionId}/files/download`
- `GET /sessions/{sessionId}/files/download`
- `POST /sessions/{sessionId}/files/download-archive`
- `GET /sessions/{sessionId}/files/download-archive?ticket=...`
- `POST /sessions/{sessionId}/files/mkdir`
- `POST /sessions/{sessionId}/files/download-ticket`

## 安全与作用域
- 绑定到会话：操作路径受 `FileSessionBinding.rootPath` 约束
- LOCAL_PTY 使用 `LocalFileGateway`
- SSH_SHELL 使用 `SftpFileGateway`

## GET /tree
参数：`path?`

响应：
```json
{ "currentPath":"...", "parentPath":"...|null", "entries":[...] }
```

`entries[]` 字段：`name/path/type/size/mtime/readable/writable`

## POST /upload
- `targetPath?`
- `conflictPolicy?` (`overwrite|rename|reject`，默认 `rename`)
- `files` 多文件

响应：`FileUploadResponse`
- `results[]`: `fileName/status/savedPath/size/error`

失败：
- `400` 参数问题
- `413` 超出 `max-upload-file-bytes` 或 `max-upload-request-bytes`
- `403` 文件传输被禁用或越权路径

## HEAD/GET /download
参数：
- 直连模式：`path`
- 票据模式：`ticket`

行为：
- `HEAD` 只返回下载头（文件名、长度）
- `GET` 返回文件流
- 响应头含 `Content-Disposition: attachment`

## POST/GET /download-archive
- `POST`：请求体 `{ paths: string[], archiveName?: string }`
- `GET`：通过 ticket 下载归档
- 输出：`application/zip`

## POST /mkdir
请求体：`{ parentPath, name }`
响应：`{ createdPath, created }`

## POST /download-ticket
请求体：
```json
{ "mode":"single|archive", "path":"...", "paths":["..."], "archiveName":"..." }
```

响应（201）：
```json
{ "ticket":"...", "downloadUrl":"/term/api/...", "expiresAt":"ISO-8601" }
```

ticket 语义：
- 一次性消费
- 默认 TTL 60 秒（`terminal.files.download-ticket-ttl-seconds`）
- 校验 `sessionId` + `mode` + `actor`

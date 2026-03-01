# 会话模块 API（sessions）

## 覆盖范围
- `POST /sessions`
- `GET /sessions`
- `DELETE /sessions/{sessionId}`
- `GET /sessions/{sessionId}/snapshot?afterSeq=`
- `GET /sessions/{sessionId}/transcript?afterSeq=&stripAnsi=`
- `GET /sessions/{sessionId}/screen-text`
- `GET /sessions/{sessionId}/context?commandLimit=&eventLimit=`

> 真实前缀：`/webapi` 与 `/appapi`；前端通过 `/term/api` 与 `/appterm/api`。

## POST /sessions
功能：创建 LOCAL_PTY 或 SSH_SHELL 会话。

请求体（`CreateSessionRequest`）：
- `sessionType?: "LOCAL_PTY" | "SSH_SHELL"`（默认 LOCAL_PTY）
- `clientId?`, `tabTitle?`, `toolId?`, `command?`, `args?`, `workdir?`, `cols?`, `rows?`
- `ssh?`: `{ credentialId?, host?, port?, username?, term? }`

响应（201）：
```json
{ "sessionId": "uuid", "wsUrl": "/ws/uuid", "startedAt": "ISO-8601" }
```

失败：
- `400` 参数非法（如 cols/rows 超限）
- `404` SSH 凭据不存在
- `500` 创建运行时失败

## GET /sessions
功能：列出现存会话标签视图。

响应（200）：`SessionTabViewResponse[]`
关键字段：
- `sessionId`, `title`, `sessionType`, `toolId`, `workdir`, `fileRootPath`, `startedAt`, `wsUrl`, `connectionState`

## DELETE /sessions/{sessionId}
功能：关闭会话并释放资源。

响应：`204 No Content`

## GET /sessions/{id}/snapshot
参数：`afterSeq`（默认 0）

响应（`SessionSnapshotResponse`）：
- `sessionId`, `fromSeq`, `toSeq`, `chunks[]`, `truncated`
- `chunks[].data` 当前为文本内容（UTF-8）

语义：
- 当 `truncated=true` 表示 `afterSeq` 太旧，ring buffer 已滚动。

## GET /sessions/{id}/transcript
参数：
- `afterSeq` 默认 0
- `stripAnsi` 默认 false

响应（`TranscriptResponse`）：
- `sessionId`, `fromSeq`, `toSeq`, `chunkCount`, `truncated`, `ansiStripped`, `transcript`

## GET /sessions/{id}/screen-text
响应（`ScreenTextResponse`）：
- `sessionId`, `lastSeq`, `cols`, `rows`, `text`

## GET /sessions/{id}/context
参数：
- `commandLimit` 默认 100
- `eventLimit` 默认 200

响应（`SessionContextResponse`）：
- `meta`: 会话元状态
- `commands[]`: 命令帧
- `events[]`: 事件流
- `summary`: 摘要文本（当前可为空）

## WS 补发与 API 配合
1. 客户端维护 `lastSeenSeq`
2. WS 重连带 `lastSeenSeq`
3. 收到 `truncated` 消息时调用 `snapshot` 拉齐

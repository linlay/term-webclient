# CLAUDE.md

本文件用于说明当前仓库的实际实现状态、架构设计和使用方法。

## 项目概述

`pty-webclient` 是一个浏览器多标签终端系统，支持：

- 本地进程终端（`pty4j`）
- SSH 交互终端（`SSH Shell`）
- SSH 结构化命令执行（`SSH Exec`）

核心目标是让会话在客户端断线/刷新后可恢复，并能在后端保留 1 小时。

## 当前架构

### 1) 会话层（后端）

- `TerminalSession`：统一会话对象，包含
  - `sessionId`
  - `sessionType`（`LOCAL_PTY` / `SSH_SHELL`）
  - `TerminalRuntime`（运行时抽象）
  - `attachedClients`
  - `nextSeq`
  - `TerminalOutputRingBuffer`
  - `killTask`（detach TTL 回收）
- `TerminalRuntime` 抽象
  - `PtyTerminalRuntime`：本地 PTY
  - `SshShellRuntime`：SSH Shell Channel

### 2) 输出与断线恢复

- 会话读循环持续读取运行时输出（即使没有客户端也不停止）。
- 每段输出都附带递增 `seq` 并写入 ring buffer。
- WebSocket 重连使用 `clientId + lastSeenSeq`：
  - 正常补发：发送 `seq > lastSeenSeq`
  - 缓冲区不足：发送 `truncated`，客户端走 `/snapshot` 补齐
- 所有客户端断开后，会话保留 `terminal.detached-session-ttl-seconds`（默认 3600s），到期销毁。

### 3) SSH 子系统

- 客户端库：Apache MINA SSHD（`terminal.ssh.*` 配置项保持不变）
- `SshCredentialStore`：凭据密文存储（AES-GCM）
- `TofuHostKeyVerifier`：TOFU 主机指纹校验
- `SshConnectionPool`：按 `(host,port,username,credentialId)` 复用连接
- `SshExecService`：每条命令开一个 exec channel，返回结构化结果

## 前端行为

- Tab 状态与会话信息写入 `localStorage`（`pty.tabs.v2`）。
- 页面刷新后自动恢复 tab 并重连旧 session。
- `beforeunload` 不再删除后端会话，只关闭本地 socket。
- 用户主动关闭 tab（`x`）时，才调用 `DELETE /api/sessions/{id}` 销毁会话。
- 新建窗口支持 `ssh` 工具，填写 `SSH Credential ID` 创建 SSH Shell。

## 主要接口

- `POST /api/sessions`
- `DELETE /api/sessions/{sessionId}`
- `GET /api/sessions/{sessionId}/snapshot?afterSeq=<long>`
- `GET /api/workdirTree?path=<optional>`（屏蔽 `.` 前缀隐藏目录）
- `POST /api/ssh/credentials`
- `POST /api/ssh/exec`
- `WS /ws/{sessionId}?clientId=<tabId>&lastSeenSeq=<long>`

## 使用方法

### 1) 保持连接（刷新恢复）

1. 正常创建终端窗口并运行命令。
2. 直接刷新页面。
3. 页面会自动恢复 tab 并尝试重连旧 session。

说明：

- 只要会话没有超过 detach TTL（默认 1 小时），刷新后可以恢复。
- 若看到 `truncated`，前端会自动通过 `/snapshot` 拉取可用片段继续显示。

### 2) 使用 SSH 交互终端

1. 后端环境变量（必填）：

```bash
export TERMINAL_SSH_MASTER_KEY="replace-with-strong-secret"
```

2. 创建 SSH 凭据：

```bash
curl -X POST http://127.0.0.1:11948/api/ssh/credentials \
  -H "content-type: application/json" \
  -d '{"host":"10.0.0.2","port":22,"username":"ubuntu","password":"***"}'
```

3. 在前端点击 `+`，选择 `ssh`，填入返回的 `credentialId`，创建窗口。

### 3) 使用 SSH Exec

```bash
curl -X POST http://127.0.0.1:11948/api/ssh/exec \
  -H "content-type: application/json" \
  -d '{"credentialId":"<id>","command":"pwd","cwd":"/tmp","timeoutSeconds":120}'
```

返回：`stdout/stderr/exitCode/durationMs/timedOut` 等结构化字段。

## 关键配置

- `terminal.detached-session-ttl-seconds`
- `terminal.ring-buffer-max-bytes`
- `terminal.ring-buffer-max-chunks`
- `terminal.ssh.connect-timeout-millis`
- `terminal.ssh.connection-idle-ttl-seconds`
- `terminal.ssh.exec-default-timeout-seconds`
- `terminal.ssh.credentials-file`
- `terminal.ssh.known-hosts-file`
- `terminal.ssh.master-key-env`

## 本地命令

后端：

```bash
cd backend
mvn spring-boot:run
mvn test
```

前端：

```bash
cd frontend
npm run dev
npm run build
```

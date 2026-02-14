# pty-webclient

前后端分离的 PTY Web Terminal：

- 后端：Spring Boot + WebSocket + pty4j + SSHJ
- 前端：Vite + Vanilla JS + xterm.js
- 生产入口：Node 反向代理（`11949`）+ Nginx（`443 -> 11949`）

## 目录

- `backend`：Java 后端服务（会话管理、PTY 进程、WebSocket）
- `frontend`：xterm 前端页面

## 环境要求

- JDK 21+
- Maven 3.9+
- Node.js 20+（建议）

## 后端启动

```bash
cd backend
mvn spring-boot:run
```

默认地址端口：`127.0.0.1:11948`

后端配置文件：`backend/src/main/resources/application.yml`

关键配置：

- `terminal.default-command`：默认命令（默认 `codex`）
- `terminal.default-args`：默认参数列表
- `terminal.default-workdir`：默认工作目录
- `terminal.workdir-browse-root`：前端 workdir 目录树浏览根目录（默认 `${user.home}`）
- `terminal.allowed-origins`：HTTP/WS 允许来源模式（默认 `http://*`,`https://*`）
- `terminal.detached-session-ttl-seconds`：客户端全断开后保留时长（默认 `3600s`）
- `terminal.ring-buffer-max-bytes` / `terminal.ring-buffer-max-chunks`：断线补发缓存窗口
- `terminal.ssh.*`：SSH 连接、Exec 超时、凭据密文文件、TOFU known-hosts 文件等配置
- `TERMINAL_SSH_MASTER_KEY`（环境变量）：SSH 凭据 AES-GCM 加密主密钥（必填）

## 使用说明

### 1) 断线/刷新后保留连接（1 小时）

- 浏览器刷新不会自动删除后端 session；前端会把 tab/session 信息写入 `localStorage`，刷新后自动重连。
- 同一 tab 重连时会带 `lastSeenSeq`，服务端按 ring buffer 进行补发。
- 如果你点击 tab 关闭（`x`），前端会显式调用 `DELETE /api/sessions/{sessionId}`，会话会被销毁。
- 如果所有客户端都断开，后端会保留会话到 `terminal.detached-session-ttl-seconds`（默认 3600 秒），超时后自动回收。

### 2) Web SSH（浏览器交互终端）

1. 先设置后端环境变量（必须）：

```bash
export TERMINAL_SSH_MASTER_KEY="replace-with-a-strong-secret"
```

2. 创建 SSH 凭据（密码或私钥二选一）：

```bash
curl -X POST http://127.0.0.1:11948/api/ssh/credentials \
  -H "content-type: application/json" \
  -d '{
    "host":"10.0.0.2",
    "port":22,
    "username":"ubuntu",
    "password":"***"
  }'
```

返回 `credentialId`。

3. 前端点击 `+` 新建窗口，`Tool` 选择 `ssh`，填写 `SSH Credential ID`，创建后即进入 SSH Shell。

### 3) SSH Exec（给 LLM 的结构化命令执行）

```bash
curl -X POST http://127.0.0.1:11948/api/ssh/exec \
  -H "content-type: application/json" \
  -d '{
    "credentialId":"<credential-id>",
    "command":"uname -a",
    "cwd":"/tmp",
    "timeoutSeconds":120
  }'
```

## 前端开发模式（Vite）

```bash
cd frontend
npm install
npm run dev
```

默认端口：`11949`（已配置 `allowedHosts` 与 `/api`、`/ws` 代理）

前端环境变量文件：`frontend/.env`

```env
VITE_API_BASE=
```

- `VITE_API_BASE`：可选。为空时前端默认使用同源 `/api` 与 `/ws`；有值时强制使用该地址（调试用途）。

## 前端生产模式（Node 代理）

```bash
cd frontend
npm install
npm run build
PORT=11949 BACKEND_ORIGIN=http://127.0.0.1:11948 npm run serve
```

生产代理服务行为：

- 监听 `0.0.0.0:11949`
- 静态资源：`frontend/dist`
- `GET /healthz`：健康检查（返回 `200 ok`）
- `/api/*` 反向代理到 `BACKEND_ORIGIN`
- `/ws/*` WebSocket 反向代理到 `BACKEND_ORIGIN`
- 其余 GET 请求回退到 `index.html`（SPA）

服务环境变量示例：`frontend/.env.server.example`

## Nginx（域名无端口）

Nginx 配置样例：`deploy/nginx/pty.linlay.cc.conf`

职责：

- `80 -> 443` 重定向
- `443` 终止 TLS
- 所有流量反代到 `http://127.0.0.1:11949`
- 透传 WebSocket Upgrade

## API / WS 协议

- `POST /api/sessions`：创建会话（`LOCAL_PTY` 或 `SSH_SHELL`）
- `DELETE /api/sessions/{sessionId}`：关闭会话
- `GET /api/sessions/{sessionId}/snapshot?afterSeq=<long>`：按序号拉取输出快照
- `GET /api/workdirTree?path=<absolutePathOptional>`：列出目录树（仅目录，自动屏蔽 `.` 前缀隐藏目录）
- `POST /api/ssh/credentials`：创建 SSH 凭据（密码或私钥二选一，密文落盘）
- `POST /api/ssh/exec`：执行 SSH 命令（返回 `stdout/stderr/exitCode`）
- `WS /ws/{sessionId}?clientId=<tabId>&lastSeenSeq=<long>`：终端双向通信 + 断线补发

WebSocket 客户端消息：

- `{"type":"input","data":"..."}`
- `{"type":"resize","cols":120,"rows":30}`
- `{"type":"ping"}`

WebSocket 服务端消息：

- `{"type":"output","seq":123,"data":"..."}`
- `{"type":"truncated","requestedAfterSeq":100,"firstAvailableSeq":160,"latestSeq":220}`
- `{"type":"exit","exitCode":0}`
- `{"type":"error","message":"..."}`
- `{"type":"pong"}`

## 架构设计（当前实现）

- `TerminalSession`：统一封装本地 PTY 和 SSH Shell，会话内维护 `attachedClients`、`nextSeq`、`ringBuffer`、`killTask`。
- `TerminalRuntime` 抽象：`PtyTerminalRuntime` / `SshShellRuntime` 通过同一读写接口被 `TerminalSessionService` 管理。
- 输出链路：运行时输出 -> `seq++` -> ring buffer -> fanout 到在线 WS 客户端。
- 断线补发：客户端重连携带 `lastSeenSeq`，服务端补发 `seq > lastSeenSeq`；缓存不足时发送 `truncated`，客户端再拉 `/snapshot`。
- SSH 连接复用：`SshConnectionPool` 按 `(host,port,username,credentialId)` 复用连接，空闲 TTL 默认 1 小时。
- SSH 安全：`TofuHostKeyVerifier` 首次信任写入 known-hosts，后续强校验；凭据通过 `SshCredentialStore` 采用 AES-GCM 密文存储。

## 测试与构建

后端测试：

```bash
cd backend
mvn test
```

前端构建：

```bash
cd frontend
npm run build
```

生产连通性检查：

```bash
curl http://127.0.0.1:11949/healthz
curl -I https://pty.linlay.cc
```

# pty-webclient

前后端分离的 PTY Web Terminal：

- 后端：Spring Boot + WebSocket + pty4j + Apache MINA SSHD client
- 前端：Vite + React/TypeScript（迁移中，保留 Vanilla JS legacy 模式）+ xterm.js
- 生产入口：Node 反向代理（`11949`）+ Nginx（`443 -> 11949`）
- 运维脚本：`package.sh` / `start.sh` / `stop.sh`

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

后端配置文件：

- 内置默认：`backend/src/main/resources/application.yml`
- 外层覆盖：`backend/application.yml`（优先于内置默认；发布目录同路径）

关键配置：

- `terminal.default-command`：默认命令（默认 `codex`）
- `terminal.default-args`：默认参数列表
- `terminal.default-workdir`：默认工作目录
- `terminal.workdir-browse-root`：前端 workdir 目录树浏览根目录（默认 `${user.home}`）
- `terminal.allowed-origins`：HTTP/WS 允许来源模式（默认 `http://*`,`https://*`）
- `terminal.detached-session-ttl-seconds`：客户端全断开后保留时长（默认 `3600s`）
- `terminal.ring-buffer-max-bytes` / `terminal.ring-buffer-max-chunks`：断线补发缓存窗口
- `terminal.ssh.credentials-file`：SSH 凭据密文文件（默认 `backend/data/ssh-credentials.json`）
- `terminal.ssh.master-key`：本地开发可用的主密钥明文配置（建议仅本地使用）
- `terminal.ssh.master-key-env`：生产主密钥环境变量名（默认 `TERMINAL_SSH_MASTER_KEY`）
- `terminal.app-auth.enabled`：是否启用 `/appapi/**` token 鉴权
- `terminal.app-auth.local-public-key`：本地 PEM 公钥（优先于 JWKS）
- `terminal.app-auth.jwks-uri`：JWKS 地址（仅在未配置本地公钥时使用）
- `terminal.app-auth.issuer`：期望 issuer（配置后强校验）
- `terminal.app-auth.audience`：可选 audience（配置后校验）
- `terminal.app-auth.jwks-cache-seconds`：JWKS 缓存秒数
- `terminal.app-auth.clock-skew-seconds`：exp/nbf 时钟偏移容忍

## 使用说明

### 1) 登录认证（强制）

- 默认开启登录（访问 `http://localhost:11949/term` 时必须先登录）。
- 当前默认账号密码：`admin / Admin@123`。
- 密码哈希优先使用 `terminal.auth.password-hash-bcrypt`（推荐），兼容读取旧字段 `terminal.auth.password-hash`（MD5，迁移期保留）。
- 默认仍兼容 MD5（示例：`0e7517141fb53f21ee439b355b5a1d0a` 对应 `Admin@123`）。
- 登录接口启用最小限流（默认 60 秒窗口最多 10 次失败尝试）。
- 登录态基于服务端 `HttpSession` 保持；只在 Session 过期（或显式 Logout）后才需要重新登录。

### 1.1) App Token 认证

- `http://localhost:11949/appterm` 使用 `Bearer access token` 访问 `/appapi/**`。
- App 通过 React Native WebView bridge 提供 token（事件：`appterm:token`，请求：`appterm:refresh-token`）。
- 当前端请求返回 `401` 时，页面会向 App 请求新 token，并自动重放一次请求。
- 后端支持 `local-public-key` 优先验签；未配置本地公钥时回退到 `jwks-uri`。

MD5 生成示例：

macOS:

```bash
printf '%s' 'your-password' | md5
```

Linux:

```bash
printf '%s' 'your-password' | md5sum | awk '{print $1}'
```

### 2) 断线/刷新后保留连接（1 小时）

- 浏览器刷新不会自动删除后端 session；前端会把 tab/session 信息写入 `localStorage`，刷新后自动重连。
- 同一 tab 重连时会带 `lastSeenSeq`，服务端按 ring buffer 进行补发。
- WebSocket 断开会自动重连；若 Session 已过期，才会回到登录态。
- 如果你点击 tab 关闭（`x`），前端会显式调用 `DELETE /webapi/sessions/{sessionId}`，会话会被销毁。
- 如果所有客户端都断开，后端会保留会话到 `terminal.detached-session-ttl-seconds`（默认 3600 秒），超时后自动回收。

### 3) Web SSH（浏览器交互终端）

SSH 客户端实现基于 Apache MINA SSHD，现有 `terminal.ssh.*` 配置项保持不变。

1. 生产环境：在部署层注入环境变量（示例）：

```bash
export TERMINAL_SSH_MASTER_KEY="replace-with-a-strong-secret"
```

本地开发也可在 `backend/application.yml` 使用 `terminal.ssh.master-key`，默认会自动加载：

```bash
cd backend
mvn spring-boot:run
```

2. 创建 SSH 凭据（密码或私钥二选一）：

```bash
curl -X POST http://127.0.0.1:11948/webapi/ssh/credentials \
  -H "content-type: application/json" \
  -d '{
    "host":"10.0.0.2",
    "port":22,
    "username":"ubuntu",
    "password":"***"
  }'
```

返回 `credentialId`。也可用列表接口查看：

```bash
curl http://127.0.0.1:11948/webapi/ssh/credentials
```

3. 前端点击 `+` 新建窗口，`Tool` 选择 `ssh`，从已保存配置列表选择（或先新增），创建后即进入 SSH Shell。
4. 已保存 SSH 配置支持删除（`Delete` 按钮，带二次确认）。

### 4) Copilot 侧栏（Summary + Agent）

- 顶部 `Copilot` 按钮打开右侧栏，支持 `Summary` / `Agent` 切换。
- `Summary` 支持实时刷新（默认 2 秒，可通过 `VITE_COPILOT_REFRESH_MS` 配置），展示 `Context + Screen Text`，可一键复制当前可见界面的纯文本。
- `Agent` 保留原有 run 创建、审批、终止和 quick command 操作。

### 5) SSH Exec（给 LLM 的结构化命令执行）

```bash
curl -X POST http://127.0.0.1:11948/webapi/ssh/exec \
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

默认端口：`11949`（已配置 `allowedHosts` 与 `/webapi`、`/appapi`、`/ws` 代理）

前端环境变量文件：`frontend/.env`

```env
VITE_API_BASE=
VITE_UI_MODE=legacy
VITE_COPILOT_REFRESH_MS=2000
```

- `VITE_API_BASE`：可选。为空时前端默认使用同源 `/webapi`、`/appapi` 与 `/ws`；有值时强制使用该地址（调试用途）。
- `VITE_UI_MODE`：`legacy` 或 `react`。默认 `legacy`，用于迁移期灰度切换。
- `VITE_COPILOT_REFRESH_MS`：可选。Copilot 自动刷新间隔毫秒，默认 `2000`，最小 `500`。

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
- `/webapi/*` 反向代理到 `BACKEND_ORIGIN`
- `/appapi/*` 反向代理到 `BACKEND_ORIGIN`
- `/ws/*` WebSocket 反向代理到 `BACKEND_ORIGIN`
- `/` 自动重定向到 `/term`
- 仅 `/term/**` 与 `/appterm/**` 回退到 `index.html`（SPA）

服务环境变量示例：`frontend/.env.server.example`

## 一键打包与启停脚本

根目录提供三个脚本：

- `package.sh`：构建前后端并输出统一发布目录（默认 `release/`）
- `start.sh`：启动发布目录内的后端 jar 与前端 Node 代理
- `stop.sh`：根据 pid 文件停止服务

### 1) 打包

```bash
./package.sh
# 自定义输出目录
./package.sh /tmp/pty-release
```

`package.sh` 默认会：

1. 执行后端构建：`mvn -q -DskipTests package`
2. 执行前端构建：`npm ci && npm run build`
3. 将可运行产物和配置收拢到同一目录：
   - `release/backend/app.jar`
   - `release/backend/application.yml`（若存在）
   - `release/frontend/dist`
   - `release/frontend/server.js`
   - `release/frontend/node_modules`（生产依赖）
   - `release/logs`、`release/run`

### 2) 启动

```bash
./start.sh
# 指定发布目录
./start.sh /tmp/pty-release
```

默认端口：

- 后端：`127.0.0.1:11948`
- 前端：`0.0.0.0:11949`

可通过环境变量覆盖：

- `BACKEND_HOST` / `BACKEND_PORT`（默认读取 `backend/application.yml`，未配置时回退 `127.0.0.1:11948`）
- `FRONTEND_HOST` / `FRONTEND_PORT`
- `BACKEND_ORIGIN`（默认使用后端生效地址拼接）
- `BACKEND_JAVA_OPTS`
- `BACKEND_ARGS`

### 3) 停止

```bash
./stop.sh
# 指定发布目录
./stop.sh /tmp/pty-release
```

## Nginx（域名无端口）

Nginx 配置样例：`deploy/nginx/pty.linlay.cc.conf`

职责：

- `80 -> 443` 重定向
- `443` 终止 TLS
- 所有流量反代到 `http://127.0.0.1:11949`
- 透传 WebSocket Upgrade

## API / WS 协议

- `webapi`（Web Session）与 `appapi`（App Token）业务接口保持同构：
- `POST /webapi/sessions` / `POST /appapi/sessions`
- `DELETE /webapi/sessions/{sessionId}` / `DELETE /appapi/sessions/{sessionId}`
- `GET /webapi/workdirTree` / `GET /appapi/workdirTree`
- `GET /webapi/ssh/credentials` / `GET /appapi/ssh/credentials`
- `GET /webapi/version` / `GET /appapi/version`
- `webapi` 登录接口：
- `POST /webapi/auth/login`
- `GET /webapi/auth/me`
- `POST /webapi/auth/logout`
- `appapi` 鉴权接口：
- `GET /appapi/auth/me`
- `WS /ws/{sessionId}?clientId=<tabId>&lastSeenSeq=<long>&accessToken=<optional>`：终端双向通信 + 断线补发；支持 session 或 token 握手鉴权

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

前端检查与构建：

```bash
cd frontend
npm run lint
npm run typecheck
npm run test
npm run build
```

生产连通性检查：

```bash
curl http://127.0.0.1:11949/healthz
curl -I https://pty.linlay.cc
```

更多交付文档：

- 架构说明：`docs/architecture.md`
- 发布与回滚：`docs/release.md`

# term-webclient

浏览器多标签终端系统，支持本地 PTY 和 SSH Shell，断线自动恢复。

- 后端：Spring Boot + WebSocket + pty4j + Apache SSHD
- 前端：Vite + React + TypeScript + xterm.js
- 生产部署：Node 反向代理（`11947`）→ 后端（`11946`）

## 环境要求

- JDK 21+
- Maven 3.9+
- Node.js 20+

## 快速开始

### 本地开发

后端和前端分别启动：

```bash
# 终端 1：启动后端（127.0.0.1:11946）
cd backend
mvn spring-boot:run

# 终端 2：启动前端（localhost:11947，自动代理到后端）
cd frontend
npm install
npm run dev
```

访问 `http://localhost:11947/term/`（Web）或 `http://localhost:11947/appterm/`（App WebView）。

### 一键打包部署

```bash
# 构建
./package.sh

# 启动
./start.sh

# 停止
./stop.sh
```

默认端口：后端 `127.0.0.1:11946`，前端 `0.0.0.0:11947`。

## 配置

### 后端配置

配置文件加载顺序（后者覆盖前者）：

1. `backend/src/main/resources/application.yml`（内置默认）
2. `backend/application.yml`（外部覆盖，通过 `spring.config.import` 导入）

关键配置项：

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `terminal.default-command` | `codex` | 默认终端命令 |
| `terminal.workdir-browse-root` | `${user.home}` | 目录浏览根路径 |
| `terminal.allowed-origins` | `http://*,https://*` | CORS 允许来源 |
| `terminal.detached-session-ttl-seconds` | `3600` | 断开后会话保留时长（秒） |
| `terminal.ring-buffer-max-bytes` | `4194304` | 输出缓冲大小（4MB） |
| `auth.enabled` | `true` | 是否启用密码认证 |
| `auth.username` | `admin` | 登录用户名 |
| `auth.password-hash-bcrypt` | 空 | bcrypt 密码哈希 |
| `terminal.ssh.enabled` | `true` | 是否启用 SSH 功能 |
| `terminal.ssh.master-key-env` | `TERMINAL_SSH_MASTER_KEY` | SSH 凭据加密主密钥的环境变量名 |

### 前端环境变量

文件 `frontend/.env`：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `VITE_API_BASE` | 空（同源） | API 基础地址，为空时使用同源路径 |
| `VITE_COPILOT_REFRESH_MS` | `2000` | Copilot 自动刷新间隔（毫秒） |
| `VITE_DEV_PROXY_TARGET` | `http://127.0.0.1:11946` | 开发模式代理目标 |

### 启动脚本环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `APP_ENV` | `production` | 环境（`development` / `production`） |
| `BACKEND_HOST` | 从 `application.yml` 读取 | 后端监听地址 |
| `BACKEND_PORT` | 从 `application.yml` 读取 | 后端监听端口 |
| `FRONTEND_HOST` | `0.0.0.0` | 前端监听地址 |
| `FRONTEND_PORT` | `11947` | 前端监听端口 |
| `BACKEND_ORIGIN` | 自动拼接 | 前端代理的后端地址 |
| `BACKEND_JAVA_OPTS` | `-Xms256m -Xmx512m` | JVM 参数 |
| `BACKEND_ARGS` | 空 | 附加 Spring 启动参数 |
| `TERMINAL_SSH_MASTER_KEY` | - | SSH 凭据加密主密钥 |

`start.sh` 会自动加载发布目录下的 `.env.$APP_ENV` 文件（若存在），显式环境变量优先。

## 认证

### Web 登录（/term）

访问 `/term/` 时需要用户名密码登录。

**设置密码（bcrypt，推荐）**：

```bash
# macOS
htpasswd -nbBC 10 '' 'your-password' | cut -d: -f2

# 或使用 Python
python3 -c "import bcrypt; print(bcrypt.hashpw(b'your-password', bcrypt.gensalt(10)).decode())"
```

将生成的哈希写入 `backend/application.yml`：

```yaml
auth:
  enabled: true
  username: admin
  password-hash-bcrypt: "$2b$10$..."
```
当前的默认密码是 password

登录限流：默认 60 秒窗口内最多 10 次失败尝试（按 IP + 用户名）。

### App Token 认证（/appterm）

访问 `/appterm/` 时使用 JWT Bearer Token（适用于嵌入 WebView 场景）。

- App 通过 React Native WebView bridge 提供 token（消息：`auth_token`，请求：`auth_refresh_request`，回包：`auth_refresh_result`）
- 401 时自动向 App 请求新 token 并重放请求
- 后端支持 `local-public-key` 优先验签，未配置时回退到 `jwks-uri`

```yaml
app-auth:
  enabled: true
  local-public-key: "MIIBIj..."    # RSA 公钥（优先）
  jwks-uri: "https://..."           # JWKS 端点（备用）
  issuer: "your-issuer"
  audience: "your-audience"
```

## 功能说明

### URL 参数控制会话

`/term/` 与 `/appterm/` 都支持通过 URL 参数控制会话：

- `sessionId=<uuid>`：切换到对应 session 的 tab（若该 session 已存在）。
- `openNewSession=1` 或 `openNewSession=true`：打开「新建会话」弹窗（用户手动 create/cancel）。
- `openNonce=<any>`：兼容保留字段，可选，不再作为触发前置条件。

示例：

```text
/term/?sessionId=<uuid>
/appterm/?openNewSession=1
/term/?sessionId=<uuid>&openNewSession=1
```

行为规则：

- `sessionId` 与 `openNewSession` 可以同时存在，并且同时生效。
- 用户切换 tab 时，URL 中 `sessionId` 会同步为当前激活会话。
- 新建弹窗关闭（create 或 cancel）后，`openNewSession` 与 `openNonce` 会自动清理。
- 若通过 `/term` 或 `/appterm`（无尾斜杠）访问，服务端会在补全为 `/term/`、`/appterm/` 时保留原 query 参数。

### 断线恢复

- 浏览器刷新/断网不会销毁后端会话
- 前端重连时携带 `lastSeenSeq`，服务端自动补发缺失输出
- 全部客户端断开后，会话默认保留 1 小时（`detached-session-ttl-seconds`）
- 点击标签页关闭按钮会显式销毁会话

### SSH Shell

1. 设置 SSH 主密钥（生产环境用环境变量）：

```bash
export TERMINAL_SSH_MASTER_KEY="replace-with-a-strong-secret"
```

本地开发可在 `backend/application.yml` 中配置 `terminal.ssh.master-key`。

2. 创建 SSH 凭据（密码或私钥二选一）：

```bash
curl -X POST http://127.0.0.1:11947/term/api/ssh/credentials \
  -H "content-type: application/json" \
  -d '{
    "host": "10.0.0.2",
    "port": 22,
    "username": "ubuntu",
    "password": "***"
  }'
```

3. 前端「新建会话」选择 SSH_SHELL，从已保存配置中选择即可。

### SSH Exec（结构化命令执行）

```bash
curl -X POST http://127.0.0.1:11947/term/api/ssh/exec \
  -H "content-type: application/json" \
  -d '{
    "credentialId": "<credential-id>",
    "command": "uname -a",
    "cwd": "/tmp",
    "timeoutSeconds": 120
  }'
```

### Copilot 侧栏

点击顶部 Copilot 按钮打开右侧栏：

- **Summary**：实时显示会话上下文（Context + Screen Text），默认 2 秒刷新，可一键复制
- **Agent**：创建 Agent Run、审批高风险步骤、中止运行、Quick Command 发送

### CLI 客户端配置

在 `backend/application.yml` 中注册多个终端工具：

```yaml
terminal:
  cli-clients:
    - id: codex
      label: Codex
      command: codex
      args: []
      workdir: .
      env: {}
      pre-commands:
        - export https_proxy="http://127.0.0.1:8001"
      shell: /bin/zsh
    - id: claude
      label: Claude Code
      command: claude
      args: []
      workdir: .
      shell: /bin/zsh
```

新建会话时可选择不同的 CLI 客户端。

## 打包与部署

### 打包

```bash
# 默认输出到 release/
./package.sh

# 自定义输出目录
./package.sh /tmp/term-release

# 指定环境
APP_ENV=development ./package.sh /tmp/term-release-dev
```

打包产物结构：

```
release/
├── backend/
│   ├── app.jar
│   └── application.yml
├── frontend/
│   ├── dist/
│   ├── server.js
│   ├── node_modules/
│   ├── package.json
│   └── package-lock.json
├── logs/
├── run/
├── start.sh
└── stop.sh
```

### 启动

```bash
./start.sh
# 或指定目录和环境
APP_ENV=production ./start.sh /tmp/term-release
```

### 停止

```bash
./stop.sh
# 或指定目录
./stop.sh /tmp/term-release
```

### Nginx 反向代理

Nginx 反向代理职责：

- `80 → 443` 重定向
- `443` TLS 终止
- 所有流量反代到 `http://127.0.0.1:11947`
- 透传 WebSocket Upgrade

## 测试与验证

```bash
# 后端测试
cd backend && mvn test

# 前端检查
cd frontend
npm run lint          # ESLint
npx tsc --noEmit      # TypeScript 类型检查
npm run build         # 生产构建

# 健康检查
curl http://127.0.0.1:11947/healthz
```

### 前端生产代理

`server.js` 路由规则：

| 路径 | 行为 |
|---|---|
| `/healthz` | 返回 200 OK |
| `/term/api/*`、`/appterm/api/*` | HTTP 反向代理到后端（分别 rewrite 到 `/webapi/*`、`/appapi/*`） |
| `/term/ws/*`、`/appterm/ws/*` | WebSocket 反向代理到后端（rewrite 到 `/ws/*`） |
| `/term/assets/*`、`/appterm/assets/*` | 返回静态资源（`dist/assets`） |
| `/term/`、`/appterm/` | 返回 `index.html`（SPA 入口） |

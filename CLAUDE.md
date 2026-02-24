# CLAUDE.md

本文件面向 AI Agent / 开发者，描述项目架构、目录结构、API 定义和关键设计决策。操作手册见 `README.md`。

## 项目概述

`term-webclient` 是浏览器多标签终端系统。

- **后端**：Spring Boot 3.3.8 / Java 21 / Maven
- **前端**：React 18 + TypeScript / Vite / Zustand / xterm.js
- **前端代理**：Express.js（生产环境反向代理后端）
- **会话类型**：`LOCAL_PTY`（pty4j）、`SSH_SHELL`（Apache SSHD）
- **核心特性**：断线后会话保留（默认 1 小时），基于 `seq` + ring buffer 的输出补发

## 目录结构

```
term-webclient/
├── backend/
│   ├── src/main/java/com/linlay/termjava/
│   │   ├── TerminalApplication.java          # Spring Boot 入口
│   │   ├── auth/                             # 认证（Web Session + JWT）
│   │   ├── config/                           # Spring 配置类
│   │   ├── controller/                       # REST 控制器
│   │   ├── model/                            # DTO / 领域模型
│   │   ├── service/                          # 业务逻辑
│   │   └── ws/                               # WebSocket 处理
│   ├── src/main/resources/application.yml    # 内置默认配置
│   ├── application.yml                       # 外部覆盖配置（import）
│   └── pom.xml
├── frontend/
│   ├── src/react/
│   │   ├── main.tsx                          # React 入口
│   │   ├── App.tsx                           # 根组件
│   │   ├── features/                         # 按功能划分的模块
│   │   │   ├── auth/                         # LoginForm, useAuth
│   │   │   ├── layout/                       # TabBar, CopilotSidebar, Modal 等
│   │   │   ├── session/                      # NewSessionForm
│   │   │   ├── tabs/                         # useTabsStore (Zustand)
│   │   │   └── terminal/                     # TerminalPane, snapshot
│   │   └── shared/                           # 跨功能共享
│   │       ├── api/                          # client.ts (API 客户端), types.ts
│   │       ├── auth/                         # appBridge.ts (JWT token 桥接)
│   │       ├── config/                       # env.ts (环境检测)
│   │       ├── hooks/                        # 通用 hooks
│   │       ├── terminal/                     # quickCommand.ts
│   │       └── utils/                        # id.ts (统一 ID 生成)
│   ├── server.js                             # Express 生产代理服务
│   ├── index.html
│   ├── vite.config.ts
│   └── .env                                  # Vite 环境变量
├── package.sh                                # 构建脚本
├── start.sh                                  # 启动脚本
└── stop.sh                                   # 停止脚本
```

## 后端架构

### 会话生命周期

```
创建会话 ──→ 启动 TerminalRuntime ──→ 读循环(seq++写入 RingBuffer)
                                            │
                                            ├──→ WS 客户端在线：实时推送
                                            └──→ WS 客户端离线：缓存在 RingBuffer
                                                    │
                          重连(lastSeenSeq) ←───────┘
                                                    │
                          全部断开 ──→ detached TTL 到期 ──→ 回收
```

### 核心类

| 类 | 职责 |
|---|---|
| `TerminalSessionService` | 会话 CRUD、生命周期管理、读循环 |
| `TerminalSession` | 单个会话：runtime + ringBuffer + attachedClients |
| `TerminalRuntime` | 运行时抽象接口 |
| `PtyTerminalRuntime` | 本地 PTY 实现（pty4j） |
| `SshShellRuntime` | SSH Shell 实现 |
| `TerminalOutputRingBuffer` | 环形缓冲，支持 seq 范围查询 |
| `SessionContextTracker` | 跟踪命令帧、事件、元状态 |
| `TerminalScreenTextTracker` | 维护当前屏幕文本快照 |

### 认证

| 模式 | 路径前缀 | 机制 |
|---|---|---|
| Web（浏览器） | `/webapi/**` | HttpSession cookie，bcrypt 密码校验 |
| App（嵌入端） | `/appapi/**` | Bearer JWT，JWKS 或本地公钥验签 |
| WebSocket | `/ws/**` | 握手时校验 Session 或 accessToken 参数 |

相关类：`AuthService`、`AppTokenService`、`LoginRateLimiter`、`WsAuthHandshakeInterceptor`

### SSH 子系统

| 类 | 职责 |
|---|---|
| `SshCredentialStore` | 凭据加密存储（AES-256-GCM），CRUD |
| `SshConnectionPool` | 按 (host, port, username, credentialId) 复用连接 |
| `SshExecService` | 结构化命令执行（非交互） |
| `SshPreflightService` | 连接测试 |
| `TofuHostKeyVerifier` | Trust-on-first-use 主机密钥验证 |

### Agent 子系统

当前为 Mock 实现（`MockAgentPlanner`），预留 LLM 对接扩展点（`AgentPlanner` 接口）。

| 类 | 职责 |
|---|---|
| `AgentPlanner` | 步骤规划接口（将来对接 LLM） |
| `MockAgentPlanner` | 基于指令前缀的确定性规划（cmd:/command:/input:） |
| `AgentRunService` | 运行生命周期（创建→审批→执行→完成/失败/中止） |
| `AgentToolExecutor` | 工具执行器 |

运行状态流转：`DRAFTED → WAITING_APPROVAL → EXECUTING_STEP → COMPLETED / FAILED / ABORTED`

## 前端架构

### 状态管理

- **Zustand** (`useTabsStore`)：标签页列表、活动标签、连接状态
- **TanStack Query**：API 数据获取（sessions 列表轮询 2s、auth 状态）
- **自定义 Hooks**：`useCopilotState`（Agent/Summary 状态）、`useViewportHeight`（移动端视口）、`useMobileScroll`、`useNotice`

### 组件树

```
App
├── TabBar                    # 标签栏 + 新建按钮
├── TerminalPane[]            # xterm.js 终端实例（每标签一个）
├── CopilotSidebar            # Summary / Agent 侧栏
├── MobileShortcutBar         # 移动端快捷键栏
├── NewWindowModal            # 新建会话弹窗 → NewSessionForm
├── TabContextMenu            # 标签右键菜单
├── CloseTabConfirmModal      # 关闭确认弹窗
└── LoginForm                 # 登录表单（未认证时显示）
```

### 双入口路由

| 路径 | 认证模式 | API 前缀 |
|---|---|---|
| `/term` | Web Session（cookie） | `/webapi/*` |
| `/appterm` | JWT Bearer Token | `/appapi/*` |

前端 `server.js` 负责路由分发，`/` 重定向到 `/term`。

## REST API 定义

所有业务接口同时挂载 `/webapi` 和 `/appapi` 前缀（认证机制不同，业务逻辑相同）。下表省略前缀。

### 会话管理

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/sessions` | 创建会话 |
| `GET` | `/sessions` | 列出活跃会话 |
| `DELETE` | `/sessions/{sessionId}` | 关闭会话 |
| `GET` | `/sessions/{sessionId}/snapshot?afterSeq=` | 获取缓冲输出快照 |
| `GET` | `/sessions/{sessionId}/transcript?afterSeq=&stripAnsi=` | 获取命令记录 |
| `GET` | `/sessions/{sessionId}/screen-text` | 获取当前屏幕文本 |
| `GET` | `/sessions/{sessionId}/context?commandLimit=&eventLimit=` | 获取会话上下文（命令+事件+元信息） |

#### `POST /sessions` 请求体

```jsonc
{
  "sessionType": "LOCAL_PTY" | "SSH_SHELL",  // 默认 LOCAL_PTY
  "clientId": "string",         // 可选，WebSocket clientId
  "tabTitle": "string",         // 可选，标签标题
  "toolId": "string",           // 可选，CLI 客户端 ID
  "command": "string",          // 可选，覆盖默认命令
  "args": ["string"],           // 可选，命令参数
  "workdir": "string",          // 可选，工作目录
  "cols": 120,                  // 可选，终端列数
  "rows": 30,                   // 可选，终端行数
  "ssh": {                      // SSH_SHELL 时使用
    "credentialId": "string",   // 已保存凭据 ID
    "host": "string",
    "port": 22,
    "username": "string",
    "term": "xterm-256color"
  }
}
```

#### `POST /sessions` 响应

```json
{ "sessionId": "uuid", "wsUrl": "/ws/uuid", "startedAt": "ISO-8601" }
```

#### `GET /sessions/{sessionId}/snapshot` 响应

```json
{
  "sessionId": "uuid",
  "fromSeq": 0,
  "toSeq": 150,
  "chunks": [{ "seq": 1, "data": "base64-or-text" }],
  "truncated": false
}
```

#### `GET /sessions/{sessionId}/context` 响应

```jsonc
{
  "sessionId": "uuid",
  "meta": {
    "sessionId": "uuid",
    "sessionType": "LOCAL_PTY",
    "connectionState": "connected",
    "lastSeq": 150,
    "attachedClients": 1,
    "lastExitCode": null,
    "commandCount": 5,
    "truncated": false,
    "lastError": null,
    "lastWorkdir": "/home/user",
    "startedAt": "ISO-8601",
    "lastActivityAt": "ISO-8601",
    "updatedAt": "ISO-8601"
  },
  "commands": [{
    "commandId": "uuid", "source": "terminal", "command": "ls -la",
    "boundaryConfidence": 0.9, "startedAt": "ISO-8601", "endedAt": "ISO-8601",
    "durationMs": 120, "exitCode": 0, "status": "COMPLETED"
  }],
  "events": [{
    "eventSeq": 1, "timestamp": "ISO-8601", "type": "OUTPUT",
    "source": "runtime", "commandId": null, "outputSeq": 1,
    "cols": null, "rows": null, "exitCode": null, "data": null
  }],
  "summary": "string"
}
```

### 认证

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/webapi/auth/login` | Web 登录（`{ username, password }`） |
| `GET` | `/webapi/auth/me` | Web 认证状态 |
| `POST` | `/webapi/auth/logout` | Web 登出 |
| `GET` | `/appapi/auth/me` | App JWT 认证状态 |

#### `AuthStatusResponse`

```json
{ "enabled": true, "authenticated": true, "username": "admin" }
```

### SSH 管理

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/ssh/credentials` | 列出已保存凭据 |
| `POST` | `/ssh/credentials` | 新建凭据 |
| `DELETE` | `/ssh/credentials/{credentialId}` | 删除凭据 |
| `POST` | `/ssh/credentials/{credentialId}/preflight` | 测试连接 |
| `POST` | `/ssh/exec` | 执行远程命令（非交互） |

#### `POST /ssh/credentials` 请求体

```jsonc
{
  "host": "10.0.0.2",
  "port": 22,                       // 可选，默认 22
  "username": "ubuntu",
  "password": "***",                // 密码认证
  "privateKey": "-----BEGIN...",    // 私钥认证（与 password 二选一）
  "privateKeyPassphrase": "***"     // 可选
}
```

#### `SshCredentialResponse`

```json
{
  "credentialId": "uuid",
  "host": "10.0.0.2",
  "port": 22,
  "username": "ubuntu",
  "authType": "PASSWORD",
  "createdAt": "ISO-8601"
}
```

#### `POST /ssh/exec` 请求体

```json
{
  "credentialId": "uuid",
  "command": "uname -a",
  "cwd": "/tmp",
  "timeoutSeconds": 120
}
```

### Agent

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/sessions/{sid}/agent/runs` | 创建 Agent 运行 |
| `GET` | `/sessions/{sid}/agent/runs/{runId}` | 查询运行状态 |
| `POST` | `/sessions/{sid}/agent/runs/{runId}/approve` | 审批高风险步骤 |
| `POST` | `/sessions/{sid}/agent/runs/{runId}/abort` | 中止运行 |

#### `POST /sessions/{sid}/agent/runs` 请求体

```json
{
  "instruction": "create a new file",
  "selectedPaths": ["/src/"],
  "includeGitDiff": true
}
```

#### `AgentRunResponse`

```jsonc
{
  "runId": "uuid",
  "sessionId": "uuid",
  "instruction": "...",
  "status": "DRAFTED|WAITING_APPROVAL|EXECUTING_STEP|COMPLETED|FAILED|ABORTED",
  "message": null,
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601",
  "steps": [{
    "stepIndex": 0,
    "tool": "session.get_context",
    "title": "Refresh session context",
    "status": "PENDING|WAITING_APPROVAL|EXECUTING|COMPLETED|FAILED|SKIPPED",
    "highRisk": false,
    "arguments": {},
    "resultSummary": null,
    "error": null,
    "createdAt": "ISO-8601",
    "updatedAt": "ISO-8601"
  }]
}
```

### 其他

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/terminal/clients` | 可用 CLI 客户端列表 |
| `GET` | `/workdirTree?path=` | 浏览目录树 |
| `POST` | `/workspace/context-pack` | 打包工作区上下文 |
| `GET` | `/version` | 系统版本信息 |

## WebSocket 协议

**连接**：`/ws/{sessionId}?clientId=<tabId>&lastSeenSeq=<long>&accessToken=<optional>`

### 客户端 → 服务端

```jsonc
{ "type": "input", "data": "ls -la\n" }      // 终端输入
{ "type": "resize", "cols": 120, "rows": 30 } // 终端大小调整
{ "type": "ping" }                             // 心跳
```

### 服务端 → 客户端

```jsonc
{ "type": "output", "seq": 123, "data": "..." }                              // 终端输出
{ "type": "exit", "exitCode": 0 }                                            // 进程退出
{ "type": "error", "message": "..." }                                        // 错误
{ "type": "pong" }                                                           // 心跳回应
{ "type": "truncated", "requestedAfterSeq": 100, "firstAvailableSeq": 160, "latestSeq": 220 }  // 缓冲不足
```

### 断线恢复流程

1. 客户端跟踪 `lastSeenSeq`
2. 断线后重连携带 `lastSeenSeq`
3. 服务端从 RingBuffer 补发 `seq > lastSeenSeq` 的数据
4. 若缓冲已滚动（`truncated`），客户端调用 `GET /sessions/{id}/snapshot` 拉齐

## 关键配置项

```yaml
terminal:
  default-command: codex                    # 默认终端命令
  cli-clients: [...]                        # 注册的 CLI 客户端列表
  workdir-browse-root: ${user.home}         # 目录浏览根路径
  allowed-origins: ["http://*", "https://*"] # CORS
  detached-session-ttl-seconds: 3600        # 断开后会话保留时间
  ring-buffer-max-bytes: 4194304            # 输出缓冲大小 (4MB)
  ring-buffer-max-chunks: 4096              # 输出缓冲最大块数
  max-cols: 500                             # 终端最大列数
  max-rows: 200                             # 终端最大行数
  ssh:
    enabled: true
    credentials-file: data/ssh-credentials.json  # 加密凭据文件
    master-key-env: TERMINAL_SSH_MASTER_KEY       # 主密钥环境变量
  agent:
    enabled: true
auth:
  enabled: true
  username: admin
  password-hash-bcrypt: ""                  # bcrypt 哈希
  login-rate-limit-enabled: true            # IP+用户名窗口限流
app-auth:
  enabled: true                             # JWT 认证
  local-public-key: ""                      # 本地 RSA 公钥（优先）
  jwks-uri: ""                              # JWKS 端点（备用）
```

## 常用开发命令

```bash
# 后端
cd backend && mvn spring-boot:run          # 本地运行
cd backend && mvn test                     # 运行测试

# 前端
cd frontend && npm run dev                 # Vite 开发服务
cd frontend && npx tsc --noEmit            # 类型检查
cd frontend && npm run build               # 生产构建

# 打包与部署
./package.sh                               # 构建发布目录
./start.sh                                 # 启动服务
./stop.sh                                  # 停止服务
```

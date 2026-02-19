# CLAUDE.md

本文件用于说明当前仓库的实现状态、架构和运维方式。

## 项目概述

`pty-webclient` 是一个浏览器多标签终端系统，支持：

- 本地进程终端（`pty4j`）
- SSH 交互终端（`SSH Shell`）
- SSH 结构化命令执行（`SSH Exec`）

核心目标：会话在客户端断线/刷新后可恢复，并在后端默认保留 1 小时。

## 当前架构

### 1) 前端层（Vite 双入口）

前端支持迁移期双入口：

- `VITE_UI_MODE=legacy`：运行 `frontend/src/main-legacy.js`（默认，全功能）
- `VITE_UI_MODE=react`：运行 `frontend/src/react/main.tsx`（迁移中）

React 模式已包含：登录、Tab 管理、LOCAL_PTY 会话创建、xterm 容器、WebSocket 自动重连（含 `lastSeenSeq`）。

### 2) 会话层（后端）

- `TerminalSession`：统一会话对象（`LOCAL_PTY` / `SSH_SHELL`）
- `TerminalRuntime` 抽象
  - `PtyTerminalRuntime`：本地 PTY
  - `SshShellRuntime`：SSH Shell
- 会话输出通过 `seq` + `TerminalOutputRingBuffer` 支持断线补发

### 3) 输出与断线恢复

- 后端读循环持续读取运行时输出（即使没有客户端也不停止）
- WebSocket 重连使用 `clientId + lastSeenSeq`
- 缓冲不足时发送 `truncated`，客户端可走 `/snapshot` 拉齐
- 全部客户端断开后，会话按 `terminal.detached-session-ttl-seconds` 回收

### 4) 安全与可观测

- 登录认证：`HttpSession`
- 密码校验：`bcrypt 优先`，兼容 `md5` 迁移窗口
- 登录限流：按 `IP + username` 的窗口限流
- HTTP 头注入 `X-Request-Id`
- 日志 MDC 包含 `requestId/sessionId`
- 新增公开接口：`GET /api/version`

## 关键接口

- `POST /api/sessions`
- `DELETE /api/sessions/{sessionId}`
- `GET /api/sessions/{sessionId}/snapshot?afterSeq=<long>`
- `GET /api/workdirTree?path=<optional>`
- `GET /api/version`
- `POST /api/ssh/credentials`
- `POST /api/ssh/exec`
- `WS /ws/{sessionId}?clientId=<tabId>&lastSeenSeq=<long>`

## 打包与启停脚本

仓库根目录提供：

- `package.sh`：构建前后端并生成统一发布目录（默认 `release/`）
- `start.sh`：启动 `backend(app.jar)` 与 `frontend(node server.js)`
- `stop.sh`：按 pid 文件停止服务

### 发布目录结构（`package.sh` 输出）

- `release/backend/app.jar`
- `release/backend/application.yml`（若存在）
- `release/backend/application-default.yml`
- `release/frontend/dist`
- `release/frontend/server.js`
- `release/frontend/node_modules`（生产依赖）
- `release/logs`
- `release/run`

## 常用命令

本地开发：

```bash
cd backend && mvn spring-boot:run
cd frontend && npm run dev
```

打包：

```bash
./package.sh
# 或自定义输出目录
./package.sh /tmp/pty-release
```

启动/停止：

```bash
./start.sh
./stop.sh

# 指定发布目录
./start.sh /tmp/pty-release
./stop.sh /tmp/pty-release
```

## 常用环境变量

启动脚本支持：

- `BACKEND_HOST`（默认 `127.0.0.1`）
- `BACKEND_PORT`（默认 `11948`）
- `FRONTEND_HOST`（默认 `0.0.0.0`）
- `FRONTEND_PORT`（默认 `11949`）
- `BACKEND_ORIGIN`（默认 `http://127.0.0.1:11948`）
- `BACKEND_JAVA_OPTS`（默认 `-Xms256m -Xmx512m`）
- `BACKEND_ARGS`（附加 Spring 参数）

SSH 主密钥建议通过环境变量提供：

- `TERMINAL_SSH_MASTER_KEY`

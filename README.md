# pty-webclient

前后端分离的 PTY Web Terminal：

- 后端：Spring Boot + WebSocket + pty4j
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
- `terminal.session-idle-timeout-seconds`：会话空闲超时
- `terminal.ws-disconnect-grace-seconds`：WebSocket 断开宽限期

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

- `POST /api/sessions`：创建会话
- `DELETE /api/sessions/{sessionId}`：关闭会话
- `GET /api/workdirs?path=<absolutePathOptional>`：列出目录树（仅目录）
- `WS /ws/{sessionId}`：终端双向通信

WebSocket 客户端消息：

- `{"type":"input","data":"..."}`
- `{"type":"resize","cols":120,"rows":30}`
- `{"type":"ping"}`

WebSocket 服务端消息：

- `{"type":"output","data":"..."}`
- `{"type":"exit","exitCode":0}`
- `{"type":"error","message":"..."}`
- `{"type":"pong"}`

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

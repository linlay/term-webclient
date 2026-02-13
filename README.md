# pty-webclient

前后端分离的 PTY Web Terminal：

- 后端：Spring Boot + WebSocket + pty4j
- 前端：Vite + Vanilla JS + xterm.js

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

默认端口：`11948`

后端配置文件：`backend/src/main/resources/application.yml`

关键配置：

- `terminal.default-command`：默认命令（默认 `codex`）
- `terminal.default-args`：默认参数列表
- `terminal.default-workdir`：默认工作目录
- `terminal.allowed-origins`：HTTP/WS 允许来源（默认 `http://localhost:11949`）
- `terminal.session-idle-timeout-seconds`：会话空闲超时
- `terminal.ws-disconnect-grace-seconds`：WebSocket 断开宽限期

## 前端启动

```bash
cd frontend
npm install
npm run dev
```

默认端口：`11949`

前端环境变量文件：`frontend/.env`

```env
VITE_API_BASE=http://localhost:11949
```

## API / WS 协议

- `POST /api/sessions`：创建会话
- `DELETE /api/sessions/{sessionId}`：关闭会话
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

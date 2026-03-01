# 后端模块映射与边界

## 目录映射
| 目录 | 职责 |
|---|---|
| `auth/` | Web/App/WS 认证与鉴权拦截 |
| `config/` | 配置装配、CORS、WS 注册、过滤器 |
| `controller/` | REST API 协议层 |
| `controller/agent` | Agent 相关 API |
| `controller/workspace` | context-pack API |
| `model/` | DTO、状态枚举、响应模型 |
| `service/` | 业务逻辑核心（session/runtime/context/screen） |
| `service/ssh/` | SSH 凭据、连接池、exec、preflight、TOFU |
| `service/file/` | 文件树、上传下载、ticket、local/sftp gateway |
| `service/agent/` | 规划、工具执行、run 生命周期 |
| `service/workspace/` | 工作区上下文打包 |
| `ws/` | WebSocket 消息入口与会话附着 |

## 依赖方向
- 允许：`controller/auth/ws -> service -> runtime/gateway`
- 禁止：
- `service` 依赖 `controller`
- 跨模块直接访问内部细节（应通过公开 service 接口）

## 关键边界
1. 会话生命周期只由 `TerminalSessionService` 管理。
2. WS 连接附着/分离只通过 `attachWebSocket`/`detachWebSocket`。
3. SSH 凭据秘密只在 `SshCredentialStore` 加解密。
4. 文件传输路径校验由 `LocalFileGateway`/`SftpFileGateway` 执行。
5. Agent run 并发约束由 `AgentRunService` 负责（每 session 单 active run）。

## Controller 到 Service 映射
| Controller | Service |
|---|---|
| `SessionController` | `TerminalSessionService` |
| `FileTransferController` | `FileTransferService` |
| `SshController` | `SshCredentialStore` / `SshPreflightService` / `SshExecService` |
| `AgentController` | `AgentRunService` |
| `WorkspaceContextController` | `WorkspaceContextService` |
| `TerminalClientController` | `TerminalProperties`（配置映射） |
| `WorkdirController` | `WorkdirBrowseService` |
| `SystemController` | `BuildProperties + env` |

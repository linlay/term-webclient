# 系统架构

## 架构模式
- 前后端分离 + 后端模块单体（Spring Boot 单进程）
- 前端 SPA（React）+ Node/Express 反向代理
- 终端实时通道使用 WebSocket

## 组件关系图
```mermaid
flowchart LR
  U[Browser or App WebView] --> FE[React + Vite SPA]
  FE -->|/term/api| PX[Express Proxy]
  FE -->|/appterm/api| PX
  FE -->|/term/ws or /appterm/ws| PX

  PX -->|/webapi/*| BE[Spring Boot Backend]
  PX -->|/appapi/*| BE
  PX -->|/ws/{sessionId}| BE

  BE --> PTY[Local PTY Runtime]
  BE --> SSH[SSH Runtime and Pool]
  BE --> FS[Local FS or SFTP Gateway]
  BE --> ST[(Local JSON and Memory State)]
```

## 后端分层与依赖
- 分层：`controller/auth/ws -> service -> runtime/gateway`
- 约束：
- `controller` 仅做协议与参数边界，不承载业务编排
- `service` 持有核心业务逻辑与状态机
- `runtime/gateway` 负责外部 IO（PTY、SSH、文件系统、SFTP）
- 禁止跨层反向依赖（例如 `service` 依赖 `controller`）

## 核心运行约束
- 会话输出统一通过 `seq` 编号进入 ring buffer。
- WS 实时推送失败不阻塞会话运行，客户端可通过 snapshot 追平。
- 所有文件下载票据必须一次性消费，并携带会话与 actor 绑定。
- 认证通道分离：`/webapi` 使用 HttpSession，`/appapi` 使用 JWT Bearer。

## 模块边界（高层）
- Session Runtime: 会话生命周期、读循环、补发
- Auth: Web/App 认证与 WS 握手鉴权
- SSH: 凭据、连接池、exec/shell、TOFU
- File Transfer: local/sftp 文件树与上传下载
- Agent: 规划、审批、步骤执行
- Workspace Context: 选中文件与 git diff 打包

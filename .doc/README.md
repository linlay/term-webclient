# 项目设计文档（`.doc/`）

本目录是 `term-webclient` 的设计与契约文档唯一事实源（Single Source of Truth）。
任何 AI/开发者在改代码前，必须先读取对应文档。

## 强制规则
1. 代码实现必须与 `.doc/` 一致；冲突时先更新文档，再改代码。
2. 新增功能前，必须先补齐对应模块文档，再进入实现。
3. 接口变更必须同步更新三层文档：`api/modules`、`backend/modules`、`frontend/pages`。
4. 文档变更必须记录到 `changelog/`。

## AI 编程前置阅读顺序
1. `GLOSSARY.md`（术语与命名）
2. `api/modules/xxx.md`（接口契约）
3. `backend/modules/xxx.md` 或 `frontend/pages/xxx.md`（实现约束）
4. `api/ERROR_CODES.md`（错误语义）

## 禁止行为
- 禁止发明文档中不存在的接口、字段、状态、错误语义。
- 禁止私自改变已定义请求/响应结构。
- 禁止跳过文档中写明的校验步骤与安全边界。

## [DOC-GAP] 处理流程
当文档未覆盖实现细节时，必须标注 `[DOC-GAP]`：
1. 写明缺口与影响范围。
2. 给出可选方案（至少 2 个）。
3. 在确认前不得直接实现高影响决策。

## 快速导航
| 任务 | 先读 | 再读 |
|---|---|---|
| 了解整体架构 | `architecture/SYSTEM.md` | `architecture/DATA_FLOW.md` |
| 改会话/WS | `api/modules/sessions.md` | `backend/modules/session-runtime.md`, `backend/modules/websocket.md` |
| 改认证 | `api/AUTH.md` | `backend/modules/auth.md`, `frontend/pages/login.md` |
| 改文件传输 | `api/modules/files.md` | `backend/modules/file-transfer.md`, `frontend/pages/file-sidebar.md` |
| 改 SSH | `api/modules/ssh.md` | `backend/modules/ssh.md`, `frontend/pages/session-create.md` |
| 改 Agent | `api/modules/agent.md` | `backend/modules/agent.md`, `frontend/pages/copilot-agent.md` |
| 改工作区上下文 | `api/modules/workspace.md` | `backend/modules/workspace-context.md` |
| 改前端路由/状态 | `frontend/ROUTES.md` | `frontend/STATE.md`, `frontend/COMPONENTS.md` |
| 处理错误语义 | `api/ERROR_CODES.md` | 对应模块 API 文档 |

## 目录说明
- `architecture/`: 系统级设计（结构、技术栈、数据流、部署）
- `api/`: 前后端契约层
- `backend/`: 后端实现层设计
- `frontend/`: 前端实现层设计
- `changelog/`: 文档变更历史

# 前端组件结构

## App 主树（抽象）
```text
App
├── TabBar
├── Top Actions (Files/Copilot/Logout)
├── Main Content
│   ├── TerminalPane[]
│   ├── MobileShortcutBar (mobile)
│   └── ScrollBottom FAB (mobile)
├── FileSidebar (desktop)
├── MobileFileSheet (mobile)
├── CopilotSidebar
├── NewWindowModal
├── TabContextMenu
└── CloseTabConfirmModal
```

## 关键组件职责
| 组件 | 职责 |
|---|---|
| `TabBar` | tab 展示、切换、关闭、右键菜单入口 |
| `TerminalPane` | xterm 实例、WS 生命周期、重连与 snapshot 补齐 |
| `NewSessionForm` | 创建 LOCAL_PTY/SSH 会话、浏览工作目录、SSH 凭据管理 |
| `FileSidebar` | 文件树、上传、下载、mkdir（桌面） |
| `MobileFileSheet` | 文件能力移动端适配 |
| `CopilotSidebar` | Summary + Agent 面板 |
| `MobileShortcutBar` | 移动端虚拟终端按键 |

## 交互分支
- 桌面端（宽屏）
- 文件侧栏可固定展开/收起
- Copilot 侧栏与终端并排

- 移动端（<= 900px）
- `MobileShortcutBar` 与 `MobileFileSheet`
- 文件与 Copilot 采用覆盖式交互

## 组件协作约束
1. `TerminalPane` 仅处理单 tab 终端连接。
2. `App` 负责跨组件编排（active tab、route intent、modal 状态）。
3. 文件组件只处理当前 active session 的文件上下文。

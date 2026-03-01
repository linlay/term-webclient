# Copilot / Agent 侧栏设计

## 组件
- `CopilotSidebar`
- `useCopilotState`

## 两个子页签
1. `Summary`
- 拉取 `session context` 与 `screen text`
- 支持复制 JSON/context

2. `Agent`
- 输入 `instruction`
- 可填写 `selectedPaths`（逐行）
- 启动 run、刷新 run、审批下一步、审批高风险、中止 run

## Quick Command
- 支持 quick command 文本并转换为发送到 terminal 的输入
- 适合轻量快捷操作

## Agent API
- `POST /sessions/{sid}/agent/runs`
- `GET /sessions/{sid}/agent/runs/{runId}`
- `POST /approve`
- `POST /abort`

## 状态映射
- busy/error/run status 由 hook 管理并驱动按钮可用性
- run step 列表展示 `status/resultSummary/error`

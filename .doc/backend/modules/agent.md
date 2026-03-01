# Agent 模块设计

## 核心类
| 类 | 职责 |
|---|---|
| `AgentRunService` | run 生命周期与状态机 |
| `AgentPlanner` | 步骤规划抽象 |
| `MockAgentPlanner` | 当前默认 planner |
| `AgentToolExecutor` | 工具分发执行 |
| `PlannedAgentStep` | 规划步骤结构 |

## 状态机
- Run: `DRAFTED -> WAITING_APPROVAL -> EXECUTING_STEP -> COMPLETED|FAILED|ABORTED`
- Step: `PENDING|WAITING_APPROVAL|EXECUTING|COMPLETED|FAILED|SKIPPED`

## 并发与约束
- 单 session 仅允许 1 个 active run。
- 每次 approve 只推进一个 `WAITING_APPROVAL` 步骤。
- 步骤执行有 timeout（默认 15 秒）。

## MockPlanner 规则
- 固定前置步骤：`session.get_context` + `session.get_transcript`
- 指令前缀：
- `cmd:` / `command:` -> `terminal.execute_managed`
- `input:` -> `terminal.send_input`
- 高风险关键词触发 `highRisk=true`（如 `rm -rf`, `mkfs`, `shutdown`）

## ToolExecutor 当前支持
- `session.get_context`
- `session.get_transcript`
- `terminal.execute_managed`
- `terminal.send_input`
- `workspace.context_pack`

## 失败处理
- timeout -> step/run failed
- exception -> step/run failed
- abort -> pending/waiting 步骤置 skipped，run aborted

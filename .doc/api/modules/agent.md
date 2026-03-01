# Agent 模块 API（agent）

## 覆盖范围
完整路径：

- `POST /sessions/{sessionId}/agent/runs`
- `GET /sessions/{sessionId}/agent/runs/{runId}`
- `POST /sessions/{sessionId}/agent/runs/{runId}/approve`
- `POST /sessions/{sessionId}/agent/runs/{runId}/abort`

## 运行状态
- Run: `DRAFTED -> WAITING_APPROVAL -> EXECUTING_STEP -> COMPLETED|FAILED|ABORTED`
- Step: `PENDING|WAITING_APPROVAL|EXECUTING|COMPLETED|FAILED|SKIPPED`

## POST /runs
请求：
```json
{
  "instruction":"create file...",
  "selectedPaths":["frontend/src/react/App.tsx"],
  "includeGitDiff":true
}
```

响应：`201 + AgentRunResponse`

行为：
- 每个 session 同时只能有一个 active run
- planner 当前默认 `MockAgentPlanner`

## GET /runs/{runId}
返回 `AgentRunResponse`，包含 `steps[]` 实时状态。

## POST /runs/{runId}/approve
请求：`{ confirmRisk?: boolean }`

行为：
- 审批当前 `WAITING_APPROVAL` 步骤
- 高风险步骤必须 `confirmRisk=true`

## POST /runs/{runId}/abort
请求：`{ reason?: string }`

行为：
- 将未执行步骤置为 `SKIPPED`
- run 状态转为 `ABORTED`

## 常见失败
- `400` run 状态不允许审批/中止
- `404` runId 不存在
- `500` 执行器异常

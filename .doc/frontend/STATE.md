# 前端状态管理设计

## 状态分层
| 层 | 技术 | 作用 |
|---|---|---|
| 本地 UI 结构化状态 | Zustand | tab/session/file transfer 状态 |
| 服务端数据拉取 | TanStack Query | auth 状态、sessions 列表轮询 |
| 组件内临时状态 | React state | 弹窗、上下文菜单、移动端开关等 |

## Zustand Store

### 1) `useTabsStore`
核心字段：
- `tabs[]`, `activeTabId`
- tab 字段：`sessionId/wsUrl/clientId/status/sessionType/toolId/workdir/fileRootPath/...`

核心动作：
- `setTabs/addTab/removeTab/setActiveTab`
- `setTabStatus/setTabLost/setTabExitCode`
- `setTabAgentRunId`
- `replaceTabSession`（rebuild 场景）

### 2) `useFileTransferStore`
按 `sessionId` 分片管理：
- 树状态：`currentPath/parentPath/entries`
- 选择状态：`selectedPaths/multiSelectMode`
- 上传队列：`uploadQueue`
- UI 状态：`filterKeyword/loading/lastRefreshedAt`

## Query 状态
- `AUTH_QUERY_KEY`: 获取认证状态
- `listSessions`：2 秒轮询（会话恢复与同步）

## 规则
1. 组件不得绕过 `apiClient` 直接发请求。
2. WS 状态变化必须同步回写 `useTabsStore`。
3. 文件状态必须按 `sessionId` 隔离。
4. app-mode token 刷新由 `appBridge.ts` 统一处理。

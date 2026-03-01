# 终端标签页设计

## 组件
- `TabBar`
- `TerminalPane`
- `CloseTabConfirmModal`
- `TabContextMenu`

## Tab 规则
- 每个 tab 绑定一个 `sessionId` 和一个 `clientId`。
- 可关闭、激活、右键菜单操作。
- active tab 与 URL `sessionId` 双向同步。

## TerminalPane WS 规则
1. 建连参数：`clientId + lastSeenSeq + accessToken(app-mode)`。
2. 收到 `output`：写终端并更新 `lastSeenSeq`。
3. 收到 `exit`：标记 `exited`，停止重连。
4. 收到 `truncated`：调用 snapshot 补齐。
5. close/error 且未退出：指数退避重连。

## Rebuild 场景
- 条件：tab 有 `createRequest` 且处于 `lost/disconnected/error/exited`
- 行为：重新 `POST /sessions`，替换 tab 的 session 绑定

## 关闭策略
- 活跃连接 tab 关闭前弹确认
- 后端关闭失败时仍执行前端回收（防止僵尸 UI）

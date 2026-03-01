# Web 模式外壳页（`/term`）

## 页面目标
- 在浏览器 cookie 认证下提供多标签终端体验。

## 进入条件
1. 访问 `/term` 或 `/term/`
2. `useAuthStatus()` 返回：
- `authenticated=true` -> 进入 App 主界面
- 否则显示 `LoginForm`

## 主流程
1. App 初始化并解析 `routeIntent`。
2. 拉取 `listSessions`（轮询 2s）恢复已有会话。
3. `TabBar` 切换 active tab。
4. 每个 `TerminalPane` 自治 WS 连接与重连。
5. 用户新建会话后追加 tab。

## 退出行为
- 点击 logout 按钮 -> `POST /auth/logout` -> 认证状态失效 -> 回到登录态。

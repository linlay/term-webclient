# 术语表（Term WebClient）

| 术语 | 英文标识（代码中使用） | 含义 | 禁止别名/误用 |
|---|---|---|---|
| 会话 | `session` | 后端运行中的终端实例（LOCAL_PTY/SSH_SHELL） | window, process |
| 标签页 | `tab` | 前端 UI 载体，一个 tab 绑定一个 `sessionId` | session（UI 语义下） |
| 客户端标识 | `clientId` | WS 连接侧标识，用于多客户端附着和重连 | tabId（仅内部可映射） |
| 输出序号 | `seq` | 终端输出递增序号，用于补发与去重 | index, offset |
| 最后已见序号 | `lastSeenSeq` | 客户端已消费的最大 `seq` | cursor |
| 环形缓冲 | `ringBuffer` | 终端输出缓存，支持断线后按序补发 | queue（普通队列） |
| 快照补发 | `snapshot` | 基于 `afterSeq` 拉取历史输出窗口 | full-log |
| 命令转录 | `transcript` | 终端文本转录（可 `stripAnsi`） | log（泛化） |
| 会话上下文 | `context` | `meta + commands + events + summary` 结构化上下文 | state（泛化） |
| Web 模式 | `web-mode` | `/term` 路径，cookie 会话认证 | app-mode |
| App 模式 | `app-mode` | `/appterm` 路径，Bearer JWT 认证 | web-mode |
| 下载票据 | `download-ticket` | 一次性短时下载令牌（single/archive） | token（泛化） |
| TOFU | `tofu` | SSH host key trust-on-first-use 策略 | fixed-host-key |
| 丢失会话 | `lost` | 前端感知到会话不可恢复或 session not found | disconnected（短暂断线） |
| 路由意图 | `routeIntent` | URL 查询参数驱动的前端行为（如 `sessionId/openNewSession`） | router-state |

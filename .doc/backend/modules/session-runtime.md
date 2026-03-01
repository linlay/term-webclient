# Session Runtime 模块设计

## 核心类
| 类 | 职责 |
|---|---|
| `TerminalSessionService` | 会话创建、附着、关闭、补发、读循环 |
| `TerminalSession` | 单会话聚合：runtime/ringBuffer/clients/context/screen |
| `TerminalRuntime` | 统一运行时抽象（input/output/resize/close） |
| `PtyTerminalRuntime` | 本地 PTY 实现 |
| `SshShellRuntime` | SSH shell 实现 |
| `TerminalOutputRingBuffer` | 输出缓冲与窗口裁剪 |
| `SessionContextTracker` | 命令和事件追踪 |
| `TerminalScreenTextTracker` | 屏幕文本快照追踪 |

## 创建流程
1. 归一化请求（sessionType/tool/command/args/workdir/size）。
2. 按类型创建 runtime。
3. 初始化 `TerminalSession` 聚合对象。
4. 启动异步读循环，持续写入 ring buffer + 广播 WS。

## 线程模型
- 每 session 一个读线程（`terminal-read-<sessionId>`）。
- session 状态存于 `ConcurrentMap` + 局部 synchronized。
- 分离后的回收通过 scheduler 延时任务处理。

## TTL 与回收
- `detached-session-ttl-seconds` 到期后自动关闭会话。
- 有 client 重新附着会取消 kill task。

## 边界与校验
- cols/rows 受 `max-cols/max-rows` 限制。
- 写输入失败会触发 `error` 并结束会话。
- `SessionNotFoundException` 用于不存在会话访问。

## 关键输出
- snapshot: `seq` 窗口 + `truncated`
- transcript: 文本转录 + ANSI 可选剥离
- context: `meta + commands + events + summary`
- screen-text: 当前屏幕文本快照

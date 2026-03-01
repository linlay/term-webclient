# WebSocket 模块设计

## 入口
- 服务端路径：`/ws/{sessionId}`
- 握手拦截：`WsAuthHandshakeInterceptor`

## 连接参数
- `clientId`: 客户端标识，默认使用 ws session id
- `lastSeenSeq`: 断线重连序号
- `accessToken`: app-mode 可选 JWT

## 客户端 -> 服务端协议
```json
{ "type":"input", "data":"ls -la\n" }
{ "type":"resize", "cols":120, "rows":30 }
{ "type":"ping" }
```

## 服务端 -> 客户端协议
```json
{ "type":"output", "seq":123, "data":"..." }
{ "type":"exit", "exitCode":0 }
{ "type":"error", "message":"..." }
{ "type":"pong" }
{ "type":"truncated", "requestedAfterSeq":100, "firstAvailableSeq":160, "latestSeq":220 }
```

## 生命周期
1. `afterConnectionEstablished`: 解析 `sessionId/clientId/lastSeenSeq`，attach 并补发。
2. `handleTextMessage`: 分发 input/resize/ping。
3. `afterConnectionClosed`/`handleTransportError`: detach 客户端。

## 容错策略
- 非法消息类型返回 `error`。
- resize 非法参数返回 `error`。
- 会话不存在/请求非法时关闭连接（policy violation）。

## 与 snapshot 协同
- `truncated` 触发后，客户端应调用 REST snapshot 拉齐，然后继续 WS 实时流。

# 核心数据流

## 1. 主链路（`<entry-endpoint>`）
```mermaid
sequenceDiagram
  participant C as Client
  participant API as API
  participant SVC as Service
  participant STORE as Storage
  C->>API: request
  API->>SVC: validated input
  SVC->>STORE: persist/fetch
  SVC-->>API: result
  API-->>C: response
```

关键事实：
- `<ordering-constraint>`
- `<failure-boundary>`

## 2. 异步链路（`<event-name>`）
```mermaid
sequenceDiagram
  participant S as Source
  participant Q as Queue/Broker
  participant H as Handler
  S->>Q: publish <event-name>
  Q->>H: consume
  H-->>Q: ack/retry
```

## 3. 回放/重试链路
- 触发条件：`<replay-trigger>`
- 数据窗口：`<replay-window-rule>`
- 幂等策略：`<idempotency-rule>`

## [DOC-GAP]
- `[DOC-GAP]` 当异步顺序依赖无法保证时，必须补充补偿策略。

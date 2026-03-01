# 核心业务逻辑

## 场景：`<scenario-name>`
```text
输入 -> 校验 -> 处理 -> 调用依赖 -> 输出
```

关键点：
- `<key-point-1>`
- `<key-point-2>`

失败处理：
- `<failure-case>` -> `<recovery-strategy>`

## 状态迁移
- 初始状态：`<initial-state>`
- 中间状态：`<transient-state-list>`
- 终态：`<terminal-state-list>`

## 超时与预算
- 超时规则：`<timeout-rule>`
- 资源预算：`<budget-rule>`
- 重试策略：`<retry-rule>`

## 幂等策略
- 幂等键：`<idempotency-key-rule>`
- 去重窗口：`<dedupe-window-rule>`

## [DOC-GAP]
- `[DOC-GAP]` 若状态机尚未定稿，必须冻结候选状态并标注不可实现范围。

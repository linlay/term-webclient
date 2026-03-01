# <module-name> 模块 API

## `<METHOD> <base-path>/<resource>`
功能：`<feature-summary>`

## 请求
| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `<field>` | `<type>` | `<required>` | `<rule>` |

## 响应（标准壳）
成功：
```json
{
  "code": 0,
  "msg": "success",
  "data": {}
}
```

失败：
```json
{
  "code": <biz-code>,
  "msg": "<message>",
  "data": {}
}
```

## 失败场景
| 场景 | HTTP | code | msg |
|---|---|---|---|
| `<case>` | `<http-status>` | `<biz-code>` | `<message>` |

## 副作用与幂等性
- 副作用：`<side-effect-rule>`
- 幂等键：`<idempotency-key-rule>`

## 事件/异步行为（如有）
- 事件：`<event-name>`
- 投递与重试：`<event-retry-rule>`

## legacy 兼容说明（双轨过渡）
- 当前返回：`<legacy-response-shape-or-none>`
- 迁移目标：`standard envelope`
- 兼容窗口：`<compat-window>`

## [DOC-GAP]
- `[DOC-GAP]` 若模块接口未确定，先冻结字段草案并标记风险。

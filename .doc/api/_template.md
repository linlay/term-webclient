# API 模块文档模板

## 模块
- 名称：`<module-name>`
- base path：`<base-path>`
- owner：`<owner>`

## 接口列表
- `<METHOD> <base-path>/<resource>`

## 请求
| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `<field>` | `<type>` | `<required>` | `<rule>` |

## 响应（标准壳）
```json
{
  "code": 0,
  "msg": "success",
  "data": {}
}
```

## 失败场景
| 场景 | HTTP | code | msg |
|---|---|---|---|
| `<case>` | `<http-status>` | `<biz-code>` | `<message>` |

## 幂等与副作用
- `<idempotency-rule>`
- `<side-effect-rule>`

## legacy 兼容
- `<legacy-rule>`

## [DOC-GAP]
- `<gap-item>`

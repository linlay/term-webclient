# 接口规范（SPEC）

## 基础协议
- Base URL: `<base-path>`
- 格式：`application/json; charset=UTF-8`
- 鉴权：见 `AUTH.md`

## 非流式响应壳（标准）
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
  "code": <error-code>,
  "msg": "<error-message>",
  "data": {}
}
```

## 兼容模式（legacy）
- 允许历史接口返回 `legacy-response`（示例：HTTP + 简化错误体）。
- 新接口默认采用标准响应壳；旧接口按迁移计划分批切换。

## 双轨过渡规则（`response_envelope_rule=dual-track`）
1. 所有新模块默认 `standard envelope`。
2. 旧模块若仍使用 `legacy-response`，必须在模块文档显式标注。
3. 迁移期间禁止无公告切换响应结构。
4. 切换完成需在 changelog 记录兼容窗口结束时间。

## HTTP 状态码与业务码映射
| HTTP | 语义 | code 区间 |
|---|---|---|
| 200/201 | 成功 | `0` |
| 400 | 参数/协议错误 | `<segment-validation>` |
| 401 | 未认证 | `<segment-auth>` |
| 403 | 无权限 | `<segment-authz>` |
| 404 | 资源不存在 | `<segment-not-found>` |
| 409 | 资源冲突 | `<segment-conflict>` |
| 429 | 频控 | `<segment-rate-limit>` |
| 500 | 内部错误 | `<segment-system>` |

## 错误码分段策略（`error_code_policy=segmented policy`）
- `<domain-A>`: `<Axxxx>`
- `<domain-B>`: `<Bxxxx>`
- `<domain-C>`: `<Cxxxx>`
- `<system>`: `<9xxxx>`

## 全局异常映射
| 异常类型 | HTTP | code | msg |
|---|---|---|---|
| `<validation-exception>` | 400 | `<validation-code>` | `<validation-message>` |
| `<auth-exception>` | 401 | `<auth-code>` | `<auth-message>` |
| `<business-exception>` | 409 | `<biz-code>` | `<biz-message>` |
| `<unknown-exception>` | 500 | `<system-code>` | `<system-message>` |

## 参数通用约束
- 分页：`<pagination-rule>`
- 排序：`<sort-rule>`
- 过滤：`<filter-rule>`
- 幂等：`<idempotency-rule>`

## 流式接口基础约束（如适用）
- 事件类型：`<stream-event-type>`
- 序号策略：`<stream-seq-rule>`
- 重放窗口：`<stream-replay-rule>`

## [DOC-GAP]
- `[DOC-GAP]` 当 legacy 接口无法在兼容窗口内迁移时，需记录延期原因、影响接口与新截止日期。

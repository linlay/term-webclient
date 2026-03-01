# 认证与授权

## 1. API 鉴权
- 入口：`<auth-entry>`
- 作用范围：`<path-scope>`
- 认证介质：`<auth-token-or-session-rule>`

## 2. Token 验证规则
- issuer: `<issuer-rule>`
- audience: `<audience-rule>`
- clock skew: `<clock-skew-rule>`
- signature: `<signature-rule>`

## 3. 失败行为
- 未认证：`401`
- 无权限：`403`
- 过期/无效 token：`<invalid-token-status-rule>`

## 4. 配置约束
| 配置项 | 含义 | 默认策略 |
|---|---|---|
| `<auth-config-key>` | `<auth-config-description>` | `<auth-config-default>` |

## 5. 特例授权
- 特例路径：`<exception-path-scope>`
- 特例条件：`<exception-condition>`
- 风险边界：`<exception-risk-boundary>`

## 6. 安全边界
- 禁止在文档中泄露密钥与凭据。
- 所有鉴权旁路必须有审计记录规则。
- 任何鉴权变更必须更新 `SPEC.md` 与 `changelog/`。

## [DOC-GAP]
- `[DOC-GAP]` 若多鉴权模式并存且冲突，需定义优先级矩阵后再实施。

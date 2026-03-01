# 错误语义与编码策略

## 当前现状
- 当前服务端主实现采用 HTTP 状态码 + `{"error":"..."}` 文本语义。
- 尚未落地统一整型业务错误码。

## 已稳定错误语义（示例）
| HTTP | 场景 | 典型 error 文本 |
|---|---|---|
| 400 | 参数非法 | `path is required`, `unsupported mode: ...` |
| 401 | 未认证 | `unauthorized`, `missing bearer token` |
| 403 | 权限/票据不合法 | `download ticket actor mismatch` |
| 404 | 资源不存在 | `Session not found`, `path not found` |
| 413 | 负载超限 | `upload request exceeds maxUploadRequestBytes` |
| 429 | 登录频率限制 | 限流消息 |
| 500 | 服务内部异常 | `... operation failed` |

## 建议的未来编码区间（未强制）
- `0`: success
- `10xxx`: auth/session
- `20xxx`: ssh
- `30xxx`: file-transfer
- `40xxx`: agent/workspace
- `90xxx`: system/internal

## [DOC-GAP]
- 若未来引入 `code` 字段，必须保留当前 `error` 字段至少一个版本周期，避免前端与嵌入端回归。

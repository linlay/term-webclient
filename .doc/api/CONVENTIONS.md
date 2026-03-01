# API 通用约定

## 基础
- 后端真实前缀：`/webapi/**`（web-mode）、`/appapi/**`（app-mode）
- 前端访问前缀：`/term/api/**` 与 `/appterm/api/**`（由 Express/Vite 代理映射）
- 编码：`application/json; charset=UTF-8`
- 时间字段：ISO-8601（UTC 字符串）

## 认证约定
- web-mode: HttpSession（cookie）
- app-mode: `Authorization: Bearer <JWT>`
- 文件下载 ticket 场景可通过 query `ticket` 访问（GET/HEAD）

## 响应与错误约定（当前实现）
- 成功：直接返回业务对象（无统一外层 `code/data/message` 包裹）
- 失败：多数返回 `{"error":"..."}` + HTTP 状态码
- 204 接口：无响应体

## HTTP 状态码使用（项目内）
- `200`: 查询/操作成功
- `201`: 创建成功（如 session、agent run、download ticket、ssh credential）
- `204`: 删除成功（如 close session、delete ssh credential）
- `400`: 参数非法/业务前置条件不满足
- `401`: 未认证（cookie/JWT/WS handshake）
- `403`: 文件越权、ticket/actor/session 不匹配
- `404`: 会话/凭据/路径/运行记录不存在
- `413`: 上传或归档超出上限
- `429`: 登录频率受限
- `500`: 未预期服务端错误

## 分页/过滤
- 当前业务接口未统一分页协议。
- `[DOC-GAP]` 若新增列表接口且数据可能增长，应优先采用 cursor 或 page/pageSize 方案并补文档。

## 幂等与重试
- `GET/HEAD` 可安全重试。
- `POST /files/download-ticket` 非幂等（每次新 ticket）。
- `download ticket` 为一次性消费，消费后不可重用。

## 向后兼容
- 变更 request/response 字段必须同步更新：
- `frontend/src/react/shared/api/types.ts`
- `.doc/api/modules/*.md`
- `.doc/changelog/*.md`

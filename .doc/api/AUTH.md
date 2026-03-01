# 认证与授权

## 认证模式对照
| 模式 | 路径 | 机制 |
|---|---|---|
| Web | `/webapi/**` | HttpSession + bcrypt 登录 |
| App | `/appapi/**` | JWT Bearer（local RSA 公钥优先，JWKS 兜底） |
| WebSocket | `/ws/{sessionId}` | 握手阶段校验 Session 或 `accessToken` |

## Web 认证接口
- `POST /webapi/auth/login` 请求：`{ username, password }`
- `GET /webapi/auth/me` 返回 `AuthStatusResponse`
- `POST /webapi/auth/logout` 返回 `{ ok: true }`

登录成功后服务端创建会话并写入 `terminal.auth.username`。

## App 认证接口
- `GET /appapi/auth/me`

JWT 校验规则（关键）：
- 算法仅允许 RSA 家族
- 校验签名（local-public-key 或 jwks-uri）
- 校验 `exp`，可配置 `clock-skew-seconds`
- 可选校验 `issuer` 与 `audience`

## API 拦截器行为
- `WebApiAuthInterceptor` 保护 `/webapi/**`（排除 `/webapi/auth/**`, `/webapi/version`）
- `AppApiAuthInterceptor` 保护 `/appapi/**`（排除 `/appapi/version`）
- 未认证统一返回 `401` + `{"error":"unauthorized"}`

## WS 握手认证
握手拦截器顺序：
1. 若 Session 已认证，放行
2. 否则尝试 `accessToken` 参数
3. 都失败返回 `401`

推荐连接串：
- `/ws/{sessionId}?clientId=<id>&lastSeenSeq=<n>`（web）
- `/ws/{sessionId}?clientId=<id>&lastSeenSeq=<n>&accessToken=<jwt>`（app）

## 登录限流
- 按 `IP + 用户名` 维度限流（可配置开关、窗口与次数）
- 命中限流返回 `429`

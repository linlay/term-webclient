# Auth 模块设计

## 核心类
| 类 | 职责 |
|---|---|
| `AuthService` | Web 登录、会话状态、logout |
| `AppTokenService` | JWT 提取、签名与 claims 校验 |
| `WebApiAuthInterceptor` | `/webapi/**` 鉴权拦截 |
| `AppApiAuthInterceptor` | `/appapi/**` 鉴权拦截 |
| `WsAuthHandshakeInterceptor` | WS 握手鉴权 |
| `LoginRateLimiter` | 登录限流 |

## Web 认证规则
- 启用时必须配置 `auth.username` 与 bcrypt hash。
- 登录成功重建 HttpSession，写入 `terminal.auth.username`。
- 登出失效 session。

## App JWT 校验规则
- 从 `Authorization: Bearer` 提取 token。
- 只允许 RSA 算法。
- 验签 key 来源：
- `app-auth.local-public-key`（优先）
- `app-auth.jwks-uri`（备用）
- claims 校验：`exp`、可选 `nbf/issuer/audience`。

## 拦截器例外
- `/webapi/auth/**`、`/webapi/version` 不拦截
- `/appapi/version` 不拦截
- 带 `ticket` 的文件下载 GET/HEAD 放行（再由 ticket 校验 actor/session）

## WS 握手
- 优先校验 web session
- 不通过则尝试 `accessToken`
- 两者都失败返回 401

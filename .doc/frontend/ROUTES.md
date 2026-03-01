# 前端路由与入口

## 双入口
| UI 入口 | 模式 | API 前缀 | WS 前缀 | 认证 |
|---|---|---|---|---|
| `/term` / `/term/` | web-mode | `/term/api` | `/term/ws` | HttpSession |
| `/appterm` / `/appterm/` | app-mode | `/appterm/api` | `/appterm/ws` | Bearer JWT |

## Express 入口行为（`frontend/server.js`）
- `GET /term` -> `302 /term/`（保留 query）
- `GET /appterm` -> `302 /appterm/`
- `GET /term/` 与 `GET /appterm/` 返回 SPA `index.html`
- `/term/api/*` 与 `/appterm/api/*` 转发后端
- `/term/ws/*` 与 `/appterm/ws/*` 升级为后端 WS

## 前端路由机制
- 当前未使用 react-router；由 `window.location.pathname + search` 驱动。
- `env.ts` 根据路径判断 app/web 模式并生成 API/WS 前缀。

## Route Intent（查询参数）
| 参数 | 含义 |
|---|---|
| `sessionId` | 指定激活会话 |
| `openNewSession` | 是否打开新建会话弹窗（`1/true`） |
| `openNonce` | 用于触发一次性打开动作 |

`routeIntent.ts` 负责 parse/build/同步逻辑。

## 鉴权页面流
- web-mode：`/auth/me` 返回未认证时展示 `LoginForm`
- app-mode：未取到 token 时展示 `Waiting for app access token...`

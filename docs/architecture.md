# Architecture Overview

## Runtime Topology

```
Browser -> Nginx:443 -> Node proxy:11931 -> Spring Boot:11930
```

- Frontend serves static assets from `frontend/dist` and proxies `/webapi` + `/appapi` + `/ws` to backend.
- Backend owns terminal sessions (`LOCAL_PTY` and `SSH_SHELL`) and WebSocket IO fanout.

## Frontend Runtime

The frontend is React-only (`/Users/linlay-macmini/Project/pty-webclient/frontend/src/react/main.tsx`).

Environment split is handled by:

- Vite mode (`development` / `production`) via `APP_ENV` in `package.sh`
- Node proxy runtime env file `release/.env.<env>` via `APP_ENV` in `start.sh`

Runtime entry paths:

- `/term` -> web mode (`/webapi` + session auth)
- `/appterm` -> app mode (`/appapi` + bearer token auth)

## Backend Auth

Auth is dual-mode:

- `/webapi/**` uses session auth (`HttpSession`) except `/webapi/auth/**` and `/webapi/version`.
- `/appapi/**` uses bearer token auth except `/appapi/version`.

Password verification order:

1. `terminal.auth.password-hash-bcrypt` (preferred)
2. `terminal.auth.password-hash` (legacy MD5 compatibility window)

Login endpoint rate limiting is enabled by default:

- `terminal.auth.login-rate-limit-enabled=true`
- `terminal.auth.login-rate-limit-window-seconds=60`
- `terminal.auth.login-rate-limit-max-attempts=10`

## Request Context

Every HTTP response includes `X-Request-Id`. Backend logs include MDC fields:

- `requestId`
- `sessionId`

## API Compatibility

- `GET /webapi/version` and `GET /appapi/version` -> `{ name, version, gitSha, buildTime }`
- `WS /ws/{sessionId}` accepts either session auth or `accessToken` query parameter.

# Architecture Overview

## Runtime Topology

```
Browser -> Nginx:443 -> Node proxy:11931 -> Spring Boot:11930
```

- Frontend serves static assets under `/term/assets` + `/appterm/assets`, and proxies `/term/api` + `/appterm/api` + `/term/ws` + `/appterm/ws` to backend.
- Backend owns terminal sessions (`LOCAL_PTY` and `SSH_SHELL`) and WebSocket IO fanout.

## Frontend Runtime

The frontend is React-only (`/Users/linlay-macmini/Project/pty-webclient/frontend/src/react/main.tsx`).

Environment split is handled by:

- Vite mode (`development` / `production`) via `APP_ENV` in `package.sh`
- Node proxy runtime env file `release/.env.<env>` via `APP_ENV` in `start.sh`

Runtime entry paths:

- `/term/` -> web mode (`/term/api` + `/term/ws`, session auth)
- `/appterm/` -> app mode (`/appterm/api` + `/appterm/ws`, bearer token auth)

## Backend Auth

Auth is dual-mode:

- Node proxy rewrites `/term/api/**` -> `/webapi/**`, `/appterm/api/**` -> `/appapi/**`.
- `/webapi/**` uses session auth (`HttpSession`) except `/webapi/auth/**` and `/webapi/version`.
- `/appapi/**` uses bearer token auth except `/appapi/version`.

Password verification uses bcrypt only:

1. `auth.password-hash-bcrypt`

Login endpoint rate limiting is enabled by default:

- `auth.login-rate-limit-enabled=true`
- `auth.login-rate-limit-window-seconds=60`
- `auth.login-rate-limit-max-attempts=10`

## Request Context

Every HTTP response includes `X-Request-Id`. Backend logs include MDC fields:

- `requestId`
- `sessionId`

## API Compatibility

- Public endpoint: `GET /term/api/version` and `GET /appterm/api/version` -> `{ name, version, gitSha, buildTime }`
- Public endpoint: `WS /term/ws/{sessionId}` or `WS /appterm/ws/{sessionId}`.
- Backend endpoint (internal after proxy rewrite): `WS /ws/{sessionId}` accepts either session auth or `accessToken` query parameter.

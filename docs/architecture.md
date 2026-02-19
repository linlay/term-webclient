# Architecture Overview

## Runtime Topology

```
Browser -> Nginx:443 -> Node proxy:11949 -> Spring Boot:11948
```

- Frontend serves static assets from `frontend/dist` and proxies `/api` + `/ws` to backend.
- Backend owns terminal sessions (`LOCAL_PTY` and `SSH_SHELL`) and WebSocket IO fanout.

## Frontend Modes

The frontend supports a dual-mode migration strategy:

- `VITE_UI_MODE=legacy` (default): runs `/Users/linlay-macmini/Project/pty-webclient/frontend/src/main-legacy.js`.
- `VITE_UI_MODE=react`: runs `/Users/linlay-macmini/Project/pty-webclient/frontend/src/react/main.tsx`.

This allows incremental migration to React/TypeScript with rollback safety.

## Backend Auth

Auth is session-based (`HttpSession`) and protects `/api/**` except `/api/auth/**` and `/api/version`.

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

Existing API and WebSocket contracts remain unchanged. Added endpoint:

- `GET /api/version` -> `{ name, version, gitSha, buildTime }`

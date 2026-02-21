# Release And Rollback Runbook

## Preconditions

1. CI pipeline is green (`frontend lint/typecheck/test/build`, `backend mvn -q test`).
2. Target VM has required runtime versions:
   - Node.js 20+
   - JDK 21+
3. Deployment environment variables are set:
   - `TERMINAL_SSH_MASTER_KEY`
   - optional: `APP_GIT_SHA`, `APP_BUILD_TIME`

## Manual Release Steps

1. Build frontend assets:

```bash
cd /Users/linlay-macmini/Project/pty-webclient/frontend
npm ci
npm run build
```

2. Start frontend proxy server:

```bash
PORT=11949 BACKEND_ORIGIN=http://127.0.0.1:11948 npm run serve
```

3. Start backend:

```bash
cd /Users/linlay-macmini/Project/pty-webclient/backend
mvn spring-boot:run
```

4. Verify health and version:

```bash
curl -sS http://127.0.0.1:11949/healthz
curl -sS http://127.0.0.1:11949/webapi/version
curl -sS http://127.0.0.1:11949/appapi/version
```

5. Smoke test:

- Open `http://127.0.0.1:11949/term` and login
- Create local PTY session
- Command echo
- Browser refresh and reconnect
- Open `http://127.0.0.1:11949/appterm` in WebView and verify token-based access

## Rollback Steps

1. Switch frontend to legacy UI mode (`VITE_UI_MODE=legacy`) and rebuild if needed.
2. Redeploy previous backend artifact/config.
3. Validate:

```bash
curl -sS http://127.0.0.1:11949/healthz
curl -I https://<your-domain>
```

4. Confirm login/session creation works.

## Incident Notes Template

Capture the following for each rollback event:

- Release commit SHA
- Trigger timestamp
- Symptom and impacted scope
- Rollback completion timestamp
- Root cause and follow-up actions

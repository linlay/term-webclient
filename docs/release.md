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
npm run build -- --mode production
```

2. Start frontend proxy server:

```bash
PORT=11931 BACKEND_ORIGIN=http://127.0.0.1:11930 npm run serve
```

or use root script (recommended):

```bash
cd /Users/linlay-macmini/Project/pty-webclient
APP_ENV=production ./start.sh
```

If you run from a packaged release directory, you can place proxy runtime defaults in `release/.env.production`:

```env
HOST=0.0.0.0
PORT=11931
BACKEND_ORIGIN=http://127.0.0.1:11930
```

3. Start backend:

```bash
cd /Users/linlay-macmini/Project/pty-webclient/backend
mvn spring-boot:run
```

4. Verify health and version:

```bash
curl -sS http://127.0.0.1:11931/healthz
curl -sS http://127.0.0.1:11931/term/api/version
curl -sS http://127.0.0.1:11931/appterm/api/version
```

5. Smoke test:

- Open `http://127.0.0.1:11931/term/` and login
- Create local PTY session
- Command echo
- Browser refresh and reconnect
- Open `http://127.0.0.1:11931/appterm/` in WebView and verify token-based access

## Rollback Steps

1. Redeploy previous frontend/backend artifact pair from the last known-good release.
2. Restart service with `APP_ENV=production`.
3. Validate:

```bash
curl -sS http://127.0.0.1:11931/healthz
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

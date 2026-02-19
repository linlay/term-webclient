#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_DIR="${1:-$ROOT_DIR/release}"
RUN_DIR="$RELEASE_DIR/run"
LOG_DIR="$RELEASE_DIR/logs"

BACKEND_PID_FILE="$RUN_DIR/backend.pid"
FRONTEND_PID_FILE="$RUN_DIR/frontend.pid"
BACKEND_LOG_FILE="$LOG_DIR/backend.out"
FRONTEND_LOG_FILE="$LOG_DIR/frontend.out"

BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-11948}"
FRONTEND_HOST="${FRONTEND_HOST:-0.0.0.0}"
FRONTEND_PORT="${FRONTEND_PORT:-11949}"
BACKEND_ORIGIN="${BACKEND_ORIGIN:-http://127.0.0.1:11948}"
BACKEND_JAVA_OPTS="${BACKEND_JAVA_OPTS:--Xms256m -Xmx512m}"
BACKEND_ARGS="${BACKEND_ARGS:-}"
NODE_OPTIONS_VALUE="${NODE_OPTIONS:-}"

is_running() {
  local pid="$1"
  kill -0 "$pid" >/dev/null 2>&1
}

require_file() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    echo "[start] missing required file: $path"
    exit 1
  fi
}

mkdir -p "$RUN_DIR" "$LOG_DIR"

require_file "$RELEASE_DIR/backend/app.jar"
require_file "$RELEASE_DIR/frontend/server.js"
require_file "$RELEASE_DIR/frontend/package.json"
require_file "$RELEASE_DIR/frontend/dist/index.html"

if [[ -f "$BACKEND_PID_FILE" ]]; then
  backend_pid="$(cat "$BACKEND_PID_FILE" 2>/dev/null || true)"
  if [[ -n "$backend_pid" ]] && is_running "$backend_pid"; then
    echo "[start] backend is already running (pid=$backend_pid)"
    exit 1
  fi
  rm -f "$BACKEND_PID_FILE"
fi

if [[ -f "$FRONTEND_PID_FILE" ]]; then
  frontend_pid="$(cat "$FRONTEND_PID_FILE" 2>/dev/null || true)"
  if [[ -n "$frontend_pid" ]] && is_running "$frontend_pid"; then
    echo "[start] frontend is already running (pid=$frontend_pid)"
    exit 1
  fi
  rm -f "$FRONTEND_PID_FILE"
fi

(
  cd "$RELEASE_DIR"
  set +u
  nohup bash -lc "exec java $BACKEND_JAVA_OPTS -jar backend/app.jar --server.address=$BACKEND_HOST --server.port=$BACKEND_PORT $BACKEND_ARGS" \
    >"$BACKEND_LOG_FILE" 2>&1 &
  echo $! >"$BACKEND_PID_FILE"
)

sleep 1
backend_pid="$(cat "$BACKEND_PID_FILE")"
if ! is_running "$backend_pid"; then
  echo "[start] backend failed to start, see $BACKEND_LOG_FILE"
  exit 1
fi

(
  cd "$RELEASE_DIR/frontend"
  nohup env \
    HOST="$FRONTEND_HOST" \
    PORT="$FRONTEND_PORT" \
    BACKEND_ORIGIN="$BACKEND_ORIGIN" \
    NODE_OPTIONS="$NODE_OPTIONS_VALUE" \
    node server.js >"$FRONTEND_LOG_FILE" 2>&1 &
  echo $! >"$FRONTEND_PID_FILE"
)

sleep 1
frontend_pid="$(cat "$FRONTEND_PID_FILE")"
if ! is_running "$frontend_pid"; then
  echo "[start] frontend failed to start, see $FRONTEND_LOG_FILE"
  kill "$backend_pid" >/dev/null 2>&1 || true
  rm -f "$BACKEND_PID_FILE" "$FRONTEND_PID_FILE"
  exit 1
fi

echo "[start] backend  pid=$backend_pid  http://$BACKEND_HOST:$BACKEND_PORT"
echo "[start] frontend pid=$frontend_pid http://$FRONTEND_HOST:$FRONTEND_PORT"
echo "[start] logs: $BACKEND_LOG_FILE , $FRONTEND_LOG_FILE"

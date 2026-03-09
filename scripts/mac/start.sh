#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
APP_ENV="${APP_ENV:-production}"
RELEASE_DIR="${1:-$ROOT_DIR/release}"
[[ "$RELEASE_DIR" = /* ]] || RELEASE_DIR="$ROOT_DIR/$RELEASE_DIR"
RUN_DIR="$RELEASE_DIR/run"
LOG_DIR="$RELEASE_DIR/logs"
BASE_ENV_FILE="$RELEASE_DIR/.env"
BACKEND_BINARY="$RELEASE_DIR/backend/term-web-backend"
BACKEND_PID_FILE="$RUN_DIR/backend.pid"
FRONTEND_PID_FILE="$RUN_DIR/frontend.pid"
BACKEND_LOG_FILE="$LOG_DIR/backend.out"
FRONTEND_LOG_FILE="$LOG_DIR/frontend.out"

die() {
  echo "[start] $*" >&2
  exit 1
}

require_port() {
  local value="$1"
  local name="$2"
  if [[ -z "$value" ]]; then
    die "missing required $name in $BASE_ENV_FILE"
  fi
  if [[ ! "$value" =~ ^[0-9]+$ ]] || (( value < 1 || value > 65535 )); then
    die "invalid $name=$value in $BASE_ENV_FILE"
  fi
}

is_running() {
  local pid="$1"
  kill -0 "$pid" >/dev/null 2>&1
}

[[ -f "$BASE_ENV_FILE" ]] || die "missing required config: $BASE_ENV_FILE (copy from .env.example)"
[[ -x "$BACKEND_BINARY" ]] || die "missing required release artifact: $BACKEND_BINARY"
[[ -f "$RELEASE_DIR/frontend/server.js" ]] || die "missing required release artifact: $RELEASE_DIR/frontend/server.js"
[[ -f "$RELEASE_DIR/frontend/package.json" ]] || die "missing required release artifact: $RELEASE_DIR/frontend/package.json"
[[ -f "$RELEASE_DIR/frontend/dist/index.html" ]] || die "missing required release artifact: $RELEASE_DIR/frontend/dist/index.html"

mkdir -p "$RUN_DIR" "$LOG_DIR" "$RELEASE_DIR/data"

set -a
. "$BASE_ENV_FILE"
set +a

BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-}"
FRONTEND_HOST="${FRONTEND_HOST:-0.0.0.0}"
FRONTEND_PORT="${FRONTEND_PORT:-}"
BACKEND_ORIGIN="${BACKEND_ORIGIN:-http://$BACKEND_HOST:$BACKEND_PORT}"
BACKEND_ARGS="${BACKEND_ARGS:-}"
NODE_OPTIONS_VALUE="${NODE_OPTIONS:-}"
CONFIG_PATH="${CONFIG_PATH:-}"

require_port "$BACKEND_PORT" "BACKEND_PORT"
require_port "$FRONTEND_PORT" "FRONTEND_PORT"

config_path="$CONFIG_PATH"
if [[ -n "$config_path" ]]; then
  if [[ "$config_path" = /* ]]; then
    resolved_config_path="$config_path"
  else
    resolved_config_path="$RELEASE_DIR/$config_path"
  fi
  [[ -f "$resolved_config_path" ]] || die "missing required config: $resolved_config_path"
fi

if [[ -f "$BACKEND_PID_FILE" ]]; then
  backend_pid="$(cat "$BACKEND_PID_FILE" 2>/dev/null || true)"
  if [[ -n "$backend_pid" ]] && is_running "$backend_pid"; then
    die "backend is already running (pid=$backend_pid)"
  fi
  rm -f "$BACKEND_PID_FILE"
fi

if [[ -f "$FRONTEND_PID_FILE" ]]; then
  frontend_pid="$(cat "$FRONTEND_PID_FILE" 2>/dev/null || true)"
  if [[ -n "$frontend_pid" ]] && is_running "$frontend_pid"; then
    die "frontend is already running (pid=$frontend_pid)"
  fi
  rm -f "$FRONTEND_PID_FILE"
fi

(
  cd "$RELEASE_DIR"
  backend_app_args=()
  if [[ -n "${BACKEND_ARGS//[[:space:]]/}" ]]; then
    # shellcheck disable=SC2206
    backend_app_args=($BACKEND_ARGS)
  fi

  nohup "$BACKEND_BINARY" --server.address="$BACKEND_HOST" --server.port="$BACKEND_PORT" "${backend_app_args[@]}" >"$BACKEND_LOG_FILE" 2>&1 &
  echo $! >"$BACKEND_PID_FILE"
)

sleep 1
backend_pid="$(cat "$BACKEND_PID_FILE")"
if ! is_running "$backend_pid"; then
  die "backend failed to start, see $BACKEND_LOG_FILE"
fi

(
  cd "$RELEASE_DIR/frontend"
  nohup env \
    APP_ENV="$APP_ENV" \
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
echo "[start] loaded env defaults from $BASE_ENV_FILE"
echo "[start] logs: $BACKEND_LOG_FILE , $FRONTEND_LOG_FILE"

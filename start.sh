#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ $# -ge 1 ]]; then
  RELEASE_DIR="$1"
elif [[ -f "$ROOT_DIR/backend/app.jar" ]] && [[ -f "$ROOT_DIR/frontend/server.js" ]]; then
  RELEASE_DIR="$ROOT_DIR"
else
  RELEASE_DIR="$ROOT_DIR/release"
fi
APP_ENV="${APP_ENV:-production}"
if [[ "$APP_ENV" != "development" && "$APP_ENV" != "production" ]]; then
  echo "[start] invalid APP_ENV: $APP_ENV (expected: development|production)"
  exit 1
fi
RUN_DIR="$RELEASE_DIR/run"
LOG_DIR="$RELEASE_DIR/logs"
BACKEND_CONFIG_FILE="$RELEASE_DIR/backend/application.yml"
FRONTEND_ENV_FILE="$RELEASE_DIR/.env.$APP_ENV"
LEGACY_FRONTEND_ENV_FILE="$RELEASE_DIR/frontend/.env.server.$APP_ENV"

BACKEND_PID_FILE="$RUN_DIR/backend.pid"
FRONTEND_PID_FILE="$RUN_DIR/frontend.pid"
BACKEND_LOG_FILE="$LOG_DIR/backend.out"
FRONTEND_LOG_FILE="$LOG_DIR/frontend.out"

BACKEND_HOST_OVERRIDE="${BACKEND_HOST:-}"
BACKEND_PORT_OVERRIDE="${BACKEND_PORT:-}"
FRONTEND_HOST="${FRONTEND_HOST:-}"
FRONTEND_PORT="${FRONTEND_PORT:-}"
BACKEND_ORIGIN_OVERRIDE="${BACKEND_ORIGIN:-}"
BACKEND_JAVA_OPTS="${BACKEND_JAVA_OPTS:--Xms256m -Xmx512m}"
BACKEND_ARGS="${BACKEND_ARGS:-}"
NODE_OPTIONS_VALUE="${NODE_OPTIONS:-}"

read_server_config() {
  local file="$1"
  local key="$2"
  awk -v key="$key" '
    /^[[:space:]]*#/ { next }
    /^server:[[:space:]]*$/ { in_server=1; next }
    in_server && /^[^[:space:]]/ { in_server=0 }
    in_server {
      line=$0
      sub(/^[[:space:]]+/, "", line)
      if (line ~ "^" key ":[[:space:]]*") {
        sub("^" key ":[[:space:]]*", "", line)
        sub(/[[:space:]]+#.*$/, "", line)
        gsub(/^["'\'']|["'\'']$/, "", line)
        print line
        exit
      }
    }
  ' "$file"
}

read_env_config() {
  local file="$1"
  local key="$2"
  awk -v key="$key" '
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    {
      line=$0
      sub(/^[[:space:]]+/, "", line)
      eq=index(line, "=")
      if (eq <= 0) {
        next
      }
      k=substr(line, 1, eq - 1)
      sub(/[[:space:]]+$/, "", k)
      if (k != key) {
        next
      }
      v=substr(line, eq + 1)
      sub(/^[[:space:]]+/, "", v)
      sub(/[[:space:]]+$/, "", v)
      gsub(/^["'"'"']|["'"'"']$/, "", v)
      print v
      exit
    }
  ' "$file"
}

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

default_backend_host="127.0.0.1"
default_backend_port="11930"
if [[ -f "$BACKEND_CONFIG_FILE" ]]; then
  config_backend_host="$(read_server_config "$BACKEND_CONFIG_FILE" "address" || true)"
  config_backend_port="$(read_server_config "$BACKEND_CONFIG_FILE" "port" || true)"
  if [[ -n "$config_backend_host" ]]; then
    default_backend_host="$config_backend_host"
  fi
  if [[ -n "$config_backend_port" ]]; then
    default_backend_port="$config_backend_port"
  fi
fi

if [[ ! -f "$FRONTEND_ENV_FILE" ]] && [[ -f "$LEGACY_FRONTEND_ENV_FILE" ]]; then
  FRONTEND_ENV_FILE="$LEGACY_FRONTEND_ENV_FILE"
fi

if [[ -f "$FRONTEND_ENV_FILE" ]]; then
  [[ -n "$FRONTEND_HOST" ]] || FRONTEND_HOST="$(read_env_config "$FRONTEND_ENV_FILE" "HOST" || true)"
  [[ -n "$FRONTEND_PORT" ]] || FRONTEND_PORT="$(read_env_config "$FRONTEND_ENV_FILE" "PORT" || true)"
  [[ -n "$BACKEND_ORIGIN_OVERRIDE" ]] || BACKEND_ORIGIN_OVERRIDE="$(read_env_config "$FRONTEND_ENV_FILE" "BACKEND_ORIGIN" || true)"
fi

FRONTEND_HOST="${FRONTEND_HOST:-0.0.0.0}"
FRONTEND_PORT="${FRONTEND_PORT:-11931}"

effective_backend_host="${BACKEND_HOST_OVERRIDE:-$default_backend_host}"
effective_backend_port="${BACKEND_PORT_OVERRIDE:-$default_backend_port}"
BACKEND_ORIGIN="${BACKEND_ORIGIN_OVERRIDE:-http://$effective_backend_host:$effective_backend_port}"

backend_overrides=""
if [[ -n "$BACKEND_HOST_OVERRIDE" ]]; then
  backend_overrides="$backend_overrides --server.address=$BACKEND_HOST_OVERRIDE"
fi
if [[ -n "$BACKEND_PORT_OVERRIDE" ]]; then
  backend_overrides="$backend_overrides --server.port=$BACKEND_PORT_OVERRIDE"
fi

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
  nohup bash -lc "exec java $BACKEND_JAVA_OPTS -jar backend/app.jar$backend_overrides $BACKEND_ARGS" \
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

echo "[start] backend  pid=$backend_pid  http://$effective_backend_host:$effective_backend_port"
echo "[start] frontend pid=$frontend_pid http://$FRONTEND_HOST:$FRONTEND_PORT"
echo "[start] app env=$APP_ENV"
if [[ -f "$FRONTEND_ENV_FILE" ]]; then
  echo "[start] loaded frontend env defaults from $FRONTEND_ENV_FILE"
fi
echo "[start] logs: $BACKEND_LOG_FILE , $FRONTEND_LOG_FILE"

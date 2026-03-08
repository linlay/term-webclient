#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
BASE_ENV_FILE_NAME=".env"

BACKEND_HOST_OVERRIDE="${BACKEND_HOST:-}"
BACKEND_PORT_OVERRIDE="${BACKEND_PORT:-}"
FRONTEND_HOST="${FRONTEND_HOST:-}"
FRONTEND_PORT="${FRONTEND_PORT:-}"
BACKEND_ORIGIN_OVERRIDE="${BACKEND_ORIGIN:-}"
BACKEND_ARGS="${BACKEND_ARGS:-}"
NODE_OPTIONS_VALUE="${NODE_OPTIONS:-}"
APP_ENV="${APP_ENV:-production}"

die() {
  echo "[start] $*" >&2
  exit 1
}

has_runtime_config() {
  local dir="$1"
  [[ -f "$dir/$BASE_ENV_FILE_NAME" ]]
}

resolve_release_dir() {
  if [[ $# -ge 1 ]]; then
    if [[ "$1" = /* ]]; then
      printf '%s\n' "$1"
      return 0
    fi
    printf '%s\n' "$ROOT_DIR/$1"
    return 0
  fi

  if has_runtime_config "$ROOT_DIR"; then
    printf '%s\n' "$ROOT_DIR"
    return 0
  fi

  local release_fallback="$ROOT_DIR/release"
  if has_runtime_config "$release_fallback"; then
    printf '%s\n' "$release_fallback"
    return 0
  fi

  printf '%s\n' "$ROOT_DIR"
}

if [[ $# -ge 1 ]]; then
  RELEASE_DIR="$(resolve_release_dir "$1")"
else
  RELEASE_DIR="$(resolve_release_dir)"
fi

RUN_DIR="$RELEASE_DIR/run"
LOG_DIR="$RELEASE_DIR/logs"
BASE_ENV_FILE="$RELEASE_DIR/$BASE_ENV_FILE_NAME"
BACKEND_BINARY="$RELEASE_DIR/backend/term-web-backend"

BACKEND_PID_FILE="$RUN_DIR/backend.pid"
FRONTEND_PID_FILE="$RUN_DIR/frontend.pid"
BACKEND_LOG_FILE="$LOG_DIR/backend.out"
FRONTEND_LOG_FILE="$LOG_DIR/frontend.out"

require_config_file() {
  local path="$1"
  local hint="$2"
  if [[ ! -f "$path" ]]; then
    die "missing required config: $path ($hint)"
  fi
}

require_release_artifact() {
  local path="$1"
  if [[ ! -e "$path" ]]; then
    die "missing required release artifact: $path (release dir: $RELEASE_DIR)"
  fi
}

require_port_value() {
  local value="$1"
  local name="$2"
  local hint="$3"
  if [[ -z "$value" ]]; then
    die "missing required $name in $BASE_ENV_FILE ($hint)"
  fi
  if [[ ! "$value" =~ ^[0-9]+$ ]] || (( value < 1 || value > 65535 )); then
    die "invalid $name=$value in $BASE_ENV_FILE (expected integer 1-65535)"
  fi
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

require_config_file "$BASE_ENV_FILE" "copy from .env.example"

mkdir -p "$RUN_DIR" "$LOG_DIR" "$RELEASE_DIR/data"

config_path="$(read_env_config "$BASE_ENV_FILE" "CONFIG_PATH" || true)"
if [[ -n "$config_path" ]]; then
  if [[ "$config_path" = /* ]]; then
    resolved_config_path="$config_path"
  else
    resolved_config_path="$RELEASE_DIR/$config_path"
  fi
  require_config_file "$resolved_config_path" "ensure CONFIG_PATH points to an existing config file"
fi

default_backend_host="127.0.0.1"
[[ -n "$BACKEND_HOST_OVERRIDE" ]] || env_backend_host="$(read_env_config "$BASE_ENV_FILE" "BACKEND_HOST" || true)"
[[ -n "$BACKEND_PORT_OVERRIDE" ]] || env_backend_port="$(read_env_config "$BASE_ENV_FILE" "BACKEND_PORT" || true)"
[[ -n "$FRONTEND_HOST" ]] || FRONTEND_HOST="$(read_env_config "$BASE_ENV_FILE" "FRONTEND_HOST" || true)"
[[ -n "$FRONTEND_PORT" ]] || FRONTEND_PORT="$(read_env_config "$BASE_ENV_FILE" "FRONTEND_PORT" || true)"
[[ -n "$BACKEND_ORIGIN_OVERRIDE" ]] || BACKEND_ORIGIN_OVERRIDE="$(read_env_config "$BASE_ENV_FILE" "BACKEND_ORIGIN" || true)"

if [[ -n "${env_backend_host:-}" ]]; then
  default_backend_host="$env_backend_host"
fi

FRONTEND_HOST="${FRONTEND_HOST:-0.0.0.0}"
effective_backend_host="${BACKEND_HOST_OVERRIDE:-$default_backend_host}"
effective_backend_port="${BACKEND_PORT_OVERRIDE:-${env_backend_port:-}}"

require_port_value "$effective_backend_port" "BACKEND_PORT" "copy from .env.example"
require_port_value "$FRONTEND_PORT" "FRONTEND_PORT" "copy from .env.example"

BACKEND_ORIGIN="${BACKEND_ORIGIN_OVERRIDE:-http://$effective_backend_host:$effective_backend_port}"
backend_override_args=("--server.address=$effective_backend_host" "--server.port=$effective_backend_port")

require_release_artifact "$BACKEND_BINARY"
require_release_artifact "$RELEASE_DIR/frontend/server.js"
require_release_artifact "$RELEASE_DIR/frontend/package.json"
require_release_artifact "$RELEASE_DIR/frontend/dist/index.html"

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
  set +u
  backend_app_args=()
  if [[ -n "${BACKEND_ARGS//[[:space:]]/}" ]]; then
    # shellcheck disable=SC2206
    backend_app_args=($BACKEND_ARGS)
  fi

  nohup "$BACKEND_BINARY" "${backend_override_args[@]}" "${backend_app_args[@]}" >"$BACKEND_LOG_FILE" 2>&1 &
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

echo "[start] backend  pid=$backend_pid  http://$effective_backend_host:$effective_backend_port"
echo "[start] backend binary=$BACKEND_BINARY"
echo "[start] frontend pid=$frontend_pid http://$FRONTEND_HOST:$FRONTEND_PORT"
echo "[start] loaded env defaults from $BASE_ENV_FILE"
if [[ -n "$config_path" ]]; then
  echo "[start] backend config file: $config_path"
else
  echo "[start] backend config file: embedded defaults only"
fi
echo "[start] logs: $BACKEND_LOG_FILE , $FRONTEND_LOG_FILE"

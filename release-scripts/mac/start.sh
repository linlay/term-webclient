#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
if [[ $# -ge 1 ]]; then
  if [[ "$1" = /* ]]; then
    RELEASE_DIR="$1"
  else
    RELEASE_DIR="$ROOT_DIR/$1"
  fi
elif [[ -f "$ROOT_DIR/backend/app.jar" ]] && [[ -f "$ROOT_DIR/frontend/server.js" ]]; then
  RELEASE_DIR="$ROOT_DIR"
else
  RELEASE_DIR="$ROOT_DIR/release"
fi

RUN_DIR="$RELEASE_DIR/run"
LOG_DIR="$RELEASE_DIR/logs"
BASE_ENV_FILE="$RELEASE_DIR/.env"
BACKEND_CONFIG_FILE="$RELEASE_DIR/application.yml"

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
REQUIRED_JAVA_MAJOR=21
JAVA_CMD=""
BACKEND_JAR=""

die() {
  echo "[start] $*"
  exit 1
}

require_config_file() {
  local path="$1"
  local hint="$2"
  if [[ ! -f "$path" ]]; then
    die "missing required config: $path ($hint)"
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

require_release_artifact() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    die "missing required release artifact: $path (release dir: $RELEASE_DIR)"
  fi
}

resolve_backend_jar() {
  local release_dir="$1"
  local release_jar="$release_dir/backend/app.jar"
  if [[ -f "$release_jar" ]]; then
    printf '%s\n' "$release_jar"
    return 0
  fi

  local target_dir="$release_dir/backend/target"
  if [[ -d "$target_dir" ]]; then
    local target_jar
    target_jar="$(find "$target_dir" -maxdepth 1 -type f -name '*.jar' ! -name 'original-*.jar' | sort | tail -n 1)"
    if [[ -n "$target_jar" ]]; then
      printf '%s\n' "$target_jar"
      return 0
    fi
  fi

  return 1
}

resolve_java_cmd() {
  if [[ -n "${JAVA:-}" ]]; then
    JAVA_CMD="$JAVA"
  elif [[ -n "${JAVA_HOME:-}" ]] && [[ -x "${JAVA_HOME%/}/bin/java" ]]; then
    JAVA_CMD="${JAVA_HOME%/}/bin/java"
  else
    JAVA_CMD="$(command -v java || true)"
  fi

  if [[ -z "$JAVA_CMD" ]]; then
    die "unable to locate Java runtime (need JDK $REQUIRED_JAVA_MAJOR+)"
  fi
}

get_java_major_version() {
  local java_cmd="$1"
  local version_line raw_version major
  version_line="$("$java_cmd" -version 2>&1 | awk 'NR==1 { print; exit }')"
  raw_version="$(printf '%s' "$version_line" | sed -E 's/.*version "([^"]+)".*/\1/')"
  if [[ "$raw_version" == "$version_line" ]]; then
    return 1
  fi
  major="${raw_version%%.*}"
  if [[ "$major" == "1" ]]; then
    major="$(printf '%s' "$raw_version" | awk -F. '{ print $2 }')"
  fi
  if [[ ! "$major" =~ ^[0-9]+$ ]]; then
    return 1
  fi
  printf '%s\n' "$major"
}

require_java_version() {
  local detected_major version_line
  detected_major="$(get_java_major_version "$JAVA_CMD" || true)"
  version_line="$("$JAVA_CMD" -version 2>&1 | awk 'NR==1 { print; exit }')"
  if [[ -z "$detected_major" ]]; then
    die "unable to parse Java version from: $version_line"
  fi
  if (( detected_major < REQUIRED_JAVA_MAJOR )); then
    die "Java runtime too old: $version_line (need JDK $REQUIRED_JAVA_MAJOR+)"
  fi
}

require_config_file "$BASE_ENV_FILE" "copy from .env.example"
require_config_file "$BACKEND_CONFIG_FILE" "copy from application.example.yml"

mkdir -p "$RUN_DIR" "$LOG_DIR" "$RELEASE_DIR/data"
resolve_java_cmd
require_java_version

default_backend_host="127.0.0.1"
default_backend_port="11946"

[[ -n "$BACKEND_HOST_OVERRIDE" ]] || env_backend_host="$(read_env_config "$BASE_ENV_FILE" "BACKEND_HOST" || true)"
[[ -n "$BACKEND_PORT_OVERRIDE" ]] || env_backend_port="$(read_env_config "$BASE_ENV_FILE" "BACKEND_PORT" || true)"
[[ -n "$FRONTEND_HOST" ]] || FRONTEND_HOST="$(read_env_config "$BASE_ENV_FILE" "FRONTEND_HOST" || true)"
[[ -n "$FRONTEND_PORT" ]] || FRONTEND_PORT="$(read_env_config "$BASE_ENV_FILE" "FRONTEND_PORT" || true)"
[[ -n "$FRONTEND_HOST" ]] || FRONTEND_HOST="$(read_env_config "$BASE_ENV_FILE" "HOST" || true)"
[[ -n "$FRONTEND_PORT" ]] || FRONTEND_PORT="$(read_env_config "$BASE_ENV_FILE" "PORT" || true)"
[[ -n "$BACKEND_ORIGIN_OVERRIDE" ]] || BACKEND_ORIGIN_OVERRIDE="$(read_env_config "$BASE_ENV_FILE" "BACKEND_ORIGIN" || true)"

if [[ -n "${env_backend_host:-}" ]]; then
  default_backend_host="$env_backend_host"
fi
if [[ -n "${env_backend_port:-}" ]]; then
  default_backend_port="$env_backend_port"
fi

FRONTEND_HOST="${FRONTEND_HOST:-0.0.0.0}"
FRONTEND_PORT="${FRONTEND_PORT:-11947}"

effective_backend_host="${BACKEND_HOST_OVERRIDE:-$default_backend_host}"
effective_backend_port="${BACKEND_PORT_OVERRIDE:-$default_backend_port}"
BACKEND_ORIGIN="${BACKEND_ORIGIN_OVERRIDE:-http://$effective_backend_host:$effective_backend_port}"

backend_override_args=()
# Keep runtime bind host/port aligned with .env and explicit overrides.
backend_override_args+=("--server.address=$effective_backend_host")
backend_override_args+=("--server.port=$effective_backend_port")

if ! BACKEND_JAR="$(resolve_backend_jar "$RELEASE_DIR")"; then
  die "missing backend jar under $RELEASE_DIR/backend/app.jar or $RELEASE_DIR/backend/target/*.jar"
fi
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
  backend_java_opts_args=()
  backend_app_args=()
  if [[ -n "${BACKEND_JAVA_OPTS//[[:space:]]/}" ]]; then
    # Intentionally split by shell words to keep compatibility with existing BACKEND_JAVA_OPTS usage.
    # shellcheck disable=SC2206
    backend_java_opts_args=($BACKEND_JAVA_OPTS)
  fi
  if [[ -n "${BACKEND_ARGS//[[:space:]]/}" ]]; then
    # shellcheck disable=SC2206
    backend_app_args=($BACKEND_ARGS)
  fi

  nohup "$JAVA_CMD" "${backend_java_opts_args[@]}" -jar "$BACKEND_JAR" \
    "${backend_override_args[@]}" "${backend_app_args[@]}" \
    >"$BACKEND_LOG_FILE" 2>&1 &
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
echo "[start] java cmd=$JAVA_CMD ($("$JAVA_CMD" -version 2>&1 | awk 'NR==1 { print; exit }'))"
echo "[start] frontend pid=$frontend_pid http://$FRONTEND_HOST:$FRONTEND_PORT"
echo "[start] loaded env defaults from $BASE_ENV_FILE"
echo "[start] backend config file: $BACKEND_CONFIG_FILE"
echo "[start] logs: $BACKEND_LOG_FILE , $FRONTEND_LOG_FILE"

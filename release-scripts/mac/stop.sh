#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
BASE_ENV_FILE_NAME=".env"
BACKEND_CONFIG_FILE_NAME="application.yml"

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

die() {
  echo "[stop] $*"
  exit 1
}

require_config_file() {
  local path="$1"
  local hint="$2"
  if [[ ! -f "$path" ]]; then
    die "missing required config: $path ($hint)"
  fi
}

has_runtime_config() {
  local dir="$1"
  [[ -f "$dir/$BASE_ENV_FILE_NAME" ]] && [[ -f "$dir/$BACKEND_CONFIG_FILE_NAME" ]]
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

is_running() {
  local pid="$1"
  kill -0 "$pid" >/dev/null 2>&1
}

stop_by_pid_file() {
  local name="$1"
  local pid_file="$2"

  if [[ ! -f "$pid_file" ]]; then
    echo "[stop] $name not running (pid file missing)"
    return
  fi

  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [[ -z "$pid" ]]; then
    rm -f "$pid_file"
    echo "[stop] $name pid file is empty, cleaned"
    return
  fi

  if ! is_running "$pid"; then
    rm -f "$pid_file"
    echo "[stop] $name already stopped (stale pid=$pid)"
    return
  fi

  kill "$pid" >/dev/null 2>&1 || true

  for _ in $(seq 1 15); do
    if ! is_running "$pid"; then
      rm -f "$pid_file"
      echo "[stop] $name stopped (pid=$pid)"
      return
    fi
    sleep 1
  done

  kill -9 "$pid" >/dev/null 2>&1 || true
  rm -f "$pid_file"
  echo "[stop] $name forced to stop (pid=$pid)"
}

is_expected_command() {
  local name="$1"
  local cmd="$2"

  case "$name" in
    backend)
      if [[ "$cmd" != *java* ]]; then
        return 1
      fi
      if [[ "$cmd" == *"backend/app.jar"* || "$cmd" == *"org.springframework.boot.loader"* || "$cmd" == *spring-boot* ]]; then
        return 0
      fi
      return 1
      ;;
    frontend)
      if [[ "$cmd" == *node* && "$cmd" == *server.js* ]]; then
        return 0
      fi
      return 1
      ;;
    *)
      return 1
      ;;
  esac
}

stop_by_port() {
  local name="$1"
  local port="$2"

  if [[ -z "$port" ]]; then
    return
  fi

  if ! command -v lsof >/dev/null 2>&1; then
    echo "[stop] lsof not found, skip port fallback for $name:$port"
    return
  fi

  local pids
  pids="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -z "$pids" ]]; then
    echo "[stop] $name not running on port $port"
    return
  fi

  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    if ! is_running "$pid"; then
      echo "[stop] $name listener pid=$pid on port $port is not signalable, skipped"
      continue
    fi

    local cmd
    cmd="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    if ! is_expected_command "$name" "$cmd"; then
      echo "[stop] $name listener pid=$pid on port $port skipped (unexpected command: $cmd)"
      continue
    fi

    kill "$pid" >/dev/null 2>&1 || true

    for _ in $(seq 1 15); do
      if ! is_running "$pid"; then
        echo "[stop] $name stopped by port fallback (pid=$pid port=$port)"
        break
      fi
      sleep 1
    done

    if is_running "$pid"; then
      kill -9 "$pid" >/dev/null 2>&1 || true
      echo "[stop] $name forced to stop by port fallback (pid=$pid port=$port)"
    fi
  done <<< "$pids"
}

resolve_backend_port() {
  local env_file="$1"
  local backend_port="11946"
  local env_backend_port
  env_backend_port="$(read_env_config "$env_file" "BACKEND_PORT" || true)"
  if [[ -n "$env_backend_port" ]]; then
    backend_port="$env_backend_port"
  fi

  echo "$backend_port"
}

resolve_frontend_port() {
  local env_file="$1"
  local frontend_port="11947"
  local config_frontend_port
  config_frontend_port="$(read_env_config "$env_file" "FRONTEND_PORT" || true)"
  if [[ -n "$config_frontend_port" ]]; then
    frontend_port="$config_frontend_port"
  fi

  echo "$frontend_port"
}

if [[ $# -ge 1 ]]; then
  RELEASE_DIR="$(resolve_release_dir "$1")"
else
  RELEASE_DIR="$(resolve_release_dir)"
fi
BASE_ENV_FILE="$RELEASE_DIR/$BASE_ENV_FILE_NAME"
BACKEND_CONFIG_FILE="$RELEASE_DIR/$BACKEND_CONFIG_FILE_NAME"
RUN_DIR="$RELEASE_DIR/run"

require_config_file "$BASE_ENV_FILE" "copy from .env.example"
require_config_file "$BACKEND_CONFIG_FILE" "copy from application.example.yml"

echo "[stop] checking $RELEASE_DIR"
stop_by_pid_file "frontend" "$RUN_DIR/frontend.pid"
stop_by_pid_file "backend" "$RUN_DIR/backend.pid"

backend_port="$(resolve_backend_port "$BASE_ENV_FILE")"
frontend_port="$(resolve_frontend_port "$BASE_ENV_FILE")"
stop_by_port "frontend" "$frontend_port"
stop_by_port "backend" "$backend_port"

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_DIR="$SCRIPT_DIR"
BUNDLE_ENV_FILE="$RELEASE_DIR/bundle.env"
BASE_ENV_FILE="$RELEASE_DIR/.env"
RUN_DIR="$RELEASE_DIR/run"
BACKEND_PID_FILE="$RUN_DIR/backend.pid"
FRONTEND_CONTAINER_FILE="$RUN_DIR/frontend.container"

die() {
  echo "[stop] $*" >&2
  exit 1
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

stop_frontend_container() {
  local container_name="${1:-}"
  if [[ -z "$container_name" ]]; then
    echo "[stop] frontend not running (container name missing)"
    return
  fi
  if ! command -v docker >/dev/null 2>&1; then
    echo "[stop] docker not found; cannot stop frontend container $container_name"
    return
  fi
  if ! docker container inspect "$container_name" >/dev/null 2>&1; then
    echo "[stop] frontend already stopped ($container_name)"
    return
  fi
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  echo "[stop] frontend stopped ($container_name)"
}

[[ -d "$RELEASE_DIR" ]] || die "missing release dir: $RELEASE_DIR"

frontend_container_name=""
if [[ -f "$FRONTEND_CONTAINER_FILE" ]]; then
  frontend_container_name="$(cat "$FRONTEND_CONTAINER_FILE" 2>/dev/null || true)"
fi

if [[ -z "$frontend_container_name" && -f "$BUNDLE_ENV_FILE" && -f "$BASE_ENV_FILE" ]]; then
  set -a
  . "$BUNDLE_ENV_FILE"
  . "$BASE_ENV_FILE"
  set +a
  if [[ -n "${FRONTEND_PORT:-}" ]]; then
    frontend_container_name="${FRONTEND_CONTAINER_NAME_PREFIX:-term-webclient-frontend}-${FRONTEND_PORT}"
  fi
fi

echo "[stop] checking $RELEASE_DIR"
stop_frontend_container "$frontend_container_name"
rm -f "$FRONTEND_CONTAINER_FILE"
stop_by_pid_file "backend" "$BACKEND_PID_FILE"

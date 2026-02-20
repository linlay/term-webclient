#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ $# -ge 1 ]]; then
  RELEASE_DIR="$1"
elif [[ -d "$ROOT_DIR/run" ]]; then
  RELEASE_DIR="$ROOT_DIR"
else
  RELEASE_DIR="$ROOT_DIR/release"
fi
RUN_DIR="$RELEASE_DIR/run"

BACKEND_PID_FILE="$RUN_DIR/backend.pid"
FRONTEND_PID_FILE="$RUN_DIR/frontend.pid"

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

stop_by_pid_file "frontend" "$FRONTEND_PID_FILE"
stop_by_pid_file "backend" "$BACKEND_PID_FILE"

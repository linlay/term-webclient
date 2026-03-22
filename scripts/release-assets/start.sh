#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_DIR="$SCRIPT_DIR"
BUNDLE_ENV_FILE="$RELEASE_DIR/bundle.env"
BASE_ENV_FILE="$RELEASE_DIR/.env"
RUN_DIR="$RELEASE_DIR/run"
LOG_DIR="$RELEASE_DIR/logs"
DATA_DIR="$RELEASE_DIR/data"
BACKEND_PID_FILE="$RUN_DIR/backend.pid"
FRONTEND_CONTAINER_FILE="$RUN_DIR/frontend.container"
BACKEND_LOG_FILE="$LOG_DIR/backend.out"

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

container_exists() {
  local name="$1"
  docker container inspect "$name" >/dev/null 2>&1
}

container_running() {
  local name="$1"
  [[ "$(docker inspect --format '{{.State.Running}}' "$name" 2>/dev/null || true)" == "true" ]]
}

[[ -f "$BUNDLE_ENV_FILE" ]] || die "missing bundle metadata: $BUNDLE_ENV_FILE"
[[ -f "$BASE_ENV_FILE" ]] || die "missing required config: $BASE_ENV_FILE (copy from .env.example)"

set -a
. "$BUNDLE_ENV_FILE"
. "$BASE_ENV_FILE"
set +a

BACKEND_BINARY="${BACKEND_BINARY:-backend/term-web-backend}"
BACKEND_BINARY_PATH="$RELEASE_DIR/$BACKEND_BINARY"
FRONTEND_IMAGE_ARCHIVE="${FRONTEND_IMAGE_ARCHIVE:-images/term-webclient-frontend.tar}"
FRONTEND_IMAGE_ARCHIVE_PATH="$RELEASE_DIR/$FRONTEND_IMAGE_ARCHIVE"
FRONTEND_IMAGE_TAG="${FRONTEND_IMAGE_TAG:-term-webclient-frontend:unknown}"
FRONTEND_CONTAINER_NAME_PREFIX="${FRONTEND_CONTAINER_NAME_PREFIX:-term-webclient-frontend}"
BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-}"
BACKEND_BIND_HOST="${BACKEND_BIND_HOST:-0.0.0.0}"
FRONTEND_HOST="${FRONTEND_HOST:-0.0.0.0}"
FRONTEND_PORT="${FRONTEND_PORT:-}"
BACKEND_ARGS="${BACKEND_ARGS:-}"
CONFIG_PATH="${CONFIG_PATH:-}"
FRONTEND_CONTAINER_NAME="${FRONTEND_CONTAINER_NAME_PREFIX}-${FRONTEND_PORT}"

command -v docker >/dev/null 2>&1 || die "docker not found; install and start Docker Desktop first"
docker info >/dev/null 2>&1 || die "docker is not available; start Docker Desktop first"

[[ -x "$BACKEND_BINARY_PATH" ]] || die "missing required release artifact: $BACKEND_BINARY_PATH"
[[ -f "$FRONTEND_IMAGE_ARCHIVE_PATH" ]] || die "missing required release artifact: $FRONTEND_IMAGE_ARCHIVE_PATH"

require_port "$BACKEND_PORT" "BACKEND_PORT"
require_port "$FRONTEND_PORT" "FRONTEND_PORT"

if [[ -n "$CONFIG_PATH" ]]; then
  if [[ "$CONFIG_PATH" = /* ]]; then
    RESOLVED_CONFIG_PATH="$CONFIG_PATH"
  else
    RESOLVED_CONFIG_PATH="$RELEASE_DIR/$CONFIG_PATH"
  fi
  [[ -f "$RESOLVED_CONFIG_PATH" ]] || die "missing required config: $RESOLVED_CONFIG_PATH"
fi

mkdir -p "$RUN_DIR" "$LOG_DIR" "$DATA_DIR"

if [[ -f "$BACKEND_PID_FILE" ]]; then
  backend_pid="$(cat "$BACKEND_PID_FILE" 2>/dev/null || true)"
  if [[ -n "$backend_pid" ]] && is_running "$backend_pid"; then
    die "backend is already running (pid=$backend_pid)"
  fi
  rm -f "$BACKEND_PID_FILE"
fi

if [[ -f "$FRONTEND_CONTAINER_FILE" ]]; then
  stale_container="$(cat "$FRONTEND_CONTAINER_FILE" 2>/dev/null || true)"
  if [[ -n "$stale_container" ]] && container_running "$stale_container"; then
    die "frontend container is already running ($stale_container)"
  fi
  rm -f "$FRONTEND_CONTAINER_FILE"
fi

if container_exists "$FRONTEND_CONTAINER_NAME"; then
  if container_running "$FRONTEND_CONTAINER_NAME"; then
    die "frontend container is already running ($FRONTEND_CONTAINER_NAME)"
  fi
  docker rm -f "$FRONTEND_CONTAINER_NAME" >/dev/null 2>&1 || true
fi

echo "[start] loading frontend image $FRONTEND_IMAGE_TAG"
docker load -i "$FRONTEND_IMAGE_ARCHIVE_PATH" >/dev/null

(
  cd "$RELEASE_DIR"
  if [[ -n "${BACKEND_ARGS//[[:space:]]/}" ]]; then
    # shellcheck disable=SC2206
    backend_app_args=($BACKEND_ARGS)
    nohup "$BACKEND_BINARY_PATH" --server.address="$BACKEND_BIND_HOST" --server.port="$BACKEND_PORT" "${backend_app_args[@]}" >"$BACKEND_LOG_FILE" 2>&1 &
  else
    nohup "$BACKEND_BINARY_PATH" --server.address="$BACKEND_BIND_HOST" --server.port="$BACKEND_PORT" >"$BACKEND_LOG_FILE" 2>&1 &
  fi
  echo $! >"$BACKEND_PID_FILE"
)

sleep 1
backend_pid="$(cat "$BACKEND_PID_FILE" 2>/dev/null || true)"
if [[ -z "$backend_pid" ]] || ! is_running "$backend_pid"; then
  rm -f "$BACKEND_PID_FILE"
  die "backend failed to start, see $BACKEND_LOG_FILE"
fi

if ! docker run -d \
  --name "$FRONTEND_CONTAINER_NAME" \
  -p "${FRONTEND_HOST}:${FRONTEND_PORT}:11947" \
  -e HOST=0.0.0.0 \
  -e PORT=11947 \
  -e BACKEND_PORT="${BACKEND_PORT}" \
  -e BACKEND_ORIGIN="http://host.docker.internal:${BACKEND_PORT}" \
  "$FRONTEND_IMAGE_TAG" >/dev/null; then
  kill "$backend_pid" >/dev/null 2>&1 || true
  rm -f "$BACKEND_PID_FILE"
  die "frontend container failed to start"
fi

sleep 1
if ! container_running "$FRONTEND_CONTAINER_NAME"; then
  docker rm -f "$FRONTEND_CONTAINER_NAME" >/dev/null 2>&1 || true
  kill "$backend_pid" >/dev/null 2>&1 || true
  rm -f "$BACKEND_PID_FILE"
  die "frontend container failed to stay running"
fi

printf '%s\n' "$FRONTEND_CONTAINER_NAME" >"$FRONTEND_CONTAINER_FILE"

echo "[start] backend  pid=$backend_pid  http://127.0.0.1:$BACKEND_PORT"
echo "[start] frontend container=$FRONTEND_CONTAINER_NAME  http://127.0.0.1:$FRONTEND_PORT"
echo "[start] backend bind host: $BACKEND_BIND_HOST"
echo "[start] bundle version: ${APP_VERSION:-unknown}"
echo "[start] logs: $BACKEND_LOG_FILE"
echo "[start] frontend logs: docker logs $FRONTEND_CONTAINER_NAME"

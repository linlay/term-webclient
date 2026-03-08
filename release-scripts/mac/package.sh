#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEFAULT_OUTPUT_DIR="$ROOT_DIR/release"
if [[ $# -ge 1 ]]; then
  if [[ "$1" = /* ]]; then
    OUTPUT_DIR="$1"
  else
    OUTPUT_DIR="$ROOT_DIR/$1"
  fi
else
  OUTPUT_DIR="$DEFAULT_OUTPUT_DIR"
fi
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
APP_ENV="${APP_ENV:-production}"
BACKEND_GOPROXY="${BACKEND_GOPROXY:-https://goproxy.cn,https://proxy.golang.org,direct}"
BACKEND_GOSUMDB="${BACKEND_GOSUMDB:-sum.golang.google.cn}"

if [[ "$APP_ENV" != "development" && "$APP_ENV" != "production" ]]; then
  echo "[package] invalid APP_ENV: $APP_ENV (expected: development|production)"
  exit 1
fi

echo "[package] root: $ROOT_DIR"
echo "[package] output: $OUTPUT_DIR"
echo "[package] app env: $APP_ENV"

if ! command -v go >/dev/null 2>&1; then
  echo "[package] go not found"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[package] npm not found"
  exit 1
fi

echo "[package] preparing release directory"
mkdir -p "$OUTPUT_DIR"
rm -rf "$OUTPUT_DIR/backend" "$OUTPUT_DIR/frontend" "$OUTPUT_DIR/release-scripts"
mkdir -p "$OUTPUT_DIR/backend" "$OUTPUT_DIR/frontend" "$OUTPUT_DIR/release-scripts/mac" "$OUTPUT_DIR/release-scripts/windows" "$OUTPUT_DIR/configs"

echo "[package] building backend binary"
(
  cd "$BACKEND_DIR"
  mkdir -p .gocache .gomodcache
  GOCACHE="$BACKEND_DIR/.gocache" GOMODCACHE="$BACKEND_DIR/.gomodcache" GOPROXY="$BACKEND_GOPROXY" GOSUMDB="$BACKEND_GOSUMDB" GOFLAGS=-mod=mod go build -o "$OUTPUT_DIR/backend/term-web-backend" ./cmd/server
)

echo "[package] building frontend dist"
(
  cd "$FRONTEND_DIR"
  npm ci
  npm run build -- --mode "$APP_ENV"
)

cp "$FRONTEND_DIR/server.js" "$OUTPUT_DIR/frontend/server.js"
cp "$FRONTEND_DIR/package.json" "$OUTPUT_DIR/frontend/package.json"
cp "$FRONTEND_DIR/package-lock.json" "$OUTPUT_DIR/frontend/package-lock.json"
cp -R "$FRONTEND_DIR/dist" "$OUTPUT_DIR/frontend/dist"

echo "[package] installing frontend runtime dependencies"
(
  cd "$OUTPUT_DIR/frontend"
  npm ci --omit=dev
)

cp "$ROOT_DIR/.env.example" "$OUTPUT_DIR/.env.example"
if [[ -d "$ROOT_DIR/configs" ]]; then
  while IFS= read -r config_path; do
    cp "$config_path" "$OUTPUT_DIR/configs/"
  done < <(find "$ROOT_DIR/configs" -maxdepth 1 -type f -name '*.example.yml' | sort)
fi

cp "$SCRIPT_DIR/start.sh" "$OUTPUT_DIR/release-scripts/mac/start.sh"
cp "$SCRIPT_DIR/stop.sh" "$OUTPUT_DIR/release-scripts/mac/stop.sh"
chmod +x "$OUTPUT_DIR/backend/term-web-backend" "$OUTPUT_DIR/release-scripts/mac/start.sh" "$OUTPUT_DIR/release-scripts/mac/stop.sh"

if [[ -d "$ROOT_DIR/release-scripts/windows" ]]; then
  while IFS= read -r script_path; do
    cp "$script_path" "$OUTPUT_DIR/release-scripts/windows/"
  done < <(find "$ROOT_DIR/release-scripts/windows" -maxdepth 1 -type f \( -name '*.ps1' -o -name '*.bat' \) | sort)
fi

echo "[package] done"
echo "[package] backend binary: $OUTPUT_DIR/backend/term-web-backend"
echo "[package] start: $OUTPUT_DIR/release-scripts/mac/start.sh"
echo "[package] stop : $OUTPUT_DIR/release-scripts/mac/stop.sh"
echo "[package] example env: $OUTPUT_DIR/.env.example"
echo "[package] example configs: $OUTPUT_DIR/configs/"
echo "[package] runtime requires: $OUTPUT_DIR/.env"
echo "[package] runtime optional: set CONFIG_PATH in .env to a file under $OUTPUT_DIR/configs/"

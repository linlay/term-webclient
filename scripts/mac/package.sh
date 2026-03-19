#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
OUTPUT_DIR="${1:-$ROOT_DIR/release}"
[[ "$OUTPUT_DIR" = /* ]] || OUTPUT_DIR="$ROOT_DIR/$OUTPUT_DIR"
APP_ENV="${APP_ENV:-production}"
BACKEND_GOPROXY="${BACKEND_GOPROXY:-https://goproxy.cn,https://proxy.golang.org,direct}"
BACKEND_GOSUMDB="${BACKEND_GOSUMDB:-sum.golang.google.cn}"

clear_dir_contents() {
  local dir="$1"
  mkdir -p "$dir"
  find "$dir" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
}

if [[ "$APP_ENV" != "development" && "$APP_ENV" != "production" ]]; then
  echo "[package] invalid APP_ENV: $APP_ENV (expected: development|production)"
  exit 1
fi

command -v go >/dev/null 2>&1 || { echo "[package] go not found"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "[package] npm not found"; exit 1; }

echo "[package] preparing release directory"
if [[ -z "$OUTPUT_DIR" || "$OUTPUT_DIR" = "/" ]]; then
  echo "[package] refusing to remove unsafe output directory: $OUTPUT_DIR"
  exit 1
fi
mkdir -p "$OUTPUT_DIR" "$OUTPUT_DIR/configs"
clear_dir_contents "$OUTPUT_DIR/backend"
clear_dir_contents "$OUTPUT_DIR/frontend"
clear_dir_contents "$OUTPUT_DIR/run"
clear_dir_contents "$OUTPUT_DIR/logs"
mkdir -p "$OUTPUT_DIR/configs/cli-clients"
rm -f "$OUTPUT_DIR/start.sh" "$OUTPUT_DIR/stop.sh"

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
    target_path="$OUTPUT_DIR/configs/$(basename "$config_path")"
    if [[ ! -e "$target_path" ]]; then
      cp "$config_path" "$target_path"
    fi
  done < <(find "$ROOT_DIR/configs" -maxdepth 1 -type f \( -name '*.example.pem' -o -name '*.example.yml' \) | sort)
fi

if [[ -d "$ROOT_DIR/configs/cli-clients" ]]; then
  while IFS= read -r config_path; do
    target_path="$OUTPUT_DIR/configs/cli-clients/$(basename "$config_path")"
    if [[ ! -e "$target_path" ]]; then
      cp "$config_path" "$target_path"
    fi
  done < <(find "$ROOT_DIR/configs/cli-clients" -maxdepth 1 -type f -name '*.example.yml' | sort)
fi

cp "$SCRIPT_DIR/start.sh" "$OUTPUT_DIR/start.sh"
cp "$SCRIPT_DIR/stop.sh" "$OUTPUT_DIR/stop.sh"
chmod +x "$OUTPUT_DIR/backend/term-web-backend" "$OUTPUT_DIR/start.sh" "$OUTPUT_DIR/stop.sh"

echo "[package] done"
echo "[package] backend binary: $OUTPUT_DIR/backend/term-web-backend"
echo "[package] entrypoints: $OUTPUT_DIR/start.sh , $OUTPUT_DIR/stop.sh"
echo "[package] example env: $OUTPUT_DIR/.env.example"
echo "[package] runtime env: $OUTPUT_DIR/.env"

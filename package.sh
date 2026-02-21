#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="${1:-$ROOT_DIR/release}"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
APP_ENV="${APP_ENV:-production}"

if [[ "$APP_ENV" != "development" && "$APP_ENV" != "production" ]]; then
  echo "[package] invalid APP_ENV: $APP_ENV (expected: development|production)"
  exit 1
fi

echo "[package] root: $ROOT_DIR"
echo "[package] output: $OUTPUT_DIR"
echo "[package] app env: $APP_ENV"

if ! command -v mvn >/dev/null 2>&1; then
  echo "[package] maven (mvn) not found"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[package] npm not found"
  exit 1
fi

echo "[package] building backend jar"
(
  cd "$BACKEND_DIR"
  mvn -q -DskipTests package
)

backend_jar="$(find "$BACKEND_DIR/target" -maxdepth 1 -type f -name '*.jar' ! -name 'original-*.jar' | sort | tail -n 1)"
if [[ -z "$backend_jar" ]]; then
  echo "[package] backend jar not found"
  exit 1
fi

echo "[package] building frontend dist"
(
  cd "$FRONTEND_DIR"
  npm ci
  npm run build -- --mode "$APP_ENV"
)

echo "[package] preparing release directory"
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR/backend" "$OUTPUT_DIR/frontend" "$OUTPUT_DIR/logs" "$OUTPUT_DIR/run" "$OUTPUT_DIR/data"

cp "$backend_jar" "$OUTPUT_DIR/backend/app.jar"
if [[ -f "$BACKEND_DIR/application.yml" ]]; then
  cp "$BACKEND_DIR/application.yml" "$OUTPUT_DIR/backend/application.yml"
fi

cp "$FRONTEND_DIR/server.js" "$OUTPUT_DIR/frontend/server.js"
cp "$FRONTEND_DIR/package.json" "$OUTPUT_DIR/frontend/package.json"
cp "$FRONTEND_DIR/package-lock.json" "$OUTPUT_DIR/frontend/package-lock.json"
cp -R "$FRONTEND_DIR/dist" "$OUTPUT_DIR/frontend/dist"

echo "[package] installing frontend runtime dependencies"
(
  cd "$OUTPUT_DIR/frontend"
  npm ci --omit=dev
)

cp "$ROOT_DIR/start.sh" "$OUTPUT_DIR/start.sh"
cp "$ROOT_DIR/stop.sh" "$OUTPUT_DIR/stop.sh"
chmod +x "$OUTPUT_DIR/start.sh" "$OUTPUT_DIR/stop.sh"

echo "[package] done"
echo "[package] start: $OUTPUT_DIR/start.sh"
echo "[package] stop : $OUTPUT_DIR/stop.sh"

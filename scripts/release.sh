#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_NAME="term-webclient"
BACKEND_BINARY_NAME="term-web-backend"
FRONTEND_IMAGE_NAME="term-webclient-frontend"
VERSION_FILE="$ROOT_DIR/VERSION"
DIST_DIR="$ROOT_DIR/dist/release"
BUILD_ROOT="$ROOT_DIR/dist/.release-build"
ASSETS_DIR="$SCRIPT_DIR/release-assets"
FRONTEND_NODE_IMAGE="${FRONTEND_NODE_IMAGE:-node:22-bookworm-slim}"
BACKEND_GOPROXY="${BACKEND_GOPROXY:-https://goproxy.cn,https://proxy.golang.org,direct}"
BACKEND_GOSUMDB="${BACKEND_GOSUMDB:-sum.golang.google.cn}"

die() {
  echo "[release] $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

trim() {
  printf '%s' "$1" | tr -d '[:space:]'
}

clear_dir() {
  local dir="$1"
  if [[ -z "$dir" || "$dir" = "/" ]]; then
    die "refusing to clear unsafe directory: $dir"
  fi
  rm -rf "$dir"
  mkdir -p "$dir"
}

copy_example_configs() {
  local output_dir="$1"

  mkdir -p "$output_dir/configs" "$output_dir/configs/cli-clients"

  if [[ -d "$ROOT_DIR/configs" ]]; then
    while IFS= read -r config_path; do
      cp "$config_path" "$output_dir/configs/$(basename "$config_path")"
    done < <(find "$ROOT_DIR/configs" -maxdepth 1 -type f \( -name '*.example.pem' -o -name '*.example.yml' \) | sort)
  fi

  if [[ -d "$ROOT_DIR/configs/cli-clients" ]]; then
    while IFS= read -r config_path; do
      cp "$config_path" "$output_dir/configs/cli-clients/$(basename "$config_path")"
    done < <(find "$ROOT_DIR/configs/cli-clients" -maxdepth 1 -type f -name '*.example.yml' | sort)
  fi
}

detect_arch() {
  local raw_arch
  raw_arch="$(uname -m)"
  case "$raw_arch" in
    arm64|aarch64)
      printf 'arm64\n'
      ;;
    x86_64|amd64)
      printf 'amd64\n'
      ;;
    *)
      die "unsupported CPU architecture: $raw_arch"
      ;;
  esac
}

OS_NAME="$(uname -s)"
[[ "$OS_NAME" == "Darwin" ]] || die "make release only supports Darwin hosts"

ARCH="${ARCH:-$(detect_arch)}"
case "$ARCH" in
  arm64|amd64)
    ;;
  *)
    die "unsupported ARCH=$ARCH (expected arm64 or amd64)"
    ;;
esac

require_command go
require_command docker
require_command tar

if [[ -n "${VERSION:-}" ]]; then
  APP_VERSION="$(trim "$VERSION")"
else
  [[ -f "$VERSION_FILE" ]] || die "missing VERSION file: $VERSION_FILE"
  APP_VERSION="$(trim "$(cat "$VERSION_FILE")")"
fi
[[ "$APP_VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "invalid VERSION=$APP_VERSION (expected vX.Y.Z)"

GIT_SHA="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || true)"
if [[ -z "$GIT_SHA" ]]; then
  GIT_SHA="unknown"
fi
BUILD_TIME="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
DOCKER_PLATFORM="linux/$ARCH"
TARGET_OS="darwin"
BUNDLE_BASENAME="$APP_NAME-$APP_VERSION-$TARGET_OS-$ARCH"
STAGING_ROOT="$BUILD_ROOT/$BUNDLE_BASENAME"
BUNDLE_DIR="$STAGING_ROOT/$APP_NAME"
BUNDLE_PATH="$DIST_DIR/$BUNDLE_BASENAME.tar.gz"
FRONTEND_IMAGE_TAG="$FRONTEND_IMAGE_NAME:$APP_VERSION"
FRONTEND_IMAGE_TAR="$BUNDLE_DIR/images/$FRONTEND_IMAGE_NAME.tar"

echo "[release] preparing staging directory"
mkdir -p "$DIST_DIR" "$BUILD_ROOT"
clear_dir "$STAGING_ROOT"
mkdir -p \
  "$BUNDLE_DIR/backend" \
  "$BUNDLE_DIR/images" \
  "$BUNDLE_DIR/data" \
  "$BUNDLE_DIR/run" \
  "$BUNDLE_DIR/logs"

echo "[release] building backend binary for $TARGET_OS/$ARCH"
(
  cd "$ROOT_DIR/backend"
  mkdir -p .gocache .gomodcache
  GOCACHE="$ROOT_DIR/backend/.gocache" \
  GOMODCACHE="$ROOT_DIR/backend/.gomodcache" \
  GOPROXY="$BACKEND_GOPROXY" \
  GOSUMDB="$BACKEND_GOSUMDB" \
  GOFLAGS=-mod=mod \
  CGO_ENABLED=0 \
  GOOS="$TARGET_OS" \
  GOARCH="$ARCH" \
  go build \
    -ldflags "-X main.appVersion=$APP_VERSION -X main.appGitSHA=$GIT_SHA -X main.appBuildTime=$BUILD_TIME" \
    -o "$BUNDLE_DIR/backend/$BACKEND_BINARY_NAME" \
    ./cmd/server
)

echo "[release] building frontend image for $DOCKER_PLATFORM"
docker buildx build \
  --platform "$DOCKER_PLATFORM" \
  --file "$ROOT_DIR/frontend/Dockerfile" \
  --build-arg "NODE_IMAGE=$FRONTEND_NODE_IMAGE" \
  --tag "$FRONTEND_IMAGE_TAG" \
  --output "type=docker,dest=$FRONTEND_IMAGE_TAR" \
  "$ROOT_DIR"

echo "[release] copying bundle assets"
cp "$ROOT_DIR/.env.example" "$BUNDLE_DIR/.env.example"
copy_example_configs "$BUNDLE_DIR"
cp "$ASSETS_DIR/start.sh" "$BUNDLE_DIR/start.sh"
cp "$ASSETS_DIR/stop.sh" "$BUNDLE_DIR/stop.sh"
cp "$ASSETS_DIR/README.txt" "$BUNDLE_DIR/README.txt"
chmod +x \
  "$BUNDLE_DIR/backend/$BACKEND_BINARY_NAME" \
  "$BUNDLE_DIR/start.sh" \
  "$BUNDLE_DIR/stop.sh"

cat >"$BUNDLE_DIR/bundle.env" <<EOF
APP_NAME=$APP_NAME
APP_VERSION=$APP_VERSION
TARGET_OS=$TARGET_OS
TARGET_ARCH=$ARCH
GIT_SHA=$GIT_SHA
BUILD_TIME=$BUILD_TIME
FRONTEND_IMAGE_NAME=$FRONTEND_IMAGE_NAME
FRONTEND_IMAGE_TAG=$FRONTEND_IMAGE_TAG
FRONTEND_IMAGE_ARCHIVE=images/$FRONTEND_IMAGE_NAME.tar
FRONTEND_CONTAINER_NAME_PREFIX=$APP_NAME-frontend
BACKEND_BINARY=backend/$BACKEND_BINARY_NAME
EOF

echo "[release] creating bundle $BUNDLE_PATH"
rm -f "$BUNDLE_PATH"
tar -C "$STAGING_ROOT" -czf "$BUNDLE_PATH" "$APP_NAME"

echo "[release] done"
echo "[release] version: $APP_VERSION"
echo "[release] bundle: $BUNDLE_PATH"

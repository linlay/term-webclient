BACKEND_DIR := backend
FRONTEND_DIR := frontend
BACKEND_GOCACHE := $(CURDIR)/$(BACKEND_DIR)/.gocache
BACKEND_GOMODCACHE := $(CURDIR)/$(BACKEND_DIR)/.gomodcache
BACKEND_GOPROXY ?= https://goproxy.cn,https://proxy.golang.org,direct
BACKEND_GOSUMDB ?= sum.golang.google.cn

.PHONY: dev-backend dev-frontend test-backend test-frontend typecheck-frontend docker-generate-mounts docker-config docker-up docker-down package-mac release

dev-backend:
	cd $(BACKEND_DIR) && GOCACHE="$(BACKEND_GOCACHE)" GOMODCACHE="$(BACKEND_GOMODCACHE)" GOPROXY="$(BACKEND_GOPROXY)" GOSUMDB="$(BACKEND_GOSUMDB)" GOFLAGS=-mod=mod go run ./cmd/server

dev-frontend:
	npm --prefix $(FRONTEND_DIR) run dev

test-backend:
	cd $(BACKEND_DIR) && GOCACHE="$(BACKEND_GOCACHE)" GOMODCACHE="$(BACKEND_GOMODCACHE)" GOPROXY="$(BACKEND_GOPROXY)" GOSUMDB="$(BACKEND_GOSUMDB)" GOFLAGS=-mod=mod go test ./...

test-frontend:
	npm --prefix $(FRONTEND_DIR) run test

typecheck-frontend:
	npm --prefix $(FRONTEND_DIR) run typecheck

docker-generate-mounts:
	./scripts/docker/generate-mount-compose.sh

docker-config: docker-generate-mounts
	docker compose -f docker-compose.yml -f configs/generated/docker-compose.mounts.yml config

docker-up:
	./scripts/docker/generate-mount-compose.sh
	docker compose -f docker-compose.yml -f configs/generated/docker-compose.mounts.yml up --build

docker-down:
	./scripts/docker/generate-mount-compose.sh
	docker compose -f docker-compose.yml -f configs/generated/docker-compose.mounts.yml down

package-mac:
	./scripts/mac/package.sh

release:
	BACKEND_GOPROXY="$(BACKEND_GOPROXY)" BACKEND_GOSUMDB="$(BACKEND_GOSUMDB)" ./scripts/release.sh

BACKEND_DIR := backend
FRONTEND_DIR := frontend
BACKEND_GOCACHE := $(CURDIR)/$(BACKEND_DIR)/.gocache
BACKEND_GOMODCACHE := $(CURDIR)/$(BACKEND_DIR)/.gomodcache
BACKEND_GOPROXY ?= https://goproxy.cn,https://proxy.golang.org,direct
BACKEND_GOSUMDB ?= sum.golang.google.cn

.PHONY: dev-backend dev-frontend test-backend test-frontend typecheck-frontend docker-up docker-down package-mac

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

docker-up:
	docker compose up --build

docker-down:
	docker compose down

package-mac:
	./release-scripts/mac/package.sh

# CLAUDE.md

## 1. 项目概览
`term-webclient-go` 提供浏览器中的终端访问能力，包含 Web 端认证、会话管理、终端命令执行、SSH 凭据管理和文件相关能力。仓库是全栈形态，前后端共同交付一个可本地开发、Docker 编排和本地打包发布的应用。

## 2. 技术栈
- Backend: Go 1.26, `net/http`, Gorilla WebSocket, YAML 配置加载
- Frontend: React 18, Vite 5, TypeScript, Vitest
- Frontend runtime proxy: Node.js 22 + Express + `http-proxy-middleware`
- Build/package: npm, Go toolchain, Docker Compose, macOS release scripts

## 3. 架构设计
- `frontend/server.js` 提供静态资源服务，并将 `/term/api`、`/appterm/api`、`/term/ws`、`/appterm/ws` 代理到 Go 后端。
- Go 后端在 `backend/cmd/server` 启动，核心能力拆分到 `internal/auth`、`internal/session`、`internal/ssh`、`internal/files`、`internal/workdir`、`internal/workspace` 等模块。
- 配置分两层：内置默认 YAML 位于 `backend/internal/config/application.yml`；外部结构化覆盖通过 `CONFIG_PATH` 指向 `configs/*.yml`；最终再由 `.env` 和系统环境变量覆盖。

## 4. 目录结构
- `backend/`: Go 服务代码、模块声明和 Dockerfile
- `frontend/`: React 源码、Vite 配置、Node 代理服务
- `configs/`: 外部结构化配置示例，仅存 `.example.yml`
- `release-scripts/`: 本地打包与启停脚本
- `README.md`: 使用、部署、运维入口
- `.env.example`: 环境变量契约

## 5. 数据结构
- 终端与会话数据由 `internal/session` 维护，包括 recent sessions、ring buffer、screen text 和 detached session 元数据。
- SSH 凭据与 known hosts 由 `internal/ssh` 管理，默认落盘路径由配置项决定。
- 认证层包含 Web session cookie 状态和 App JWT 校验配置。

## 6. API 定义
- Web API 基础路径为 `/webapi`，由前端通过 `/term/api` 代理访问。
- App API 基础路径为 `/appapi`，由前端通过 `/appterm/api` 代理访问。
- WebSocket 基础路径为 `/ws`，由前端通过 `/term/ws` 和 `/appterm/ws` 代理访问。
- Web 认证基于 cookie session；App 认证基于 Bearer Token / JWKS 或本地公钥配置。

## 7. 开发要点
- 环境变量契约只维护在根 `.env.example`；不要在 README、CLAUDE 或前端局部 `.env` 中重复维护相同默认值。
- 外部结构化配置必须通过 `CONFIG_PATH` 显式启用；禁止恢复根目录 `application.yml` 自动扫描。
- `docker-compose.yml` 仅做本地编排，敏感项从 `.env` 注入，不在 Compose 文件或 Dockerfile 中硬编码。
- 根 `Makefile` 是推荐命令入口；根 `package.json` scripts 保留给 Node 生态和历史兼容。

## 8. 开发流程
- 初始化：复制 `.env.example` 为 `.env`，安装前端依赖。
- 本地开发：使用 `make dev-backend` 和 `make dev-frontend`；后端首次构建会通过 Go Modules 下载依赖，需要可访问模块源；需要结构化覆盖时通过 `CONFIG_PATH` 启用 `configs/*.yml`。
- 校验：Go 侧运行 `make test-backend`；前端运行 `make typecheck-frontend` 和 `make test-frontend`。
- 打包：执行 `make package-mac`，产出 `release/` 目录，再通过 `release-scripts/mac/start.sh` 启动。

## 9. 已知约束与注意事项
- `frontend/vite.config.ts` 本地开发默认从根 `.env` 读取前后端端口，不应再依赖 `frontend/.env`。
- 当前仓库保留 `backend/` 与 `frontend/` 顶层目录，而不是 `apps/`；这是该全栈仓库的既定边界。
- 外部 YAML 配置是可选能力；若 `CONFIG_PATH` 指向不存在文件，后端启动会直接失败。
- 前端检查依赖 `frontend/node_modules`；未安装依赖时 `typecheck` 和 `test` 无法运行。

# term-webclient-go

## 1. 项目简介
`term-webclient-go` 是一个全栈终端 Web 客户端仓库：Go 后端负责 HTTP/WebSocket、会话和终端能力，React 前端负责浏览器 UI，Node 进程负责静态资源与代理转发。

## 2. 快速开始
### 前置要求
- Go 1.26+
- Node.js 22+
- npm
- Docker Desktop 或兼容的 `docker compose`

### 初始化配置
```bash
cp .env.example .env
npm --prefix frontend ci
```

后端首次构建会通过 Go Modules 下载依赖，因此需要可访问的 Go 模块源网络环境。
开发态前后端都依赖仓库根 `.env`；如果只做正式发布打包，前端构建阶段不要求源码根 `.env` 存在。

### 本地启动
后端：
```bash
make dev-backend
```

前端：
```bash
make dev-frontend
```

默认访问地址：
- 前端：`http://127.0.0.1:11947/term/`
- 后端探活：`http://127.0.0.1:11937/webapi/version`

### 测试
```bash
make test-backend
make typecheck-frontend
make test-frontend
```

## 3. 配置说明
- 根目录 `.env.example` 是唯一的环境变量契约；本地真实值写入根目录 `.env`，该文件不提交。
- 根目录 `VERSION` 是正式 release 版本号的唯一来源，格式固定为 `vX.Y.Z`。
- 后端内置默认配置位于 `backend/internal/config/application.yml`，随程序构建打包，不作为外部编辑入口。
- 外部结构化主配置只在需要时通过 `CONFIG_PATH` 指向 `configs/*.yml`；Copilot runner agents 不走该 YAML，Assist 也不走该 YAML。
- `configs/` 用于存放 CLI client 示例目录、App JWT 本地公钥 PEM 文件、Copilot runner agent 配置、Assist 配置和 Docker 挂载定义。
- 配置优先级：内置默认值 < `CONFIG_PATH` 指向的 YAML < `.env` / 系统环境变量。
- `.env.example` 采用“示例启用”写法：Web bcrypt 登录和 App JWT 验签都默认写成开启态，但你必须先填入真实值再运行。
- CLI clients 改为从 `configs/cli-clients/*.yml` 扫描；没有真实 `.yml` 文件时，`/terminal/clients` 默认返回空列表。
- `TERMINAL_DETACHED_SESSION_TTL_SECONDS` 控制的是“最后一个 WebSocket 客户端断开后，session 还能保留多久”。
- `TERMINAL_DETACHED_SESSION_TTL_SECONDS` 不是 shell 自身 idle timeout，也不等于登录态过期时间。
- Web 登录态过期由 `.env` 中的 `AUTH_SESSION_TTL_SECONDS` 控制；它与 detached session 保留时间是两套独立机制。
- 推荐用法：
```bash
# 如需启用 host 侧 CLI client 示例，再把 example 整理为真实配置
cp configs/cli-clients/codex.example.yml configs/cli-clients/codex.yml

# 后端本地开发
make dev-backend

# Docker Compose 固定使用容器专用配置
# 宿主机挂载定义写在 configs/mounts/*.json
# make docker-up

# 正式发布包（从解压后的 term-webclient 根启动；如需额外结构化覆盖，再在 .env 中设置）
# CONFIG_PATH=./configs/config.prod.yml
```

CLI client 如需单独代理，请在对应的 `configs/cli-clients/*.yml` 里显式声明 `env`；普通 terminal tab 不会再自动继承后端进程里的 `http_proxy` / `https_proxy`。仓库提供 `configs/cli-clients/codex.example.yml` 与 `configs/cli-clients/claude.example.yml` 作为示例，只有复制成非 example 文件后才会显示。

示例：
```yaml
id: codex
label: Codex
command: codex
args: []
workdir: .
env:
  http_proxy: http://127.0.0.1:8001
  https_proxy: http://127.0.0.1:8001
shell: /bin/zsh
```

如果你希望浏览器标签页、机器休眠或网络断开后，第二天还能重新接回前一晚的 terminal session，推荐把 `TERMINAL_DETACHED_SESSION_TTL_SECONDS` 设为 `86400`（24 小时）。

### Copilot Runner Agents
- Copilot 内置始终保留一个 builtin assist agent；runner-backed agents 改为从固定文件 `configs/agents.yml` 加载，不依赖 `CONFIG_PATH`。
- `configs/agents.yml` 的相对路径按 `.env` 所在目录解析；开发态和发布态都统一写在运行根目录下的 `configs/agents.yml`。
- 文件缺失时系统只显示 builtin assist；文件存在但 YAML 非法、agent key 重复或多个 runner agent 同时 `default: true` 时，后端启动会直接失败。
- 若 `configs/agents.yml` 中恰好一个 runner agent 标记 `default: true`，它会覆盖 builtin assist 成为默认选择；否则 builtin assist 保持默认。

准备示例：
```bash
cp configs/agents.example.yml configs/agents.yml
```

示例内容：
```yaml
agents:
  - key: terminal-helper
    label: Terminal Helper
    description: Runner-backed terminal assistant.
    default: true
    icon:
      name: wrench
      color: "#0F766E"
```

- `key` 是必填项，同时作为 term-webclient 内部 agent key 和发送给 `agent-platform-runner` 的 `agentKey`。
- `label` 是必填项，用于 UI 展示。
- `description`、`icon.name`、`icon.color` 可选。

### Web 登录（`/term/`）
- Web 端登录使用 `AUTH_USERNAME` + `AUTH_PASSWORD_HASH_BCRYPT`。
- `AUTH_PASSWORD_HASH_BCRYPT` 必须是有效 bcrypt 哈希；推荐把真实密码只保留在生成阶段，不直接写入配置。
- `AUTH_PASSWORD_HASH_BCRYPT` 支持原始 bcrypt，也支持被成对单引号或双引号包住的 bcrypt。

生成 bcrypt：
```bash
# macOS / Linux
htpasswd -nbBC 10 '' 'change-this-password' | cut -d: -f2

# Python
python3 -c "import bcrypt; print(bcrypt.hashpw(b'change-this-password', bcrypt.gensalt(10)).decode())"
```

写入 `.env`：
```bash
AUTH_ENABLED=true
AUTH_USERNAME=admin
AUTH_PASSWORD_HASH_BCRYPT='<your-bcrypt-hash>'
```

### App JWT（`/appterm/`）
- App 模式要求 Bearer Token，前端会通过 bridge 自动给 HTTP 请求和 WebSocket 带 token。
- 后端优先使用 `APP_AUTH_LOCAL_PUBLIC_KEY_FILE` 指向的 PEM 文件验签；为空时回退到 `APP_AUTH_JWKS_URI`。
- `APP_AUTH_ISSUER`、`APP_AUTH_AUDIENCE` 建议始终显式配置，避免接受约束不足的 token。
- `APP_AUTH_LOCAL_PUBLIC_KEY_FILE` 的相对路径按 `.env` 所在目录解析，开发态和发布态都可以统一写 `./configs/local-public-key.pem`。

准备公钥文件：
```bash
cp configs/local-public-key.example.pem configs/local-public-key.pem
```

推荐 `.env`：
```bash
APP_AUTH_ENABLED=true
APP_AUTH_LOCAL_PUBLIC_KEY_FILE=./configs/local-public-key.pem
APP_AUTH_JWKS_URI=
APP_AUTH_ISSUER='your-app-issuer'
APP_AUTH_AUDIENCE='appterm'
```

### Assist / LLM
- 当前仓库只支持单一 `assist.*` 配置，不兼容旧版 `agent.providers.*` 多提供方结构。
- 当前示例默认对接阿里云百炼 OpenAI 兼容接口。
- Assist 固定从 `configs/assist.yml` 读取；请先复制 `configs/assist.example.yml` 为 `configs/assist.yml`。
- 推荐把真实 `ASSIST_API_KEY` 放在根目录 `.env`，`configs/assist.yml` 只保留非敏感项或引用 `${ASSIST_API_KEY:}`。
- `ASSIST_BASE_URL` 建议直接使用百炼兼容模式根地址，例如北京地域 `https://dashscope.aliyuncs.com/compatible-mode/v1`；后端会在其后拼接 `/chat/completions`。

推荐 `.env`：
```bash
ASSIST_API_KEY='<your-api-key>'
```

- Assist 后端会以流式方式调用 `/chat/completions`，但对前端仍返回最终聚合后的 suggestions JSON。
- `ASSIST_DEBUG_LOG=true` 时，后端会把发给模型的完整原始请求 JSON、脱敏后的请求头、响应状态/响应头、SSE 排障信息和聚合后的响应内容写到服务日志；该开关只适合本地排障，日志会包含 recent screen text。

推荐 `configs/assist.yml`：
```yaml
enabled: true
base-url: https://dashscope.aliyuncs.com/compatible-mode/v1
api-key: ${ASSIST_API_KEY:}
model: qwen-plus
timeout-seconds: 30
max-screen-text-chars: 500
debug-log: false
system-prompt: |
  You are an assistant for a terminal web client.
```

## 4. 界面主题
- 前端提供白天和黑夜两种主题。
- 主题切换按钮位于顶部操作区，切换结果保存在浏览器 `localStorage`。
- 主题会同时作用于主界面、登录页、弹窗、文件侧栏和终端面板。

## 5. 部署
### Docker Compose
```bash
cp .env.example .env
cp configs/mounts/project-a.example.json configs/mounts/project-a.json
make docker-up
```

`compose.yml` 现在只保留稳定服务定义：前端对外暴露 `11947`，后端只在容器网络内监听 `11937`，由前端通过服务名 `backend` 访问。宿主机挂载定义不再写在 Compose 主文件里，而是放到 `configs/mounts/*.json`，再由 `scripts/docker/generate-mount-compose.sh` 生成 `configs/generated/docker-compose.mounts.yml` 作为 override。容器专用覆盖通过 `CONFIG_PATH=./configs/config.docker-host.yml` 叠加，其值会把本地终端默认 workdir、目录浏览根和文件面板根都收敛到 `/workspace`，并把普通 terminal 默认 shell 切到 `bash -l`。`configs/mounts/` 仅用于 Docker 挂载生成，不承载业务配置。Copilot runner agents 请复制 `configs/agents.example.yml` 为 `configs/agents.yml`；Assist 请复制 `configs/assist.example.yml` 为 `configs/assist.yml`；CLI clients 请按需复制 `configs/cli-clients/*.example.yml`；App JWT 本地验签时，推荐把真实 PEM 放在 `configs/local-public-key.pem`。

挂载 JSON 固定字段：
```json
{
  "name": "project-a",
  "hostPath": "/Users/you/Project/project-a",
  "readOnly": false,
  "kind": "directory"
}
```

- `name` 决定容器内目录名，最终挂载点始终是 `/workspace/<name>`。
- `hostPath` 必须是宿主机绝对路径。
- `readOnly` 可选，默认 `false`。
- `kind` 可选，默认 `directory`；如需额外挂 socket，可自行提供 `kind=socket` 的 JSON。
- 生成后的 override 文件位于 `configs/generated/docker-compose.mounts.yml`，不手工维护。
- `configs/mounts/` 只影响 Compose override，不影响 `configs/config.docker-host.yml` 中的 terminal/files/workdir 配置。

### 正式发布包
```bash
make release
```

`make release` 会读取根目录 `VERSION`，自动识别当前 `Darwin` 主机架构并输出单架构版本包：

- `dist/release/term-webclient-vX.Y.Z-darwin-host-arm64.tar.gz`
- `dist/release/term-webclient-vX.Y.Z-darwin-host-amd64.tar.gz`

发布包是“后端宿主机进程 + 前端 Docker 镜像”的混合形态：

- 部署机不需要安装 Node.js
- 部署机需要安装并运行 Docker Desktop
- 前端镜像运行时使用 Nginx；Node.js 只在构建阶段使用
- 包名中的 `darwin-host-*` 只描述宿主机后端目标平台；前端始终以 `linux/*` Docker 镜像运行
- 发布态 `/webapi/version` 会返回 release 构建时注入的正式版本、Git SHA 和构建时间

### 发布态启动
先生成正式发布包：
```bash
make release
```

再把 bundle 解压到部署目录，进入解压后的 `term-webclient/` 目录准备运行时配置并启动：
```bash
tar -xzf dist/release/term-webclient-v0.1.0-darwin-host-arm64.tar.gz
cd term-webclient
cp .env.example .env
./start.sh
```

停止时：
```bash
cd term-webclient
./stop.sh
```

如果缺少 `term-webclient/.env`，失败会发生在 `term-webclient/start.sh` 启动阶段，而不是打包阶段。

打包产物包含：
- `term-webclient/backend/term-web-backend`
- `term-webclient/images/term-webclient-frontend.tar`
- `term-webclient/.env.example`
- `term-webclient/bundle.env`
- `term-webclient/start.sh`
- `term-webclient/stop.sh`
- `term-webclient/README.txt`
- `term-webclient/configs/assist.example.yml`
- `term-webclient/configs/agents.example.yml`
- `term-webclient/configs/cli-clients/*.example.yml`
- `term-webclient/configs/local-public-key.example.pem`

其中 `term-webclient/bundle.env` 会记录 bundle 元数据，包括宿主机后端目标平台和前端镜像实际平台；当前前端镜像平台会写成 `linux/arm64` 或 `linux/amd64`。

运行发布包前，至少准备 `term-webclient/.env`，并按需把 `term-webclient/configs/agents.example.yml` 复制为 `term-webclient/configs/agents.yml`、把 `term-webclient/configs/assist.example.yml` 复制为 `term-webclient/configs/assist.yml`、把 `term-webclient/configs/cli-clients/*.example.yml` 复制为真实 `.yml`、把 `term-webclient/configs/local-public-key.example.pem` 复制为 `term-webclient/configs/local-public-key.pem`。如果需要结构化覆盖，再自行准备 `term-webclient/configs/*.yml` 并设置 `CONFIG_PATH`。

发布包手工入口：
```bash
cd term-webclient
./start.sh
./stop.sh
```

### 兼容的本地目录打包
```bash
make package-mac
```

`make package-mac` 仍会生成旧的 `release/` 目录，主要用于仓库内本机调试，不再作为正式对外交付入口。

## 6. 运维
### 启停
```bash
make release
tar -xzf dist/release/term-webclient-v0.1.0-darwin-host-arm64.tar.gz
cd term-webclient && ./start.sh
cd term-webclient && ./stop.sh
```

### 常见排查
- 后端启动失败时，先检查 `.env` 中的端口、认证和 SSH 相关变量是否完整。
- 如果启用了 Assist，确认 `ASSIST_BASE_URL`、`ASSIST_API_KEY`、`ASSIST_MODEL` 都已配置，且 `ASSIST_BASE_URL` 已包含 `/v1`。
- 如果启用了 App JWT 本地公钥验签，确认 `APP_AUTH_LOCAL_PUBLIC_KEY_FILE` 指向的 PEM 文件存在且是合法 RSA 公钥。
- 如果启用了 Copilot runner agents，确认 `configs/agents.yml` 存在、YAML 合法，且 `COPILOT_RUNNER_BASE_URL` 已配置。
- 如果是首次运行后端构建或测试，确认当前环境可以访问 Go 模块源并完成依赖下载。
- 如果是首次生成正式发布包，确认 Docker Desktop 已启动，且 `docker buildx build` 可以正常执行。
- 如果设置了 `CONFIG_PATH`，确认目标文件存在且路径相对当前运行目录有效。
- 如果是直接复制 `term-webclient/` 到其他目录运行，确认整包一起复制，而不是只拷贝后端二进制或镜像 tar。
- 如果你修改了 `term-webclient/.env` 或 `term-webclient/configs/*`，直接在 `term-webclient/` 目录重启，不需要重新回到仓库根执行额外启动命令。
- 如果发布包前端起不来，先确认 Docker Desktop 正在运行，再执行 `docker logs term-webclient-frontend-<FRONTEND_PORT>` 查看 Nginx 容器日志。
- Docker 场景下，确认 `./data` 和 `./configs` 挂载目录可读写。
- Docker 场景下，先运行 `make docker-generate-mounts` 或 `make docker-up`，确认 `configs/generated/docker-compose.mounts.yml` 已生成。
- Docker 场景下，确认 `configs/mounts/*.json` 中的 `hostPath` 都是存在的宿主机绝对路径。
- 前端代理异常时，确认 `.env` 中的 `BACKEND_PORT` 与后端监听端口一致；正式发布包会让前端容器通过 `host.docker.internal` 访问宿主机后端。

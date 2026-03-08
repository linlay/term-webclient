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
- 后端探活：`http://127.0.0.1:11946/webapi/version`

### 测试
```bash
make test-backend
make typecheck-frontend
make test-frontend
```

## 3. 配置说明
- 根目录 `.env.example` 是唯一的环境变量契约；本地真实值写入根目录 `.env`，该文件不提交。
- 后端内置默认配置位于 `backend/internal/config/application.yml`，随程序构建打包，不作为外部编辑入口。
- 只有结构化配置确实超过 `.env` 表达能力时，才使用 `CONFIG_PATH` 指向 `configs/*.yml`。
- 配置优先级：内置默认值 < `CONFIG_PATH` 指向的 YAML < `.env` / 系统环境变量。
- `.env.example` 采用“示例启用”写法：Web bcrypt 登录和 App JWT 验签都默认写成开启态，但你必须先填入真实值再运行。
- 推荐用法：
```bash
# 后端本地开发（从 backend/ 目录启动）
CONFIG_PATH=../configs/config.dev.yml make dev-backend

# Docker / 发布包（从仓库根或 release 根启动）
# 在 .env 中设置
CONFIG_PATH=./configs/config.prod.yml
```

### Web 登录（`/term/`）
- Web 端登录使用 `AUTH_USERNAME` + `AUTH_PASSWORD_HASH_BCRYPT`。
- `AUTH_PASSWORD_HASH_BCRYPT` 必须是有效 bcrypt 哈希；推荐把真实密码只保留在生成阶段，不直接写入配置。

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
- 后端优先使用 `APP_AUTH_LOCAL_PUBLIC_KEY` 验签；为空时回退到 `APP_AUTH_JWKS_URI`。
- `APP_AUTH_ISSUER`、`APP_AUTH_AUDIENCE` 建议始终显式配置，避免接受约束不足的 token。

推荐写法：
```bash
APP_AUTH_ENABLED=true
# .env 推荐单行 base64 DER 公钥；多行 PEM 更适合通过环境变量或 YAML 注入
APP_AUTH_LOCAL_PUBLIC_KEY='<base64-rsa-public-key>'
APP_AUTH_JWKS_URI=
APP_AUTH_ISSUER='your-app-issuer'
APP_AUTH_AUDIENCE='appterm'
```

如果你更适合用 YAML：
```yaml
app-auth:
  enabled: true
  local-public-key: |
    -----BEGIN PUBLIC KEY-----
    ...
    -----END PUBLIC KEY-----
  issuer: your-app-issuer
  audience: appterm
```

## 4. 界面主题
- 前端提供白天和黑夜两种主题。
- 主题切换按钮位于顶部操作区，切换结果保存在浏览器 `localStorage`。
- 主题会同时作用于主界面、登录页、弹窗、文件侧栏和终端面板。

## 5. 部署
### Docker Compose
```bash
cp .env.example .env
docker compose up --build
```

`docker-compose.yml` 仅用于本地双服务编排。若需要结构化后端覆盖项，把 `configs/config.prod.yml.example` 复制为 `configs/config.prod.yml`，并在 `.env` 中设置 `CONFIG_PATH=./configs/config.prod.yml`。

### 本地打包
```bash
make package-mac
./release-scripts/mac/start.sh release
```

打包产物包含：
- `release/backend/term-web-backend`
- `release/frontend/`
- `release/.env.example`
- `release/configs/*.example.yml`

运行发布包前，至少准备 `release/.env`；如果需要结构化覆盖，再准备 `release/configs/*.yml` 并设置 `CONFIG_PATH`。

## 6. 运维
### 启停
```bash
./release-scripts/mac/start.sh release
./release-scripts/mac/stop.sh release
```

### 常见排查
- 后端启动失败时，先检查 `.env` 中的端口、认证和 SSH 相关变量是否完整。
- 如果是首次运行后端构建或测试，确认当前环境可以访问 Go 模块源并完成依赖下载。
- 如果设置了 `CONFIG_PATH`，确认目标文件存在且路径相对当前运行目录有效。
- Docker 场景下，确认 `./data` 和 `./configs` 挂载目录可读写。
- 前端代理异常时，确认 `.env` 中的 `BACKEND_HOST`、`BACKEND_PORT` 与后端监听端口一致。

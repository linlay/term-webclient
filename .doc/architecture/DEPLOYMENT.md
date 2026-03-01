# 部署架构与环境

## 运行形态
- 后端：`backend/app.jar`（Spring Boot）
- 前端：`frontend/dist` + `frontend/server.js`（Express 代理）
- 发布目录由 `release-scripts/mac/package.sh` 生成

## 开发环境（典型）
1. 后端：`cd backend && mvn spring-boot:run`
2. 前端：`cd frontend && npm run dev`
3. Vite dev proxy：
- `/term/api -> /webapi`
- `/appterm/api -> /appapi`
- `/term/ws -> /ws`
- `/appterm/ws -> /ws`

## 生产环境（release）
- 执行：`./release-scripts/mac/package.sh`
- 输出：默认 `release/`
- 运行：`./release-scripts/mac/start.sh`
- 停止：`./release-scripts/mac/stop.sh`

## 关键约束
- `start.sh` 强依赖以下文件：
- `release/.env`
- `release/application.yml`
- 这两个文件不会自动生成，需从示例拷贝：
- `.env.example`
- `application.example.yml`

## 端口与代理
- 默认后端：`127.0.0.1:11946`
- 默认前端代理：`0.0.0.0:11947`
- 前端代理负责 API/WS 前缀重写与 SPA 路由入口分发

## 运行目录
- PID: `release/run/*.pid`
- 日志: `release/logs/backend.out`, `release/logs/frontend.out`
- 数据: `release/data/`（如 SSH 凭据文件）

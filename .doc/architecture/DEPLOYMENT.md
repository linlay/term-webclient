# 部署架构与环境

## 启动方式
- 本地：`<local-start-command>`
- 容器：`<container-start-command>`

## 核心环境变量
| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `<env-key>` | `<default>` | `<description>` |

## 配置覆盖规则
- 基础配置：`<base-config-file>`
- 环境覆盖：`<env-config-file>`
- 覆盖优先级：`<override-order>`

## 运行目录约定
- logs: `<logs-path>`
- pids: `<pid-path>`
- data: `<data-path>`

## 部署验收清单
- 健康检查：`<healthcheck-endpoint>`
- 核心 API 烟测：`<smoke-endpoint>`
- 回滚入口：`<rollback-command>`

## [DOC-GAP]
- `[DOC-GAP]` 若部署形态多样（VM/K8s/Serverless）需分环境单独落盘。

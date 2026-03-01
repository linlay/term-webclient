# 系统辅助 API（terminal/system）

## 覆盖范围
- `GET /terminal/clients`
- `GET /version`
- `GET /workdirTree?path=`（deprecated）

## GET /terminal/clients
返回可用 CLI 客户端列表：
```json
[{ "id":"codex", "label":"Codex", "defaultWorkdir":"." }]
```

数据来源：`terminal.cli-clients` 配置。

## GET /version
返回系统版本信息：
```json
{ "name":"term-web-backend", "version":"...", "gitSha":"...", "buildTime":"..." }
```

## GET /workdirTree (deprecated)
响应头包含：
- `Deprecation: true`
- `Sunset: <RFC1123 date>`

响应：
```json
{ "rootPath":"...", "currentPath":"...", "entries":[{"name":"...","path":"...","hasChildren":true}] }
```

替代建议：
- 已创建会话后优先使用 `/sessions/{sessionId}/files/tree`。

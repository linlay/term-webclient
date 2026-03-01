# Workspace 模块 API（workspace）

## 覆盖范围
- `POST /workspace/context-pack`

## 请求体（ContextPackRequest）
```json
{
  "paths": ["frontend/src/react/App.tsx"],
  "includeGitDiff": true,
  "maxBytes": 262144
}
```

字段说明：
- `paths`: 需打包的路径列表（可相对 workspaceRoot）
- `includeGitDiff`: 是否附加 `git diff`
- `maxBytes`: 本次上下文总预算（最小 4096）

## 响应体（ContextPackResponse）
```json
{
  "generatedAt": "ISO-8601",
  "workspaceRoot": "/abs/path",
  "truncated": false,
  "entries": [
    {
      "path": "frontend/src/react/App.tsx",
      "exists": true,
      "truncated": false,
      "bytes": 1234,
      "content": "...",
      "error": ""
    }
  ],
  "gitDiff": "..."
}
```

## 安全边界
- 所有 `paths` 必须位于 `workspaceRoot` 内。
- 非 regular file 返回 `exists=true + error=not a regular file`。
- 单文件读取上限（当前实现）约 128KB。

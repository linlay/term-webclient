# Workspace Context 模块设计

## 核心类
- `WorkspaceContextService`
- `InvalidWorkspaceContextRequestException`

## 输入与输出
输入：`ContextPackRequest(paths, includeGitDiff, maxBytes)`
输出：`ContextPackResponse(generatedAt, workspaceRoot, truncated, entries, gitDiff)`

## 关键规则
1. workspaceRoot 自动检测：从当前路径向上寻找 `.git`。
2. paths 归一化后必须位于 workspaceRoot 内。
3. 仅 regular file 读取内容；目录不直接展开。
4. 单文件读取上限约 128KB。
5. 全局预算由 `maxBytes` 与 agent 默认配置共同限制。
6. 可选附加 `git diff`，并受剩余额度限制。

## 失败语义
- 非法路径：抛 `InvalidWorkspaceContextRequestException` -> 400
- 读取失败：在 entry 层返回 `error` 文本
- git diff 失败：返回空字符串，不阻断整个 pack

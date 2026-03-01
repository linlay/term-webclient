# 文件侧栏设计（桌面）

## 组件
- `FileSidebar`
- store: `useFileTransferStore`

## 目标
- 绑定 active session 的文件根路径，实现浏览/上传/下载/建目录。

## 核心能力
1. 文件树浏览（支持回到父目录）
2. 文件名过滤
3. 拖拽上传与队列展示
4. 新建目录
5. 单文件下载与多选归档下载（download-ticket）

## API 依赖
- `GET /sessions/{sid}/files/tree`
- `POST /sessions/{sid}/files/upload`
- `POST /sessions/{sid}/files/mkdir`
- `POST /sessions/{sid}/files/download-ticket`

## 上传策略
- 多文件串行上传，保持稳定进度与可重试行为。
- 冲突策略默认 `rename`。

## 下载策略
- 单文件：`mode=single`
- 多选或目录：`mode=archive`
- 通过 `downloadUrl` 触发浏览器下载

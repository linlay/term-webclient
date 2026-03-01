# File Transfer 模块设计

## 核心类
| 类 | 职责 |
|---|---|
| `FileTransferService` | 业务编排、审计、gateway 选择 |
| `FileGateway` | 文件网关抽象接口 |
| `LocalFileGateway` | 本地文件实现 |
| `SftpFileGateway` | 远端 SFTP 实现 |
| `DownloadTicketService` | 一次性下载票据 |
| `RequestActorResolver` | 请求身份解析（web/app） |

## Gateway 选择
- LOCAL_PTY 或无 ssh binding -> `LocalFileGateway`
- SSH_SHELL 且有 ssh binding -> `SftpFileGateway`

## 核心能力
- `tree`: 浏览目录
- `mkdir`: 创建目录
- `upload`: 多文件上传（冲突策略）
- `openDownload`: 单文件下载流
- `planArchive`: 多路径归档计划
- `download-ticket`: single/archive 票据签发

## 安全边界
- 根路径绑定在会话层（`FileSessionBinding.rootPath`）。
- gateway 层强制 path inside root。
- 下载票据校验：session/mode/actor/ttl。

## 资源上限
- 单文件上传上限：`max-upload-file-bytes`
- 请求上传总上限：`max-upload-request-bytes`
- 归档下载总上限：`max-download-archive-bytes`
- ticket TTL：`download-ticket-ttl-seconds`

## 错误分类
- `FileTransferBadRequestException` -> 400
- `FileTransferForbiddenException` -> 403
- `FileTransferNotFoundException` -> 404
- `FileTransferPayloadTooLargeException` -> 413

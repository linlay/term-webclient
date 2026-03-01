# SSH 模块 API（ssh）

## 覆盖范围
- `GET /ssh/credentials`
- `POST /ssh/credentials`
- `DELETE /ssh/credentials/{credentialId}`
- `POST /ssh/credentials/{credentialId}/preflight`
- `POST /ssh/exec`

## 凭据模型
`CreateSshCredentialRequest`：
- `host`, `port?`, `username`
- `password?` 与 `privateKey?` 二选一
- `privateKeyPassphrase?`

`SshCredentialResponse`：
- `credentialId`, `host`, `port`, `username`, `authType`, `createdAt`

> `[DOC-GAP]` 前端类型含 `updatedAt`，后端当前返回中无该字段。

## POST /ssh/credentials
功能：新建并加密存储 SSH 凭据。

响应：`201 + SshCredentialResponse`

失败：
- `400` 参数非法（空 host、port 越界、密码/私钥校验失败）
- `500` 存储失败

## POST /ssh/credentials/{id}/preflight
功能：连接性预检。

响应：
```json
{ "credentialId":"...", "success":true, "message":"...", "durationMs":123 }
```

## POST /ssh/exec
请求：
```json
{ "credentialId":"...", "command":"...", "cwd":"...", "env":{}, "timeoutSeconds":120 }
```

响应：
```json
{
  "stdout":"...",
  "stderr":"...",
  "exitCode":0,
  "durationMs":100,
  "timedOut":false,
  "stdoutTruncated":false,
  "stderrTruncated":false
}
```

## SSH 安全行为
- 凭据秘密使用 AES-GCM 存储在本地 JSON 文件。
- host key 使用 TOFU（首次信任并持久化 known-hosts）。
- 连接池按 `(host,port,username,credentialId)` 复用。

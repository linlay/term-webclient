# SSH 模块设计

## 核心类
| 类 | 职责 |
|---|---|
| `SshCredentialStore` | 凭据加密存储与解析 |
| `SshConnectionPool` | 按连接键复用并维护 lease |
| `SshShellRuntime` | 交互式 shell 会话 |
| `SshExecService` | 非交互命令执行 |
| `SshPreflightService` | 连通性预检 |
| `TofuHostKeyVerifier` | TOFU 主机密钥校验 |
| `SshErrorMapper` | SSH 异常语义映射 |

## 凭据存储
- 文件：JSON
- 密钥：`terminal.ssh.master-key`
- 算法：AES-GCM
- 认证方式：`PASSWORD` 或 `PRIVATE_KEY`（二选一）

## 连接池
连接复用 key：`(host, port, username, credentialId)`

策略：
- fast path 复用可用连接
- slow path 合并并发连接请求
- 失败时对部分握手异常进行有限重试
- lease 归还后可进入空闲回收

## exec 与 shell 的区别
- `SshExecService`: 一次性命令，返回 stdout/stderr/exitCode
- `SshShellRuntime`: 持久交互式流，用于 terminal tab

## TOFU 行为
- 首次连接记录 host key
- 后续连接若 key 变化，则拒绝并报安全错误

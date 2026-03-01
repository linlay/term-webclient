# 存储设计（非 RDBMS）

## 结论
- 当前项目**没有关系型数据库**，也没有 ORM schema。
- 本文件记录真实持久化与内存状态设计。

## 持久化存储

### 1) SSH 凭据文件
- 路径：`terminal.ssh.credentials-file`（默认 `data/ssh-credentials.json`）
- 内容：credential 元信息 + `encryptedSecret`
- 加密：AES-GCM（IV + CipherText Base64）
- 主密钥：`terminal.ssh.master-key`（建议环境变量注入）

### 2) SSH Known Hosts（TOFU）
- 路径：`terminal.ssh.known-hosts-file`（默认 `~/.term-web/known-hosts.json`）
- 内容：首次连接学习后的 host key 指纹/公钥信息
- 用途：后续连接进行主机密钥一致性校验

## 内存态（进程级）

### 1) 会话态
- 位置：`TerminalSessionService.sessions`（`ConcurrentMap<String, TerminalSession>`）
- 生命周期：创建 -> 附着/分离 -> TTL 到期回收或显式关闭

### 2) 输出缓冲
- 每会话持有 `TerminalOutputRingBuffer`
- 限制：`ring-buffer-max-bytes` + `ring-buffer-max-chunks`

### 3) 下载票据
- 位置：`DownloadTicketService.tickets`（内存 map）
- 语义：一次性消费 + TTL 过期清理

### 4) Agent 运行态
- `runsBySession` 与 `activeRunBySession`（内存）
- 重启后不保留

## 一致性与恢复
- 进程重启后：
- session/ring-buffer/ticket/agent run 均丢失
- SSH 凭据与 known-hosts 保留

## [DOC-GAP]
- 若后续引入持久化会话或审计需求，需要新增外部存储（RDBMS/事件存储），并补齐迁移策略。

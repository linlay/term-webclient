# 新建会话页设计（NewSessionForm）

## 组件
- `features/session/NewSessionForm.tsx`

## 目标
- 创建 `LOCAL_PTY` 或 `SSH_SHELL` 会话。

## 关键字段
| 字段 | 说明 |
|---|---|
| `toolId` | terminal/ssh 或配置中的 cli client |
| `title` | tab 展示名称 |
| `command` + `args` | 启动命令与参数 |
| `workdir` | 工作目录 |
| `cols/rows` | 初始终端尺寸 |
| `sshCredentialId` | SSH 模式时必填 |
| `sshTerm` | SSH 终端类型 |

## 相关 API
- `GET /terminal/clients`
- `GET /workdirTree`（deprecated，当前仍在表单内使用）
- `GET/POST/DELETE /ssh/credentials`
- `POST /ssh/credentials/{id}/preflight`
- `POST /sessions`

## 交互流程
1. 首屏加载 terminal clients、workdir tree、SSH 凭据。
2. 选择类型并填写参数。
3. 提交后创建 session，回调 `onCreated(payload)`。
4. App 层加入 tab 并激活。

## 校验与异常
- args 输入支持带引号解析，不闭合引号报错。
- SSH 模式未选凭据时阻止提交。
- API 错误展示在表单错误区。

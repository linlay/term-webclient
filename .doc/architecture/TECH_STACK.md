# 技术栈与版本锁定

## 后端
| 组件 | 版本/实现 |
|---|---|
| Java | 21 |
| Spring Boot | 3.3.8 |
| 构建工具 | Maven |
| Web/REST | `spring-boot-starter-web` |
| WebSocket | `spring-boot-starter-websocket` |
| SSH | Apache Mina SSHD 2.12.1 (`sshd-core`, `sshd-sftp`) |
| 本地终端 | pty4j 0.13.4 |
| 密码哈希 | Spring Security Crypto (BCrypt) |
| JWT/JWKS | Spring Security OAuth2 JOSE + Nimbus |

## 前端
| 组件 | 版本/实现 |
|---|---|
| React | 18.3.1 |
| TypeScript | 5.6.x |
| Vite | 5.4.x |
| 状态管理 | Zustand 5 |
| 服务端状态 | TanStack Query 5 |
| Terminal UI | xterm 5.3 + xterm-addon-fit |
| 表单校验 | react-hook-form + zod |

## 前端代理
| 组件 | 版本/实现 |
|---|---|
| Node.js Server | Express 5 |
| 代理 | http-proxy-middleware 3 |
| 压缩 | compression |

## 测试与质量
| 领域 | 工具 |
|---|---|
| 后端测试 | `spring-boot-starter-test` |
| 前端单测 | Vitest + Testing Library + jsdom |
| 静态检查 | ESLint + TypeScript typecheck |

## 版本约束说明
- 本文件记录已在仓库中出现的主干版本。
- 任何升级需同步更新本文件与 `changelog/`。

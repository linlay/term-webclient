# 2026-03-01 doc-guideline migration

## 变更类型
- `refactor-doc-system`

## 影响范围
- 文档：`.doc/**`
- 代码：`none`

## 迁移映射（legacy -> current）
| 旧结构 | 新结构 | 迁移动作 |
|---|---|---|
| `README.md + GLOSSARY.md` | `GUIDE.md` | 合并导航、术语、规则与 AI guardrails |
| `api/CONVENTIONS.md + api/ERROR_CODES.md` | `api/SPEC.md` | 合并协议、响应壳、错误码策略 |
| `api/modules/user.md` | `api/modules/<module-name>.md` | 参数化模块模板 |
| `backend/modules/*(具体模块)` | `backend/modules/<module-name>.md` | 收敛为可复用模板 |
| `frontend/pages/*(具体页面)` | `frontend/pages/<module-name>.md` | 收敛为可复用模板 |

## 双轨响应壳决策
- 决策：采用 `response_envelope_rule=dual-track`
- 原因：需要兼容 legacy 接口，同时为新接口提供标准 envelope
- 约束：迁移期内必须在模块文档标注 legacy 情况

## [DOC-GAP] 决策记录
- `[DOC-GAP]` 若具体业务模块命名尚未定稿，统一使用 `<module-name>`，待业务确认后替换。

## 后续动作
1. 按模块替换 `<module-name>` 占位文档。
2. 为每个 legacy 接口补“兼容窗口”条目。
3. 每次替换在 `changelog/` 增量记录。

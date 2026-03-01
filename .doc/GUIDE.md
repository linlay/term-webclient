# .doc 指引（GUIDE）

本目录是项目设计事实源（Single Source of Truth）。

## A. 输入契约校准
| 字段 | 当前值 | 说明 |
|---|---|---|
| `project_type` | `modular monolith` | 后端单体 + 模块分层 |
| `frontend_mode` | `present` | 当前有前端；若缺失见下文升级路径 |
| `api_style` | `REST` | HTTP 接口风格 |
| `base_path_rule` | `<base-path>` | 统一占位符，不写死常量 |
| `module_naming_rule` | `<module-name>` | 统一占位符 |
| `response_envelope_rule` | `dual-track` | 标准 envelope + legacy 并存 |
| `error_code_policy` | `segmented policy` | 分段策略 + 映射规则 |
| `existing_doc_style` | `legacy-doc-style` | 旧结构见迁移映射 |
| `language_preference` | `zh-CN` | 中文描述，路径/标识符英文 |

## B. 三段式产物

### 1) `.doc` 目录树（占位符）
```text
.doc/
├── GUIDE.md
├── architecture/
│   ├── SYSTEM.md
│   ├── TECH_STACK.md
│   ├── DATA_FLOW.md
│   └── DEPLOYMENT.md
├── api/
│   ├── SPEC.md
│   ├── AUTH.md
│   ├── modules/
│   │   ├── <module-name>.md
│   │   └── ...
│   └── _template.md
├── backend/
│   ├── MODULE_MAP.md
│   ├── DATABASE.md
│   ├── BUSINESS_LOGIC.md
│   ├── modules/
│   │   ├── <module-name>.md
│   │   └── ...
│   └── _template.md
├── frontend/
│   ├── ROUTES.md
│   ├── STATE.md
│   ├── COMPONENTS.md
│   ├── pages/
│   │   ├── <module-name>.md
│   │   └── ...
│   └── _template.md
└── changelog/
    └── YYYY-MM-DD_<topic>.md
```

### 2) 核心文件“写什么 + 模板片段”
| 文件 | 写什么 |
|---|---|
| `architecture/SYSTEM.md` | 架构模式、Mermaid、分层依赖与关键约束 |
| `api/SPEC.md` | `<base-path>`、响应壳、状态码映射、全局异常 |
| `api/AUTH.md` | 鉴权入口、token 规则、失败行为、特例授权 |
| `api/modules/<module-name>.md` | 单模块请求/响应/失败场景/幂等性 |
| `backend/MODULE_MAP.md` | 包级职责与依赖方向 |
| `backend/DATABASE.md` | 存储总览、命名约定、索引与读写策略 |
| `frontend/ROUTES.md` | 路由、权限、后端模块映射 |
| `frontend/STATE.md` | 状态分层、store 规则、API 归属 |
| `frontend/COMPONENTS.md` | 组件分层、组件树、复用规则 |

模板片段：
```markdown
# <module-name> 模块 API

## `<METHOD> <base-path>/<resource>`
功能：<feature-summary>
```

### 3) 可复制 AI 编程规则
见本文件“F. AI 编程规则”章节。

## C. 阅读顺序
1. `.doc/GUIDE.md`
2. `.doc/api/SPEC.md`
3. `.doc/api/modules/<module-name>.md`
4. `.doc/architecture/*.md`
5. `.doc/backend/*.md`
6. `.doc/frontend/*.md`（`frontend_mode=present`）

## D. 术语与命名约束
| 术语 | 代码标识 | 含义 | 禁止别名 |
|---|---|---|---|
| 模块 | `<module-name>` | 业务/技术边界单元 | featureX 固定化命名 |
| API 前缀 | `<base-path>` | 接口根路径规则 | 写死 `/api/v1` |
| 成功壳 | `code/msg/data` | 标准响应结构 | 任意字段漂移 |
| 旧响应 | `legacy-response` | 历史兼容响应形态 | 无说明直接删除 |

## E. [DOC-GAP] 流程
1. 标注 `[DOC-GAP]` + 影响文档路径 + 冲突点。
2. 说明现象与风险边界。
3. 给候选方案（改文档/改实现）和影响。
4. 待确认后再固化模板或规则。
5. 在 `changelog/` 记录最终决策。

## F. AI 编程规则
1. 编码前必须先读 `.doc` 对应文档。
2. 契约变更先更新文档，再改实现。
3. 禁止发明未定义接口、字段、错误码、事件名。
4. 文档缺口必须走 `[DOC-GAP]`，不得直接拍板。
5. 文档变更必须落 `changelog/`。

## G. frontend 模式分支
- `frontend=present`：必须维护 `frontend/ROUTES.md`、`STATE.md`、`COMPONENTS.md`、`pages/*`。
- `frontend=absent`：保留 frontend 占位说明，并给后续升级路径：
- 第一步新增 `frontend/ROUTES.md` 框架。
- 第二步补 `STATE.md` 与 `COMPONENTS.md`。
- 第三步逐页补 `pages/<module-name>.md`。

## H. 禁止项
1. 禁止绑定单一仓库私有常量。
2. 禁止写死固定 API 前缀、事件名或业务术语。
3. 禁止只给目录树，不给模板与 AI 规则。
4. 禁止在输入契约缺失时直接实现细节。

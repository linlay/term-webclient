# 后端模块地图

## 包级职责
| 包 | 职责 |
|---|---|
| `controller` | 协议入口、参数解析、响应封装 |
| `service` | 业务编排、流程控制 |
| `domain` | 领域模型与规则 |
| `repository` | 数据访问与持久化 |
| `config` | 配置与装配 |

## 依赖方向
- `controller -> service -> repository`
- `domain` 不依赖 `controller`。
- 允许通过接口进行跨模块协作，不允许跨层直接访问内部状态。

## 禁止跨层行为
- Controller 不写业务状态机。
- Repository 不承载协议层逻辑。
- Service 不直接依赖传输层对象（如 HTTP request/response）。

## [DOC-GAP]
- `[DOC-GAP]` 若存在额外层（如 application/usecase/gateway），需补全层级与依赖矩阵。

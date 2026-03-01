# 数据库与存储设计

## 总览
- 存储类型：`<db-type>`
- 主键策略：`<id-strategy>`
- 时间字段：`<time-fields>`
- 软删除策略：`<soft-delete-rule>`

## 命名约定
- 表/集合命名：`<naming-rule>`
- 字段命名：`<field-naming-rule>`
- 索引命名：`<index-naming-rule>`

## 结构定义（示例）
### `<table-name>`
| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `<column>` | `<type>` | `<constraint>` | `<desc>` |

## 索引策略
- `<index-name>`: (`<columns>`) `<condition>`

## 读写策略
- 主写路径：`<write-path-rule>`
- 主读路径：`<read-path-rule>`
- 一致性：`<consistency-rule>`

## [DOC-GAP]
- `[DOC-GAP]` 若项目当前无 RDBMS，需在此明示“当前存储形态”与“迁移触发条件”。

# 登录页设计（LoginForm）

## 组件
- `features/auth/LoginForm.tsx`

## 表单字段
| 字段 | 校验 |
|---|---|
| `username` | 必填，去前后空格 |
| `password` | 必填 |

## 提交流程
1. 前端校验通过后调用 `useLogin().mutateAsync(values)`。
2. 成功后更新 `AUTH_QUERY_KEY` 缓存。
3. App 组件重新渲染进入已认证状态。

## 失败反馈
- 请求失败显示 `error` 文本（优先后端 `{"error":"..."}`）。
- 登录频率受限可返回 429。

## 范围说明
- 仅 web-mode 展示本登录页。
- app-mode 认证由外部 token bridge 提供。

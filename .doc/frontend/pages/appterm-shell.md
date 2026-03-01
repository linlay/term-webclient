# App 模式外壳页（`/appterm`）

## 页面目标
- 在嵌入端（WebView）通过 Bearer token 提供终端能力。

## Token 桥接机制
- `appBridge.ts` 读取 `window.__APPTERM_ACCESS_TOKEN__`。
- 支持 `window.postMessage` 与自定义事件刷新 token。
- `apiClient` 在 401 时会尝试一次 token refresh 并重放请求。

## API/WS 前缀差异
- API: `/appterm/api/*` -> `/appapi/*`
- WS: `/appterm/ws/*` -> `/ws/*`
- WS 建连时附带 `accessToken` query 参数

## 页面状态
- 若 token 缺失且刷新失败，显示 `Waiting for app access token...`
- token 可用后，与 web-mode 一样进入多 tab 终端主流程

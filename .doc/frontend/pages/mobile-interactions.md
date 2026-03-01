# 移动端交互设计

## 视口判定
- `window.innerWidth <= 900` 视为移动端。

## 关键组件
- `MobileShortcutBar`: 虚拟终端按键
- `MobileFileSheet`: 底部文件面板
- `useViewportHeight`: 修正移动端可视高度
- `useMobileScroll`: 控制滚动到底部 FAB 与快捷条展开态

## 虚拟键盘
- 根据 `sessionType/toolId` 切换快捷键集合
- 支持 ESC/TAB/方向键/回车/粘贴
- 包含收起动作，减少遮挡

## 文件面板
- 以 sheet 形式覆盖，不占据桌面侧栏布局
- 长按进入多选语义，支持批量下载归档

## 交互约束
- 当 active tab 不支持 files（如 codex/claude）时自动关闭文件面板。
- ESC 键优先关闭弹层（confirm/context/new-session/files/copilot）。

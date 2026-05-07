# UI Tokens 说明

## 1. 文件位置
- 统一视觉 token 文件：`src/styles/tokens.ts`

## 2. 包含内容与用途
- `colors`：统一颜色语义（背景、文字、边框、状态色）。
- `spacing`：统一间距刻度（内边距、外边距、列表间隔）。
- `radius`：统一圆角刻度（按钮、卡片、胶囊标签）。
- `typography`：统一字体样式（标题、正文、说明、数字强调）。
- `shadows`：统一阴影方案（卡片层级、悬浮层级），同时兼容 iOS `shadow*` 与 Android `elevation`。
- `layout`：统一布局尺寸基线（如底部 Tab 高度、卡片最小高度）。

## 3. 使用约束
- 后续页面和组件开发必须优先复用 `src/styles/tokens.ts`，不要在页面里硬编码颜色和尺寸常量。
- 如果新增视觉变量，优先扩展现有 token，而不是创建第二套风格系统。
- `constants/theme.ts` 仅保留为 Expo 模板兼容层；新增业务 UI 优先直接使用 `src/styles/tokens.ts`。

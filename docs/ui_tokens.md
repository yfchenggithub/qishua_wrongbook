# UI Tokens 说明

## 1. 文件位置
- 统一视觉 token 文件：`src/styles/tokens.ts`

## 2. 包含内容与用途
- `colors`：统一颜色语义（`pageBackground`、`surface`、三级文字、分隔线、唯一品牌色 `accent` 及语义色）。
- `spacing`：统一使用 4、8、12、16、20、24、32 的间距刻度。
- `radius`：统一圆角刻度（按钮、卡片、胶囊标签）。
- `typography`：统一字体样式（标题、正文、说明、数字强调）。
- `shadows`：普通卡片不使用重阴影，仅悬浮层保留轻量阴影。
- `layout`：统一页面边距、卡片内边距、按钮、点击区域、图标和底部 Tab 尺寸。

## 3. 页面公共组件
- `PageShell`：页面背景、安全区、20 点左右边距和底部导航留白。
- `PageHeader` / `OfflineBadge`：一级页标题、副标题、右侧操作和离线状态。
- `SectionHeader`：区分 major 区块标题与 group 设置分组标题。
- `SurfaceCard`：白色、20 点圆角、hairline 边框的普通卡片。
- `PrimaryButton`：56 点高、16 点圆角的品牌主按钮。
- `BottomTabBar`：四个一级页面共用的 64 点底部导航。

## 4. 使用约束
- 后续页面和组件开发必须优先复用 `src/styles/tokens.ts`，不要在页面里硬编码颜色和尺寸常量。
- 如果新增视觉变量，优先扩展现有 token，而不是创建第二套风格系统。
- `constants/theme.ts` 仅保留为 Expo 模板兼容层；新增业务 UI 优先直接使用 `src/styles/tokens.ts`。

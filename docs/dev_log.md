# 开发日志

## 记录规则

每次 Codex 修改后，在本文件追加一条记录。

记录格式：

### YYYY-MM-DD - 任务名称

- 任务目标：
- 修改文件：
- 核心变化：
- 验收结果：
- 遗留问题：
- 下一步：

### 2026-05-07 - 第2步阶段A：路由与页面占位骨架

- 任务目标：搭建页面路径、底部 Tab 与占位跳转关系，不实现业务逻辑。
- 修改文件：
  - `app/(tabs)/_layout.tsx`
  - `app/(tabs)/index.tsx`
  - `app/(tabs)/add.tsx`
  - `app/(tabs)/library.tsx`
  - `app/mistake/[id].tsx`
  - `app/_layout.tsx`
- 核心变化：
  - 底部 Tab 调整为“今日 / 新增 / 题库”。
  - `index`、`add`、`library` 三页改为中文占位内容。
  - 今日页和题库页增加临时按钮，跳转到 `/mistake/demo-1`。
  - 新增动态详情页 `app/mistake/[id].tsx`，展示当前 `id`，返回按钮调用 `router.back()`。
  - 根布局 `Stack` 增加 `mistake/[id]` 路由。
- 验收结果：
  - `npm run typecheck` 通过。
  - `npx eslint . --no-cache` 通过。
  - 仍需在 Web/Android 手工确认页面切换与跳转。
- 遗留问题：当前仍保留模板 `app/(tabs)/explore.tsx` 文件，但已从 Tab 中隐藏，后续可在清理阶段处理。
- 下一步：进入阶段 B，抽离基础视觉 token（颜色、间距、圆角、字号）并建立基础通用组件壳。

### 2026-05-07 - 第2步阶段B：视觉基础层（tokens）

- 任务目标：仅建立统一视觉 token，不还原具体页面，不引入业务逻辑。
- 修改文件：
  - `src/styles/tokens.ts`
  - `constants/theme.ts`
  - `docs/ui_tokens.md`
  - `docs/dev_log.md`
- 核心变化：
  - 新增 `src/styles/tokens.ts`，统一导出 `colors`、`spacing`、`radius`、`typography`、`shadows`、`layout`。
  - `colors` 按设计图收敛为白底 + 黑白灰主色 + 绿色离线状态语义色。
  - `shadows` 同时包含 iOS 阴影属性与 Android `elevation`，便于跨平台复用。
  - 为避免双轨风格系统，`constants/theme.ts` 的 light 主题颜色改为引用新 token。
  - 新增 `docs/ui_tokens.md` 说明 token 位置、用途和复用约束。
- 验收结果：
  - `npm run typecheck` 通过。
  - `npx eslint . --no-cache` 通过（存在 1 条模板生成文件警告：`.expo/types/router.d.ts` 未使用的 eslint-disable）。
- 遗留问题：现有模板 `app/(tabs)/explore.tsx` 等旧示例仍在仓库中，但不影响阶段 B token 建设目标。
- 下一步：进入阶段 C，优先抽取基础组件（如页面头、主按钮、卡片容器、进度点）并统一接入 token。

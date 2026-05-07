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

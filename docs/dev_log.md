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

### 2026-05-07 - 第2步阶段C：通用组件层

- 任务目标：基于 `src/styles/tokens.ts` 创建可复用 UI 组件，不还原完整页面，不接业务逻辑。
- 修改文件：
  - `src/components/ui/ScreenContainer.tsx`
  - `src/components/ui/CardContainer.tsx`
  - `src/components/ui/PrimaryButton.tsx`
  - `src/components/ui/SegmentControl.tsx`
  - `src/components/ui/index.ts`
  - `src/components/wrongbook/OfflineBadge.tsx`
  - `src/components/wrongbook/BrandHeader.tsx`
  - `src/components/wrongbook/ProgressDots.tsx`
  - `src/components/wrongbook/StatusPill.tsx`
  - `src/components/wrongbook/TagChip.tsx`
  - `src/components/wrongbook/SectionTitle.tsx`
  - `src/components/wrongbook/index.ts`
  - `src/components/index.ts`
  - `docs/dev_log.md`
- 核心变化：
  - 新增 10 个通用组件：`ScreenContainer`、`OfflineBadge`、`BrandHeader`、`CardContainer`、`PrimaryButton`、`ProgressDots`、`StatusPill`、`TagChip`、`SectionTitle`、`SegmentControl`。
  - 组件样式统一基于 `tokens`（颜色、间距、圆角、字体、阴影）。
  - `SegmentControl` 提供本地选中态（受控/非受控均支持），仅负责展示与交互外壳。
  - 新增组件聚合导出，方便后续阶段页面组合使用。
- 验收结果：
  - `npm run typecheck` 通过。
  - `npx eslint . --no-cache` 通过（存在 1 条模板生成文件警告：`.expo/types/router.d.ts` 未使用的 eslint-disable）。
- 遗留问题：当前页面尚未接入新组件，预计在下一阶段页面还原中逐步替换占位结构。
- 下一步：进入阶段 D，先落地今日页静态还原并复用本阶段组件。

### 2026-05-07 - 第2步阶段D：今日页静态还原

- 任务目标：按 `docs/design/01_today.png` 还原今日页 UI，全部使用静态 mock 数据，不接业务逻辑。
- 修改文件：
  - `src/mocks/today.ts`
  - `app/(tabs)/index.tsx`
  - `docs/dev_log.md`
- 核心变化：
  - 新增今日页 mock 数据文件，包含品牌区、今日任务统计、优先复做卡片、错题队列两条数据。
  - 今日页改为静态还原结构：顶部品牌区、黑色任务大卡、优先复做模块、错题队列模块。
  - 复用阶段 C 组件：`ScreenContainer`、`BrandHeader`、`SectionTitle`、`CardContainer`、`ProgressDots`、`StatusPill`。
  - 优先复做卡片点击跳转到 `/mistake/demo-1`；缩略图使用本地线框占位图形，不接真实图片。
- 验收结果：
  - `npm run typecheck` 通过。
  - `npx eslint . --no-cache` 通过（存在 1 条模板生成文件警告：`.expo/types/router.d.ts` 未使用的 eslint-disable）。
  - 仍需在 Web/Android 进行手工对照设计图验收。
- 遗留问题：当前为纯静态 mock 展示，列表与进度均未接入真实数据源。
- 下一步：进入阶段 E，完成“新增页”静态还原并复用通用组件。

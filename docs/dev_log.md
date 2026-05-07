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

### 2026-05-07 - 第2步阶段E：新增页静态还原

- 任务目标：按 `docs/design/02_add.png` 还原新增页 UI，只做静态界面，不接相机与保存逻辑。
- 修改文件：
  - `src/mocks/addMistake.ts`
  - `app/(tabs)/add.tsx`
  - `docs/dev_log.md`
- 核心变化：
  - 新增新增页 mock 数据，包含品牌区文案、录入说明卡、三个拍照入口配置、最少标签和底部按钮文案。
  - 新增页改为静态还原结构：顶部品牌区、拍照录入标题、说明卡、3 张拍照入口卡、最少标签区、底部主按钮。
  - 拍照入口中的相机区域使用虚线占位框和本地几何图形占位，不接真实图片和相机能力。
  - 底部主按钮仅弹窗提示“未接入保存逻辑”，不执行数据写入。
- 验收结果：
  - `npm run typecheck` 通过。
  - `npx eslint . --no-cache` 通过（存在 1 条模板生成文件警告：`.expo/types/router.d.ts` 未使用的 eslint-disable）。
  - 仍需在 Web/Android 进行手工对照设计图验收。
- 遗留问题：当前拍照入口与保存按钮均为占位交互，未接业务能力。
- 下一步：进入阶段 F，完成“题库页”静态还原并复用通用组件。

### 2026-05-07 - 第2步阶段F：题库页静态还原

- 任务目标：按 `docs/design/03_library.png` 还原题库页 UI，只做静态 mock，不做真实搜索和真实筛选。
- 修改文件：
  - `src/mocks/library.ts`
  - `app/(tabs)/library.tsx`
  - `docs/dev_log.md`
- 核心变化：
  - 新增题库页 mock 数据，包含品牌区、搜索 placeholder、分段筛选项与 3 条错题卡片数据。
  - 题库页改为静态还原结构：顶部品牌区、搜索框、分段筛选、错题列表卡片。
  - 分段筛选使用本地 `selected` 状态切换，仅改变视觉高亮，不触发真实数据过滤。
  - 搜索框支持输入文本，但不执行真实搜索逻辑。
  - 三张卡片均支持点击跳转：`/mistake/demo-1`、`/mistake/demo-2`、`/mistake/demo-3`。
- 验收结果：
  - `npm run typecheck` 通过。
  - `npx eslint . --no-cache` 通过（存在 1 条模板生成文件警告：`.expo/types/router.d.ts` 未使用的 eslint-disable）。
  - 仍需在 Web/Android 进行手工对照设计图验收。
- 遗留问题：当前搜索与筛选均为 UI 占位态，尚未接入真实数据源。
- 下一步：进入阶段 G，完成“错题详情 / 复做页”静态还原并复用通用组件。

### 2026-05-07 - 第2步阶段G：错题详情 / 复做页静态还原

- 任务目标：按 `docs/design/04_detail.png` 还原详情/复做页 UI，仅使用静态 mock 数据，不接相机和真实复做逻辑。
- 修改文件：
  - `src/mocks/mistakeDetail.ts`
  - `app/mistake/[id].tsx`
  - `docs/dev_log.md`
- 核心变化：
  - 新增详情页 mock 数据文件，按 `id` 提供静态错题详情数据（`demo-1` / `demo-2` / `demo-3`）。
  - 详情页读取动态路由 `id`，并映射为对应的静态展示数据。
  - 页面结构完成静态还原：返回区、品牌区、错题摘要主卡、三张内容预览卡、本次复做记录区、底部主按钮。
  - 预览卡支持横向滚动展示，内容使用几何图形和静态文字占位，不接真实图片/LaTeX。
  - 底部按钮仅弹窗提示“当前为 UI 占位，后续接入复做逻辑”，不更新任何复做数据。
- 验收结果：
  - `npm run typecheck` 通过。
  - `npx eslint . --no-cache` 通过（存在 1 条模板生成文件警告：`.expo/types/router.d.ts` 未使用的 eslint-disable）。
  - 仍需在 Web/Android 进行手工对照设计图验收。
- 遗留问题：当前页面全部为 mock 展示，未接入复做记录落库、拍照、计数更新等业务逻辑。
- 下一步：进入阶段 H，进行页面骨架总体验收与样式一致性收口（不引入业务能力）。

### 2026-05-07 - 第2步阶段H：统一验收与轻量清理

- 任务目标：完成 UI 层面总体验收、轻量清理、命令检查，不引入任何新业务功能。
- 修改文件：
  - `app/(tabs)/add.tsx`
  - `eslint.config.js`
  - `docs/dev_log.md`
- 核心变化：
  - 对四个页面（今日/新增/题库/详情）及路由、Tab、跳转关系做静态代码验收。
  - 统一新增页说明卡的装饰色为黑白灰，避免离线状态以外出现绿色主视觉点。
  - 轻量清理 `eslint.config.js`，新增 `.expo/**` 忽略项，避免生成目录噪声影响代码 lint 结果。
  - 核对组件复用与 mock 数据集中情况，确认第 2 步结构完整可维护。
- 验收结果：
  - `npm run typecheck` 通过。
  - `npx eslint . --no-cache` 通过，无项目代码警告。
  - `npm run lint` 失败：Expo ESLint 缓存写入 `.expo/cache/eslint` 触发 `EPERM`（环境权限问题，非业务代码问题）。
  - `npx expo start` 尝试后失败：端口占用提示后在非交互模式中断；改端口后继续触发读取 `.gitignore` 的 `EPERM`。
  - `npm run web` 尝试后失败：先出现浏览器拉起 `spawn EPERM`，禁用浏览器后仍因读取 `.gitignore` 触发 `EPERM`。
- 遗留问题：
  - 当前环境存在文件权限限制（`EPERM`），影响 Expo Dev Server 在本机命令行直启。
  - 项目 UI 与静态 mock 骨架已完整，但运行态验收仍需在可读写 `.gitignore` 的环境下复核。
- 下一步：
  - 进入第 3 步 SQLite 数据库层前，先确保本机对仓库目录（尤其 `.gitignore`、`.expo/`）有稳定读写权限，再开始数据层接入。

### 2026-05-07 - 第3步阶段3-B：数据模型 types + schema SQL

- 任务目标：仅建立 SQLite 数据层的 TypeScript 数据模型与 schema SQL，不做数据库初始化、不接页面。
- 修改文件：
  - `src/models/Mistake.ts`
  - `src/models/MistakeImage.ts`
  - `src/models/ReviewRecord.ts`
  - `src/db/constants.ts`
  - `src/db/schema.ts`
  - `docs/dev_log.md`
- 核心变化：
  - 新增 `Mistake` / `MistakeImage` / `ReviewRecord` 三类模型与创建入参类型，字段与 `docs/data_contract.md` 对齐。
  - 在 `Mistake` 模型中补充状态与结果相关联合类型：`MistakeStatus`、`MistakeImageType`、`ReviewResult`。
  - 新增 `src/db/constants.ts`，定义数据库名与版本：`qishua_wrongbook.db`、`1`。
  - 新增 `src/db/schema.ts`，集中定义建表 SQL、索引 SQL 与聚合 schema SQL：
    - `CREATE_MISTAKES_TABLE_SQL`
    - `CREATE_MISTAKE_IMAGES_TABLE_SQL`
    - `CREATE_REVIEW_RECORDS_TABLE_SQL`
    - `CREATE_INDEXES_SQL`
    - `CREATE_SCHEMA_SQL`
  - schema 中加入主键、外键（含 `ON DELETE CASCADE`）、默认值与基础 `CHECK` 约束（难度/复做次数/枚举值）。
- 验收结果：
  - `npm run typecheck` 通过。
- 遗留问题：
  - 当前仅完成 schema 与类型定义，尚未实现数据库初始化、迁移策略、Repository 读写。
- 下一步：
  - 进入阶段 3-C：实现 `initDatabase` 与 `openDatabaseAsync` 初始化流程（含建表执行、版本管理、基础错误处理），随后再进入 Repository 层。

### 2026-05-07 - 第3步阶段3-C：DatabaseService 初始化与迁移

- 任务目标：实现 SQLite 打开、初始化、版本检查、健康检查与开发重置能力，不接页面和 Repository CRUD。
- 修改文件：
  - `src/db/database.ts`
  - `src/db/index.ts`
  - `docs/dev_log.md`
- 核心变化：
  - 新增 `getDatabase()`：
    - 使用 `SQLite.openDatabaseAsync(DATABASE_NAME)`。
    - 缓存数据库实例，避免重复打开。
    - 增加并发打开保护（`openingDatabasePromise`）。
  - 新增 `initDatabase()`：
    - 执行 `PRAGMA foreign_keys = ON`。
    - 执行 `PRAGMA journal_mode = WAL`。
    - 读取 `PRAGMA user_version`。
    - 执行基线迁移流程（当前为 v1）：执行 `CREATE_SCHEMA_SQL`，并设置 `user_version = DATABASE_VERSION`。
    - 初始化成功/失败均记录日志，失败抛错。
  - 新增 `getDatabaseVersion()`：读取并返回 `PRAGMA user_version`。
  - 新增 `resetDatabaseForDev()`（仅开发调试）：
    - 删除 `review_records` / `mistake_images` / `mistakes` 三张表。
    - 重置 `user_version = 0` 后重新执行 `initDatabase()`。
  - 新增 `checkDatabaseHealth()`：
    - 检查三张核心表是否存在。
    - 返回结构化结果：`{ ok, version, tables, message }`。
  - 新增 `src/db/index.ts` 统一导出 DB 能力。
  - 全部异常路径统一 `Logger.error`。
- 验收结果：
  - `npm run typecheck` 通过。
- 遗留问题：
  - 当前仅有基线迁移（v1）；后续若提升 `DATABASE_VERSION`，需补充分版本迁移分支。
- 下一步：
  - 进入阶段 3-D：实现 `repositories`（Mistake / MistakeImage / ReviewRecord）基础 CRUD 与查询方法，页面仍先保持静态调用隔离。

### 2026-05-08 - 第3步阶段3-D：MistakeRepository 基础 CRUD

- 任务目标：实现 `mistakes` 表的数据访问层，提供创建、查询、统计、更新、删除能力，不接页面与拍照逻辑。
- 修改文件：
  - `src/repositories/MistakeRepository.ts`
  - `src/repositories/index.ts`
  - `docs/dev_log.md`
- 核心变化：
  - 新增 `MistakeRepository`，提供 8 个方法：
    - `createMistake`
    - `getMistakeById`
    - `listMistakes`
    - `listDueMistakes`
    - `getMistakeStats`
    - `updateMistake`
    - `updateReviewProgress`
    - `deleteMistake`
  - Repository 内部统一调用 `getDatabase()`，并通过 `ensureDatabaseReady()` 懒初始化数据库（内部调用 `initDatabase()`，且在注释中明确启动期应先初始化）。
  - `createMistake` 自动生成 `id`（`M + 时间戳 + 4 位随机数`），并填充默认字段：
    - `subject = math`
    - `difficulty = 3`
    - `review_count = 0`
    - `status = active`
    - `created_at / updated_at = now ISO`
    - `next_review_at` 未传时默认当前时间
  - 所有 SQL 均使用参数绑定，动态筛选仅拼接固定 SQL 片段，不拼接用户输入值。
  - `updateMistake` 支持仅更新传入字段，自动更新 `updated_at`，并处理“无字段更新”场景避免空 SQL。
  - `updateReviewProgress` 仅更新错题进度字段，不创建 `review_records`。
  - `deleteMistake` 删除主表记录并依赖外键级联清理关联表。
  - 新增 `src/repositories/index.ts` 统一导出 Repository 与相关类型。
- 验收结果：
  - `npm run typecheck` 通过。
- 遗留问题：
  - 当前仅完成 `mistakes` 表 Repository；`mistake_images` 与 `review_records` Repository 仍待实现。
- 下一步：
  - 进入阶段 3-E：实现 `ReviewRecordRepository` 和 `MistakeImageRepository`，并补齐“一次复做事务写入”所需的数据层接口。

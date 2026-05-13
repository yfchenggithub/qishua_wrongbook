# 开发日�?
## 记录规则

每次 Codex 修改后，在本文件追加一条记录�?
记录格式�?
### YYYY-MM-DD - 任务名称

- 任务目标�?- 修改文件�?- 核心变化�?- 验收结果�?- 遗留问题�?- 下一步：

### 2026-05-07 - �?步阶段A：路由与页面占位骨架

- 任务目标：搭建页面路径、底�?Tab 与占位跳转关系，不实现业务逻辑�?- 修改文件�?  - `app/(tabs)/_layout.tsx`
  - `app/(tabs)/index.tsx`
  - `app/(tabs)/add.tsx`
  - `app/(tabs)/library.tsx`
  - `app/mistake/[id].tsx`
  - `app/_layout.tsx`
- 核心变化�?  - 底部 Tab 调整为“今�?/ 新增 / 题库”�?  - `index`、`add`、`library` 三页改为中文占位内容�?  - 今日页和题库页增加临时按钮，跳转�?`/mistake/demo-1`�?  - 新增动态详情页 `app/mistake/[id].tsx`，展示当�?`id`，返回按钮调�?`router.back()`�?  - 根布局 `Stack` 增加 `mistake/[id]` 路由�?- 验收结果�?  - `npm run typecheck` 通过�?  - `npx eslint . --no-cache` 通过�?  - 仍需�?Web/Android 手工确认页面切换与跳转�?- 遗留问题：当前仍保留模板 `app/(tabs)/explore.tsx` 文件，但已从 Tab 中隐藏，后续可在清理阶段处理�?- 下一步：进入阶段 B，抽离基础视觉 token（颜色、间距、圆角、字号）并建立基础通用组件壳�?
### 2026-05-07 - �?步阶段B：视觉基础层（tokens�?
- 任务目标：仅建立统一视觉 token，不还原具体页面，不引入业务逻辑�?- 修改文件�?  - `src/styles/tokens.ts`
  - `constants/theme.ts`
  - `docs/ui_tokens.md`
  - `docs/dev_log.md`
- 核心变化�?  - 新增 `src/styles/tokens.ts`，统一导出 `colors`、`spacing`、`radius`、`typography`、`shadows`、`layout`�?  - `colors` 按设计图收敛为白�?+ 黑白灰主�?+ 绿色离线状态语义色�?  - `shadows` 同时包含 iOS 阴影属性与 Android `elevation`，便于跨平台复用�?  - 为避免双轨风格系统，`constants/theme.ts` �?light 主题颜色改为引用�?token�?  - 新增 `docs/ui_tokens.md` 说明 token 位置、用途和复用约束�?- 验收结果�?  - `npm run typecheck` 通过�?  - `npx eslint . --no-cache` 通过（存�?1 条模板生成文件警告：`.expo/types/router.d.ts` 未使用的 eslint-disable）�?- 遗留问题：现有模�?`app/(tabs)/explore.tsx` 等旧示例仍在仓库中，但不影响阶段 B token 建设目标�?- 下一步：进入阶段 C，优先抽取基础组件（如页面头、主按钮、卡片容器、进度点）并统一接入 token�?
### 2026-05-07 - �?步阶段C：通用组件�?
- 任务目标：基�?`src/styles/tokens.ts` 创建可复�?UI 组件，不还原完整页面，不接业务逻辑�?- 修改文件�?  - `src/components/ui/ScreenContainer.tsx`
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
- 核心变化�?  - 新增 10 个通用组件：`ScreenContainer`、`OfflineBadge`、`BrandHeader`、`CardContainer`、`PrimaryButton`、`ProgressDots`、`StatusPill`、`TagChip`、`SectionTitle`、`SegmentControl`�?  - 组件样式统一基于 `tokens`（颜色、间距、圆角、字体、阴影）�?  - `SegmentControl` 提供本地选中态（受控/非受控均支持），仅负责展示与交互外壳�?  - 新增组件聚合导出，方便后续阶段页面组合使用�?- 验收结果�?  - `npm run typecheck` 通过�?  - `npx eslint . --no-cache` 通过（存�?1 条模板生成文件警告：`.expo/types/router.d.ts` 未使用的 eslint-disable）�?- 遗留问题：当前页面尚未接入新组件，预计在下一阶段页面还原中逐步替换占位结构�?- 下一步：进入阶段 D，先落地今日页静态还原并复用本阶段组件�?
### 2026-05-07 - �?步阶段D：今日页静态还�?
- 任务目标：按 `docs/design/01_today.png` 还原今日�?UI，全部使用静�?mock 数据，不接业务逻辑�?- 修改文件�?  - `src/mocks/today.ts`
  - `app/(tabs)/index.tsx`
  - `docs/dev_log.md`
- 核心变化�?  - 新增今日�?mock 数据文件，包含品牌区、今日任务统计、优先复做卡片、错题队列两条数据�?  - 今日页改为静态还原结构：顶部品牌区、黑色任务大卡、优先复做模块、错题队列模块�?  - 复用阶段 C 组件：`ScreenContainer`、`BrandHeader`、`SectionTitle`、`CardContainer`、`ProgressDots`、`StatusPill`�?  - 优先复做卡片点击跳转�?`/mistake/demo-1`；缩略图使用本地线框占位图形，不接真实图片�?- 验收结果�?  - `npm run typecheck` 通过�?  - `npx eslint . --no-cache` 通过（存�?1 条模板生成文件警告：`.expo/types/router.d.ts` 未使用的 eslint-disable）�?  - 仍需�?Web/Android 进行手工对照设计图验收�?- 遗留问题：当前为纯静�?mock 展示，列表与进度均未接入真实数据源�?- 下一步：进入阶段 E，完成“新增页”静态还原并复用通用组件�?
### 2026-05-07 - �?步阶段E：新增页静态还�?
- 任务目标：按 `docs/design/02_add.png` 还原新增�?UI，只做静态界面，不接相机与保存逻辑�?- 修改文件�?  - `src/mocks/addMistake.ts`
  - `app/(tabs)/add.tsx`
  - `docs/dev_log.md`
- 核心变化�?  - 新增新增�?mock 数据，包含品牌区文案、录入说明卡、三个拍照入口配置、最少标签和底部按钮文案�?  - 新增页改为静态还原结构：顶部品牌区、拍照录入标题、说明卡�? 张拍照入口卡、最少标签区、底部主按钮�?  - 拍照入口中的相机区域使用虚线占位框和本地几何图形占位，不接真实图片和相机能力�?  - 底部主按钮仅弹窗提示“未接入保存逻辑”，不执行数据写入�?- 验收结果�?  - `npm run typecheck` 通过�?  - `npx eslint . --no-cache` 通过（存�?1 条模板生成文件警告：`.expo/types/router.d.ts` 未使用的 eslint-disable）�?  - 仍需�?Web/Android 进行手工对照设计图验收�?- 遗留问题：当前拍照入口与保存按钮均为占位交互，未接业务能力�?- 下一步：进入阶段 F，完成“题库页”静态还原并复用通用组件�?
### 2026-05-07 - �?步阶段F：题库页静态还�?
- 任务目标：按 `docs/design/03_library.png` 还原题库�?UI，只做静�?mock，不做真实搜索和真实筛选�?- 修改文件�?  - `src/mocks/library.ts`
  - `app/(tabs)/library.tsx`
  - `docs/dev_log.md`
- 核心变化�?  - 新增题库�?mock 数据，包含品牌区、搜�?placeholder、分段筛选项�?3 条错题卡片数据�?  - 题库页改为静态还原结构：顶部品牌区、搜索框、分段筛选、错题列表卡片�?  - 分段筛选使用本�?`selected` 状态切换，仅改变视觉高亮，不触发真实数据过滤�?  - 搜索框支持输入文本，但不执行真实搜索逻辑�?  - 三张卡片均支持点击跳转：`/mistake/demo-1`、`/mistake/demo-2`、`/mistake/demo-3`�?- 验收结果�?  - `npm run typecheck` 通过�?  - `npx eslint . --no-cache` 通过（存�?1 条模板生成文件警告：`.expo/types/router.d.ts` 未使用的 eslint-disable）�?  - 仍需�?Web/Android 进行手工对照设计图验收�?- 遗留问题：当前搜索与筛选均�?UI 占位态，尚未接入真实数据源�?- 下一步：进入阶段 G，完成“错题详�?/ 复做页”静态还原并复用通用组件�?
### 2026-05-07 - �?步阶段G：错题详�?/ 复做页静态还�?
- 任务目标：按 `docs/design/04_detail.png` 还原详情/复做�?UI，仅使用静�?mock 数据，不接相机和真实复做逻辑�?- 修改文件�?  - `src/mocks/mistakeDetail.ts`
  - `app/mistake/[id].tsx`
  - `docs/dev_log.md`
- 核心变化�?  - 新增详情�?mock 数据文件，按 `id` 提供静态错题详情数据（`demo-1` / `demo-2` / `demo-3`）�?  - 详情页读取动态路�?`id`，并映射为对应的静态展示数据�?  - 页面结构完成静态还原：返回区、品牌区、错题摘要主卡、三张内容预览卡、本次复做记录区、底部主按钮�?  - 预览卡支持横向滚动展示，内容使用几何图形和静态文字占位，不接真实图片/LaTeX�?  - 底部按钮仅弹窗提示“当前为 UI 占位，后续接入复做逻辑”，不更新任何复做数据�?- 验收结果�?  - `npm run typecheck` 通过�?  - `npx eslint . --no-cache` 通过（存�?1 条模板生成文件警告：`.expo/types/router.d.ts` 未使用的 eslint-disable）�?  - 仍需�?Web/Android 进行手工对照设计图验收�?- 遗留问题：当前页面全部为 mock 展示，未接入复做记录落库、拍照、计数更新等业务逻辑�?- 下一步：进入阶段 H，进行页面骨架总体验收与样式一致性收口（不引入业务能力）�?
### 2026-05-07 - �?步阶段H：统一验收与轻量清�?
- 任务目标：完�?UI 层面总体验收、轻量清理、命令检查，不引入任何新业务功能�?- 修改文件�?  - `app/(tabs)/add.tsx`
  - `eslint.config.js`
  - `docs/dev_log.md`
- 核心变化�?  - 对四个页面（今日/新增/题库/详情）及路由、Tab、跳转关系做静态代码验收�?  - 统一新增页说明卡的装饰色为黑白灰，避免离线状态以外出现绿色主视觉点�?  - 轻量清理 `eslint.config.js`，新�?`.expo/**` 忽略项，避免生成目录噪声影响代码 lint 结果�?  - 核对组件复用�?mock 数据集中情况，确认第 2 步结构完整可维护�?- 验收结果�?  - `npm run typecheck` 通过�?  - `npx eslint . --no-cache` 通过，无项目代码警告�?  - `npm run lint` 失败：Expo ESLint 缓存写入 `.expo/cache/eslint` 触发 `EPERM`（环境权限问题，非业务代码问题）�?  - `npx expo start` 尝试后失败：端口占用提示后在非交互模式中断；改端口后继续触发读取 `.gitignore` �?`EPERM`�?  - `npm run web` 尝试后失败：先出现浏览器拉起 `spawn EPERM`，禁用浏览器后仍因读�?`.gitignore` 触发 `EPERM`�?- 遗留问题�?  - 当前环境存在文件权限限制（`EPERM`），影响 Expo Dev Server 在本机命令行直启�?  - 项目 UI 与静�?mock 骨架已完整，但运行态验收仍需在可读写 `.gitignore` 的环境下复核�?- 下一步：
  - 进入�?3 �?SQLite 数据库层前，先确保本机对仓库目录（尤�?`.gitignore`、`.expo/`）有稳定读写权限，再开始数据层接入�?
### 2026-05-07 - �?步阶�?-B：数据模�?types + schema SQL

- 任务目标：仅建立 SQLite 数据层的 TypeScript 数据模型�?schema SQL，不做数据库初始化、不接页面�?- 修改文件�?  - `src/models/Mistake.ts`
  - `src/models/MistakeImage.ts`
  - `src/models/ReviewRecord.ts`
  - `src/db/constants.ts`
  - `src/db/schema.ts`
  - `docs/dev_log.md`
- 核心变化�?  - 新增 `Mistake` / `MistakeImage` / `ReviewRecord` 三类模型与创建入参类型，字段�?`docs/data_contract.md` 对齐�?  - �?`Mistake` 模型中补充状态与结果相关联合类型：`MistakeStatus`、`MistakeImageType`、`ReviewResult`�?  - 新增 `src/db/constants.ts`，定义数据库名与版本：`qishua_wrongbook.db`、`1`�?  - 新增 `src/db/schema.ts`，集中定义建�?SQL、索�?SQL 与聚�?schema SQL�?    - `CREATE_MISTAKES_TABLE_SQL`
    - `CREATE_MISTAKE_IMAGES_TABLE_SQL`
    - `CREATE_REVIEW_RECORDS_TABLE_SQL`
    - `CREATE_INDEXES_SQL`
    - `CREATE_SCHEMA_SQL`
  - schema 中加入主键、外键（�?`ON DELETE CASCADE`）、默认值与基础 `CHECK` 约束（难�?复做次数/枚举值）�?- 验收结果�?  - `npm run typecheck` 通过�?- 遗留问题�?  - 当前仅完�?schema 与类型定义，尚未实现数据库初始化、迁移策略、Repository 读写�?- 下一步：
  - 进入阶段 3-C：实�?`initDatabase` �?`openDatabaseAsync` 初始化流程（含建表执行、版本管理、基础错误处理），随后再进�?Repository 层�?
### 2026-05-07 - �?步阶�?-C：DatabaseService 初始化与迁移

- 任务目标：实�?SQLite 打开、初始化、版本检查、健康检查与开发重置能力，不接页面�?Repository CRUD�?- 修改文件�?  - `src/db/database.ts`
  - `src/db/index.ts`
  - `docs/dev_log.md`
- 核心变化�?  - 新增 `getDatabase()`�?    - 使用 `SQLite.openDatabaseAsync(DATABASE_NAME)`�?    - 缓存数据库实例，避免重复打开�?    - 增加并发打开保护（`openingDatabasePromise`）�?  - 新增 `initDatabase()`�?    - 执行 `PRAGMA foreign_keys = ON`�?    - 执行 `PRAGMA journal_mode = WAL`�?    - 读取 `PRAGMA user_version`�?    - 执行基线迁移流程（当前为 v1）：执行 `CREATE_SCHEMA_SQL`，并设置 `user_version = DATABASE_VERSION`�?    - 初始化成�?失败均记录日志，失败抛错�?  - 新增 `getDatabaseVersion()`：读取并返回 `PRAGMA user_version`�?  - 新增 `resetDatabaseForDev()`（仅开发调试）�?    - 删除 `review_records` / `mistake_images` / `mistakes` 三张表�?    - 重置 `user_version = 0` 后重新执�?`initDatabase()`�?  - 新增 `checkDatabaseHealth()`�?    - 检查三张核心表是否存在�?    - 返回结构化结果：`{ ok, version, tables, message }`�?  - 新增 `src/db/index.ts` 统一导出 DB 能力�?  - 全部异常路径统一 `Logger.error`�?- 验收结果�?  - `npm run typecheck` 通过�?- 遗留问题�?  - 当前仅有基线迁移（v1）；后续若提�?`DATABASE_VERSION`，需补充分版本迁移分支�?- 下一步：
  - 进入阶段 3-D：实�?`repositories`（Mistake / MistakeImage / ReviewRecord）基础 CRUD 与查询方法，页面仍先保持静态调用隔离�?
### 2026-05-08 - �?步阶�?-D：MistakeRepository 基础 CRUD

- 任务目标：实�?`mistakes` 表的数据访问层，提供创建、查询、统计、更新、删除能力，不接页面与拍照逻辑�?- 修改文件�?  - `src/repositories/MistakeRepository.ts`
  - `src/repositories/index.ts`
  - `docs/dev_log.md`
- 核心变化�?  - 新增 `MistakeRepository`，提�?8 个方法：
    - `createMistake`
    - `getMistakeById`
    - `listMistakes`
    - `listDueMistakes`
    - `getMistakeStats`
    - `updateMistake`
    - `updateReviewProgress`
    - `deleteMistake`
  - Repository 内部统一调用 `getDatabase()`，并通过 `ensureDatabaseReady()` 懒初始化数据库（内部调用 `initDatabase()`，且在注释中明确启动期应先初始化）�?  - `createMistake` 自动生成 `id`（`M + 时间�?+ 4 位随机数`），并填充默认字段：
    - `subject = math`
    - `difficulty = 3`
    - `review_count = 0`
    - `status = active`
    - `created_at / updated_at = now ISO`
    - `next_review_at` 未传时默认当前时�?  - 所�?SQL 均使用参数绑定，动态筛选仅拼接固定 SQL 片段，不拼接用户输入值�?  - `updateMistake` 支持仅更新传入字段，自动更新 `updated_at`，并处理“无字段更新”场景避免空 SQL�?  - `updateReviewProgress` 仅更新错题进度字段，不创�?`review_records`�?  - `deleteMistake` 删除主表记录并依赖外键级联清理关联表�?  - 新增 `src/repositories/index.ts` 统一导出 Repository 与相关类型�?- 验收结果�?  - `npm run typecheck` 通过�?- 遗留问题�?  - 当前仅完�?`mistakes` �?Repository；`mistake_images` �?`review_records` Repository 仍待实现�?- 下一步：
  - 进入阶段 3-E：实�?`ReviewRecordRepository` �?`MistakeImageRepository`，并补齐“一次复做事务写入”所需的数据层接口�?
### 2026-05-08 - �?步阶�?-E：MistakeImageRepository + ReviewRecordRepository

- 任务目标：实�?`mistake_images` �?`review_records` 两张表的 Repository 数据访问能力，不�?UI、不接拍照、不接文件系统�?- 修改文件�?  - `src/repositories/MistakeImageRepository.ts`
  - `src/repositories/ReviewRecordRepository.ts`
  - `src/repositories/index.ts`
  - `docs/dev_log.md`
- 核心变化�?  - 新增 `MistakeImageRepository`，提供：
    - `createMistakeImage`
    - `listImagesByMistakeId`
    - `listImagesByType`
    - `deleteImage`
    - `deleteImagesByMistakeId`
  - `createMistakeImage` 自动生成 `id`（`IMG + 时间�?+ 4 位随机数`）与 `created_at`，创建后回查返回记录�?  - 新增 `ReviewRecordRepository`，提供：
    - `createReviewRecord`
    - `listReviewRecordsByMistakeId`
    - `getLatestReviewRecord`
    - `deleteReviewRecord`
    - `deleteReviewRecordsByMistakeId`
  - `createReviewRecord` 自动生成 `id`（`R + 时间�?+ 4 位随机数`）与 `created_at`，并�?`review_index` �?`1-7` 范围检查�?  - 两个 Repository 均在内部调用 `getDatabase()`，并使用懒初始化保护（`initDatabase()`）避免未初始化直接调用导致失败�?  - 全部 SQL 使用参数绑定，不拼接用户输入�?  - 更新 `src/repositories/index.ts` 统一导出�?    - `MistakeRepository`
    - `MistakeImageRepository`
    - `ReviewRecordRepository`
- 验收结果�?  - `npm run typecheck` 通过�?- 遗留问题�?  - 当前仅提供基础 CRUD；尚未实现“同事务写入复做记录 + 更新错题进度”的组合接口�?- 下一步：
  - 进入阶段 3-F：实现复做事务服务（Service 层）或协调器，统一串联 `ReviewRecordRepository` �?`MistakeRepository.updateReviewProgress`�?
### 2026-05-08 - �?步阶�?-F：数据库健康检查开发页

- 任务目标：新增仅开发调试使用的数据库健康检查页面，便于�?Web/Android 验证 SQLite 初始化、查询与重置能力�?- 修改文件�?  - `app/dev/db.tsx`
  - `docs/dev_log.md`
- 核心变化�?  - 新增路由�?`app/dev/db.tsx`，可通过 `/dev/db` 访问，且不放入底�?Tab�?  - 页面提供返回按钮与“仅开发调试使用”提示�?  - 接入数据库调试能力按钮：
    - 初始化数据库：`initDatabase()`
    - 健康检查：`checkDatabaseHealth()`
    - 插入示例错题：`MistakeRepository.createMistake()`（固�?mock 数据�?    - 查询错题列表：`MistakeRepository.listMistakes({ limit: 20, offset: 0 })`
    - 查询统计：`MistakeRepository.getMistakeStats()`
    - 清空开发数据：二次确认后调�?`resetDatabaseForDev()` 并重新初始化
  - 页面展示关键结果：健康检查结构化输出、最近插�?ID、错题列表、统计数据�?  - 所有异常均在页面展示，并调�?`Logger.error` 记录�?- 验收结果�?  - `npm run typecheck` 通过�?- 遗留问题�?  - Web �?SQLite 能力依赖运行环境实现，若浏览器不支持或受限，需�?Android 真机优先验证�?- 下一步：
  - 进入阶段 3-G：实现“复做一次”的事务化调试接口（写入 `review_records` + 更新 `mistakes` 进度），并在开发页补充一键验证流程�?
### 2026-05-08 - Web 热修复：expo-sqlite wasm 资源解析

- 任务目标：修�?Web �?`expo-sqlite` 报错 `Unable to resolve module ... wa-sqlite.wasm`�?- 修改文件�?  - `metro.config.js`
  - `docs/dev_log.md`
- 核心变化�?  - 新增 Metro 配置并基�?`expo/metro-config` 扩展默认项�?  - �?`wasm` 加入 `resolver.assetExts`，让 Metro �?`wa-sqlite.wasm` 作为静态资源解析而不是源码模块�?- 验收结果�?  - 本地配置检查通过：`assetExts` 已包�?`wasm`�?  - `npx expo export --platform web` 在当前环境仍�?`spawn EPERM` 阻塞，无法在本机完成最�?Web 打包验收�?- 遗留问题�?  - 当前机器存在进程启动权限问题（`spawn EPERM`），会影�?Metro/Web 打包命令�?- 下一步：
  - 先修复本�?`spawn EPERM` 环境权限，再重新执行 `npm run web` �?`npx expo export --platform web` 复验�?
### 2026-05-08 - �?步阶�?-G：App 启动初始�?+ 首页轻量统计读取

- 任务目标：在 App 启动时初始化 SQLite，并在首页轻量读取统计数据验证数据库可用，不全面切库�?- 修改文件�?  - `app/_layout.tsx`
  - `app/(tabs)/index.tsx`
  - `docs/dev_log.md`
- 核心变化�?  - 在根布局接入一次性数据库初始化：
    - 使用模块�?`appDatabaseInitPromise` 缓存初始化过程，避免重复初始化�?    - �?`useEffect` 中触�?`initDatabase()`，初始化成功 `Logger.info`，失�?`Logger.error`�?    - 不增加复杂阻塞流程，保持页面可正常渲染�?  - 在今日页接入统计轻量读取�?    - 挂载时调�?`MistakeRepository.getMistakeStats()`�?    - 用数据库统计替换任务卡片中的四项数字�?      - 今日待复做（`dueToday`�?      - 总错题（`total`�?      - 已七刷（`mastered`�?      - 完成率（`mastered / total` 计算�?    - 读取失败时回退�?`0`，并展示轻量提示，同�?`Logger.error` 记录错误�?    - 保留优先复做与错题队列卡片为静�?mock，仅加注释性提示文案说明未接真实列表�?- 验收结果�?  - `npm run typecheck` 通过�?- 遗留问题�?  - 首页当前仅接统计数字，错题列表仍�?mock；与预期一致，后续阶段再逐步接入真实列表�?- 下一步：
  - 进入阶段 3-H：新增“复做一次”的事务化服务接口（�?`review_records` + 更新 `mistakes` 进度）并�?`/dev/db` 增加联调按钮�?
### 2026-05-08 - �?步阶�?-B：图片类型、目录规则、文件命名规�?
- 任务目标：只定义图片相关类型与路�?命名规则，不调用相机、不访问文件系统、不接页面与数据库�?- 修改文件�?  - `src/models/LocalImage.ts`
  - `src/constants/image.ts`
  - `src/services/ImagePathService.ts`
  - `docs/dev_log.md`
- 核心变化�?  - 新增 `LocalImageType`、`LocalImage`、`PickedImageResult`、`SavedImageResult` 类型定义�?  - 新增图片常量�?    - `IMAGE_ROOT_DIR_NAME = 'qishua_wrongbook'`
    - `MISTAKE_IMAGE_DIR_NAME = 'mistakes'`
    - `IMAGE_FILE_PREFIX`（`question/my_solution/answer/review_solution`�?    - `IMAGE_FILE_EXTENSION = 'jpg'`
    - `IMAGE_QUALITY = 0.85`
    - `IMAGE_MAX_WIDTH = 1800`
    - `IMAGE_MAX_HEIGHT = 2400`
  - 新增纯函数服�?`ImagePathService`（不依赖 FileSystem）：
    - `normalizeImageType(type)`
    - `buildMistakeImageDir(mistakeId)`
    - `buildImageFileName(type, index?)`
    - `buildImageRelativePath(mistakeId, type, fileName)`
    - `createImageId()`
  - 路径规则按相对目录约定：`qishua_wrongbook/mistakes/{mistakeId}/...`
- 验收结果�?  - `npm run typecheck` 通过�?- 遗留问题�?  - 当前仅完成规则定义，尚未实现真实拍照、选图和文件持久化动作�?- 下一步：
  - 进入阶段 4-C：实�?`ImageService` 与文件系统持久化（目录创建、复制、删除、错误处理），并�?`/dev/images` 做开发调试验证�?
### 2026-05-08 - �?步阶�?-C：ImageStorageService 本地目录与文件持久化

- 任务目标：实现本地图片目录创建、临时图复制到持久目录、图片信息读取与删除，不接相机、页面和 SQLite�?- 修改文件�?  - `src/services/ImageStorageService.ts`
  - `docs/dev_log.md`
- 核心变化�?  - 新增 `ImageStorageService`，使�?`expo-file-system@~19.0.22` 当前 SDK �?`File / Directory / Paths` API（不混用 legacy API）�?  - 实现方法�?    - `ensureImageRootDir()`
    - `ensureMistakeImageDir(mistakeId)`
    - `saveTempImageToMistakeFolder(params)`
    - `getImageInfo(uri)`
    - `listMistakeImageFiles(mistakeId)`
    - `deleteLocalImage(uri)`
    - `deleteMistakeImageFolder(mistakeId)`
  - 目录与命名规则严格复用常量与路径服务�?    - 根目录：`qishua_wrongbook/`
    - 错题目录：`qishua_wrongbook/mistakes/{mistakeId}/`
    - 文件名：`question_001.jpg` / `my_solution_001.jpg` / `answer_001.jpg` / `review_001.jpg`
  - `saveTempImageToMistakeFolder` 在目标文件已存在时自动递增 index，必要时 fallback 到时间戳避免覆盖�?  - 按要求不删除 `tempUri` 源文件；保存失败返回 `ok: false` 并记�?`Logger.error`�?- 验收结果�?  - `npm run typecheck` 通过�?- 遗留问题�?  - 当前仅完成文件系统层，不含拍�?选图入口；需下一阶段接入调试页联调�?- 下一步：
  - 进入阶段 4-D：新�?`/dev/images` 调试页，串联图片选择（后续）+ `ImageStorageService` 保存/列表/删除能力�?
### 2026-05-08 - �?步阶�?-E：ImageService 组合拍照/选图与持久化

- 任务目标：封装页面唯一图片入口，完成“拍�?选图 -> 临时 URI -> 本地持久目录保存 -> 返回 LocalImage”流程，不接 SQLite�?- 修改文件�?  - `src/services/ImageService.ts`
  - `src/services/index.ts`
  - `docs/dev_log.md`
- 核心变化�?  - 新增 `ImageService`，对外提供：
    - `takePhotoAndSave(params)`
    - `pickImageAndSave(params)`
    - `getLocalImageInfo(uri)`
    - `deleteLocalImage(uri)`
    - `deleteMistakeImages(mistakeId)`
  - `takePhotoAndSave` 内部流程�?    - 调用 `ImagePickerService.takePhoto()`
    - 用户取消安全返回 `ok: false`
    - 成功后调�?`ImageStorageService.saveTempImageToMistakeFolder()`
    - 返回 `SavedImageResult`
  - `pickImageAndSave` 内部流程�?    - 调用 `ImagePickerService.pickImageFromLibrary()`
    - 用户取消安全返回 `ok: false`
    - 成功后调�?`ImageStorageService.saveTempImageToMistakeFolder()`
    - 返回 `SavedImageResult`
  - 统一错误策略�?    - 所有异常路径调�?`Logger.error`
    - 不向页面抛出未捕获异�?  - 新增 `src/services/index.ts` 统一导出 `ImageService / ImagePickerService / ImageStorageService / Logger`�?- 验收结果�?  - `npx eslint src/services/ImageService.ts src/services/index.ts` 通过�?  - 全量 `npm run typecheck` 仍受已有 `.expo/types/router.d.ts` 历史解析错误影响（非本阶段新增）�?- 遗留问题�?  - 本阶段未接入 SQLite，不写入 `mistake_images` 表（按范围要求保留到后续阶段）�?- 下一步：
  - 进入阶段 4-F：新�?`/dev/images` 调试页，串联 `ImageService` 做真机拍�?选图/保存/删除端到端验证�?
### 2026-05-08 - �?步阶�?-D：ImagePickerService 相机/相册/权限

- 任务目标：实现相机与相册选择能力和权限请求，返回临时图片信息，不做持久化保存、不接页面业务�?- 修改文件�?  - `src/services/ImagePickerService.ts`
  - `app.json`
  - `docs/dev_log.md`
- 核心变化�?  - 新增 `ImagePickerService`，导出：
    - `requestCameraPermission()`
    - `requestMediaLibraryPermission()`
    - `takePhoto()`
    - `pickImageFromLibrary()`
    - `openPermissionHelp()`
  - `takePhoto()` �?`pickImageFromLibrary()` 统一返回 `PickedImageResult`�?    - 成功：`{ canceled: false, tempUri, width, height, fileSize }`
    - 用户取消：`{ canceled: true }`
    - 权限不足/异常：`{ canceled: true, errorMessage }`
  - 选择器调用使用当�?API 约定�?    - 不使用已废弃�?`MediaTypeOptions`
    - 使用 `mediaTypes: ['images']`
    - 不使�?`result.uri`，统一读取 `result.assets[0]`
    - 不使用旧字段 `result.cancelled`，统一使用 `result.canceled`
  - 补充 `app.json` 最小权限文案（`expo-image-picker` plugin）：
    - `cameraPermission`
    - `photosPermission`
- 验收结果�?  - `app.json` 语法校验通过�?  - 全仓 `npm run typecheck` 当前被已�?`.expo/types/router.d.ts` 解析错误阻塞（历史环境问题，非本阶段 ImagePickerService 引入）�?- 遗留问题�?  - 暂未接入页面与真机联调入口（按阶段边界保留到下一阶段）�?- 下一步：
  - 进入阶段 4-E：新增开发调试页（如 `/dev/images`）串�?`ImagePickerService + ImageStorageService`，完成拍�?选图到本地持久化的端到端验证�?
### 2026-05-08 - �?步阶�?-F：图片压�?缩放层（ImageOptimizeService�?
- 任务目标：在保存前增加可选图片标准化处理，控制体积并保持题目文字清晰；优化失败时自动回退原图�?- 修改文件�?  - `src/services/ImageOptimizeService.ts`
  - `src/services/ImageService.ts`
  - `src/services/index.ts`
  - `docs/dev_log.md`
- 核心变化�?  - 新增 `optimizeImageForStorage(params)`�?    - 输入临时 `uri`
    - 超过 `IMAGE_MAX_WIDTH / IMAGE_MAX_HEIGHT` 时等比缩�?    - 使用 `IMAGE_QUALITY` 作为默认压缩质量
    - 输出新的优化后临�?`uri`（不覆盖原图�?    - 返回 `ok/uri/width/height/fileSize/errorMessage`
  - `ImageService.takePhotoAndSave / pickImageAndSave` 已接入优化流程：
    - 先优化后保存
    - 优化成功则保存优化图
    - 优化失败�?`Logger.error` 记录并回退保存原临时图
  - `src/services/index.ts` 增加 `ImageOptimizeService` 统一导出�?- 验收结果�?  - `npx eslint src/services/ImageOptimizeService.ts src/services/ImageService.ts src/services/index.ts` 通过�?  - `npm run typecheck` 通过�?- 遗留问题�?  - 本阶段仍未接�?SQLite，不写入 `mistake_images` 表（按范围控制）�?- 下一步：
  - 进入阶段 4-G：新�?`/dev/images` 调试页，真机验证“拍�?选图 -> 优化 -> 保存 -> 查看体积 -> 删除”完整链路�?

### 2026-05-08 - Step 4-G: /dev/images Image Debug Page

- Goal: Add a development-only image debug page for camera permission, capture/pick, local persistence, preview, restart persistence check, and deletion.
- Files changed:
  - `app/dev/images.tsx`
  - `docs/dev_log.md`
- Key changes:
  - Added `/dev/images` page with fixed `mistakeId = dev-image-test`.
  - Added camera/media permission check buttons and result display (`granted/status/canAskAgain/message`).
  - Added 4 capture-save buttons for `question/my_solution/answer/review_solution`.
  - Added 4 pick-save buttons for `question/my_solution/answer/review_solution`.
  - Added image list refresh by calling `ImageStorageService.listMistakeImageFiles('dev-image-test')`.
  - For each image: show URI, preview, exists/size info, and delete button.
  - Added delete folder button with confirmation via `ImageService.deleteMistakeImages('dev-image-test')`.
  - Added status/error area and router back button.
- Validation:
  - `npx eslint app/dev/images.tsx` passed.
  - `npm run typecheck` passed.
- Next:
  - Step 4-H: lightweight acceptance and cleanup for image capability (Android device focused), then prepare integration into formal Add page flow.



### 2026-05-08 - Step 4-H: ͼƬ����ͳһ���ա��ĵ���������������

- ����Ŀ�꣺��ɵ�4��ͳһ���գ������ĵ�˵�����������ֲ�������������5��ҵ�񿪷���
- �޸��ļ���
  - `app/dev/images.tsx`
  - `src/services/ImageService.ts`
  - `docs/architecture.md`
  - `docs/data_contract.md`
  - `docs/testing.md`
  - `docs/dev_log.md`
- ���ļ���������
  - �˶Ե�4�������ļ������ԣ�LocalImage��image constants��Path/Picker/Storage/ImageService��dev/images����
  - `/dev/images` ��Ϊ������ `ImageService`������ֱ�ӵ��� `ImagePickerService`��`ImageStorageService`��
  - `ImageService` ����������װ��
    - `checkCameraPermission()`
    - `checkMediaLibraryPermission()`
    - `listLocalImagesByMistakeId()`
  - �������֣����� SQLite����д `MistakeRepository`��������ʽҳ������ҵ��
- �����飺
  - `npm run typecheck` ͨ����
  - `npm run lint` ͨ������ error / warning����
  - `npx expo start --offline --port 8087` �ѳ��ԣ�����жϣ�δ��ɳ���������֤����
  - `npm run android` ʧ�ܣ�`spawn EPERM`����������/Ȩ�޻������⣩��
- ��һ����
  - �����5��ǰ�����ڿ��� Android ��������� `docs/testing.md` ������ͨ��4�������嵥��

### 2026-05-08 - 第5步阶段5-B：表单类型、选项常量、校验规则

- 任务目标：仅定义录入错题草稿类型、选项常量、ID 规则与草稿校验函数；不接页面、不写数据库、不调用相机。
- 修改文件：
  - `src/models/AddMistakeDraft.ts`
  - `src/constants/mistakeOptions.ts`
  - `src/utils/id.ts`
  - `src/services/AddMistakeValidationService.ts`
  - `docs/dev_log.md`
- 核心变化：
  - 新增 `AddMistakeDraft`、`AddMistakeValidationResult`、`CreateMistakeFromDraftInput` 类型定义。
  - 新增错题录入选项常量：`SUBJECT_OPTIONS`、`MODULE_OPTIONS`、`ERROR_REASON_OPTIONS`、`DIFFICULTY_OPTIONS`。
  - 新增通用 ID 工具：`createMistakeId()`、`createRecordId(prefix)`，格式为前缀 + `yyyyMMddHHmmss` + 随机短串，不依赖第三方库。
  - 新增 `AddMistakeValidationService`：
    - `createEmptyAddMistakeDraft()`：初始化草稿并提前生成 `draftId`。
    - `validateAddMistakeDraft()`：实现题目照片必填、模块必填、难度范围校验（1-5）。
  - 设计约束落实：草稿阶段即生成 `draftId`，后续用于图片目录和 `mistakes.id` 对齐，保证 ID 一致性。
- 验收结果：
  - 待执行 `npm run typecheck`。
- 遗留问题：
  - 当前仅完成建模与校验，尚未接入新增页状态管理与图片预览交互（按阶段边界保留）。
- 下一步：
  - 进入 5-C：把草稿状态与校验接入新增页（不落库），完成拍照入口、预览、错误提示与保存前校验联动。

### 2026-05-08 - 第5步阶段5-B（补充验收）

- 验收结果补充：`npm run typecheck` 通过。

### 2026-05-08 - 第5步阶段5-C：CreateMistakeService 保存错题业务用例

- 任务目标：封装“AddMistakeDraft -> mistakes + mistake_images”保存流程，不接页面、不调相机、不改数据库结构。
- 修改文件：
  - `src/services/CreateMistakeService.ts`
  - `src/models/Mistake.ts`
  - `src/repositories/MistakeRepository.ts`
  - `src/services/index.ts`
  - `docs/dev_log.md`
- 核心变化：
  - 新增 `createMistakeFromDraft(draft)`，返回 `{ ok, mistakeId?, errorMessage? }`。
  - 先调用 `validateAddMistakeDraft`；校验失败直接返回 `ok: false`，并合并错误信息。
  - 保存时强制使用 `draft.draftId` 作为 `mistakeId`，保持图片目录与数据库主键一致。
  - 新增错题保存映射：
    - 写入 `mistakes`：subject/module/title/error_reason/difficulty/question_image_uri/answer_image_uri/note/next_review_at。
    - 写入 `mistake_images`：按存在情况分别写入 `question`、`my_solution`、`answer`。
  - `MistakeRepository.createMistake` 支持外部 `id`：
    - `CreateMistakeInput` 新增 `id?: string`。
    - 传 `id` 则使用传入值；不传仍沿用原自动生成逻辑，保持 `/dev/db` 兼容。
  - 一致性策略：
    - 优先尝试 `withTransactionAsync`（若运行环境提供）。
    - 无事务封装时启用最小安全补偿：若主记录已创建且后续失败，尝试删除已创建的 mistake 记录。
  - 错误处理：所有异常 `Logger.error`，服务内部吞掉异常并返回 `ok: false`，不向页面抛出未捕获错误。
- 验收结果：
  - `npm run typecheck` 通过。
- 遗留问题：
  - 当前事务能力依赖运行时 `withTransactionAsync` 可用性；后续可在 db 层统一封装事务 API，减少服务层分支判断。
- 下一步：
  - 进入 5-D：在新增页接入草稿状态与保存调用（含按钮 loading、防重复点击、错误提示、成功后跳转/重置草稿）。

### 2026-05-08 - 第5步阶段5-D：新增页接入本地草稿交互（不落库）

- 任务目标：将新增页从静态展示升级为本地可交互草稿页，支持标签选择、图片拍照/选图/预览/删除，以及保存前校验；本阶段不写 SQLite。
- 修改文件：
  - `app/(tabs)/add.tsx`
  - `docs/dev_log.md`
- 核心变化：
  - 页面初始化：使用 `createEmptyAddMistakeDraft()` 初始化本地草稿，进入页面即生成 `draftId` 并展示在页面中。
  - 表单状态接入：接入 `module`、`errorReason`、`difficulty`、`title`、`note`、`questionImage`、`mySolutionImage`、`answerImage` 本地状态。
  - 图片交互接入：
    - 题目图：`takePhotoAndSave({ mistakeId: draft.draftId, type: 'question' })` / `pickImageAndSave(...)`
    - 我的做法：`type: 'my_solution'`
    - 答案解析：`type: 'answer'`
    - 选图后展示预览图与文件名。
  - 删除图片：点击删除调用 `deleteLocalImage(uri)`，并清空草稿对应字段；删除失败会有提示。
  - 标签选择：
    - 模块：Chip 单选（再次点击可取消）
    - 错因：Chip 单选（可取消）
    - 难度：1-5 Chip 选择
  - 保存按钮行为：仅执行 `validateAddMistakeDraft(draft)`，
    - 通过：提示“草稿校验通过，下一阶段接入保存”
    - 失败：弹窗+页面错误卡片展示
    - 不调用 `CreateMistakeService`，不写数据库
  - 防重复点击：图片相关操作期间统一进入 busy 状态，禁用图片操作按钮和底部主按钮。
- 验收结果：
  - `npm run typecheck` 通过。
- 遗留问题：
  - 当前仍未接入正式保存链路（`CreateMistakeService`）与成功后页面状态清理流程（按阶段边界保留）。
- 下一步：
  - 进入 5-E：在新增页接入 `CreateMistakeService` 正式保存、保存中状态、成功后重置草稿与失败错误兜底。

### 2026-05-08 - 第5步阶段5-E：新增页接入保存错题（写入 SQLite）

- 任务目标：将新增页保存按钮接入正式保存流程，完成 `mistakes` 与 `mistake_images` 落库；本阶段不做列表/详情真实读取。
- 修改文件：
  - `app/(tabs)/add.tsx`
  - `docs/dev_log.md`
- 核心变化：
  - 保存按钮接入：
    - 点击后先执行 `validateAddMistakeDraft(draft)`。
    - 校验失败：展示错误提示并中断保存。
    - 校验通过：调用 `createMistakeFromDraft(draft)` 执行正式落库。
  - 保存中状态：
    - 新增 `isSaving` 状态。
    - 保存期间按钮文案显示“保存中...”，并禁用按钮。
    - 与图片操作 busy 状态合并，防止重复点击导致重复创建。
  - 保存成功处理：
    - 提示“错题已加入 7 刷计划”，并显示 `mistakeId` 便于调试。
    - 页面留在新增页，不跳转详情。
    - 重置草稿（重新生成 `draftId`）、清空图片预览和校验错误。
  - 保存失败处理：
    - 弹窗展示错误信息。
    - 保留当前草稿与图片，不清空。
    - 使用 `Logger.error` 记录失败日志。
- 验收结果：
  - `npm run typecheck` 通过。
- 遗留问题：
  - 本阶段未接入保存成功后的列表刷新/详情联动（按阶段边界保留）。
- 下一步：
  - 进入 5-F：补充端到端验收与防呆细节（如更细粒度错误文案、重复保存边界校验、调试数据核对流程文档化）。

### 2026-05-08 - 第5步阶段5-F：保存体验与异常处理打磨

- 任务目标：在不新增业务能力的前提下，打磨新增页保存体验、校验提示、防重复点击与删除失败处理。
- 修改文件：
  - `app/(tabs)/add.tsx`
  - `docs/testing.md`
  - `docs/dev_log.md`
- 核心变化：
  - 防重复保存：
    - 复用 `isSaving + isImageBusy` 组合 `isBusy`，保存中按钮保持 disabled。
    - 按钮文案保持“保存中...”，保存期间不允许再次点击。
    - 保存过程中不清空草稿，仅在保存成功后重置。
  - 校验错误展示：
    - 新增校验文案标准化，页面错误卡片可明确展示：
      - 请先拍题目照片
      - 请选择模块
      - 难度不合法
    - 校验失败同时保留 Alert 提示，便于快速感知。
  - 保存失败体验：
    - 新增 `saveErrorMessage`，在页面错误卡片可见保存失败信息，不只依赖弹窗。
    - 关键失败统一 `Logger.error`，并带 `draftId` 便于调试。
  - 保存成功后重置：
    - 新增 `createNextDraft(previousDraftId)`，确保新 `draftId` 不等于旧值（重试机制）。
    - 成功后重置空草稿，图片预览、模块/错因/难度、标题/备注恢复默认。
  - 删除图片体验：
    - 删除期间沿用 busy 禁用，防重复点击。
    - 删除失败不再误清预览，改为保留当前图片并提示失败。
    - 删除失败记录 `Logger.error`，页面不崩溃。
  - 草稿残留风险记录：
    - 在 `add.tsx` 增加 TODO：未保存离开页面可能残留草稿图片，后续考虑“放弃草稿清理目录”。
    - 在 `docs/testing.md` 追加第5步体验验收与该风险说明。
- 验收结果：
  - `npm run typecheck` 通过。
- 遗留问题：
  - 尚未实现“离开页面自动清理未保存草稿目录”（按当前阶段范围保留）。
- 下一步：
  - 进入 5-G：围绕保存链路补充开发调试验证（含 mistake_images 可视化核对）与回归验收清单收口。

### 2026-05-08 - 第5步阶段5-G：录入错题联合验收调试增强

- 任务目标：增强 `/dev/db` 调试能力，便于联合验证新增页保存后 `mistakes`、`mistake_images` 与本地图片文件一致性。
- 修改文件：
  - `app/dev/db.tsx`
  - `docs/testing.md`
  - `docs/dev_log.md`
- 核心变化：
  - `/dev/db` 新增“查询最近10条错题”能力，展示字段：
    - `id`
    - `title`
    - `module`
    - `error_reason`
    - `difficulty`
    - `question_image_uri`
    - `answer_image_uri`
    - `review_count`
    - `status`
    - `created_at`
  - `/dev/db` 新增“查看该错题图片记录”按钮：
    - 读取 `mistake_images` 指定 `mistake_id` 的所有记录
    - 展示 `type`、`uri`、`created_at`
  - `/dev/db` 新增图片文件存在性检查：
    - 对每条 `uri` 调用 `ImageStorageService.getImageInfo(uri)`
    - 展示 `exists` 与 `size`
  - 重置数据库时同步清空最近错题列表、已选错题图片记录与图片检查结果，避免旧态残留。
  - 更新 `docs/testing.md`：新增“第5步录入错题联合验收（5-G）”流程清单。
- 验收结果：
  - `npm run typecheck` 通过。
- 遗留问题：
  - `/dev/db` 目前只做开发调试展示，不承载正式业务页面。
- 下一步：
  - 进入 5-H：执行完整联合回归（新增页保存 -> /dev/db 核验 -> 重启持久化核验）并按问题清单收口体验细节。

### 2026-05-08 - 第5步阶段5-H：统一验收、文档更新、轻量清理

- 任务目标：在不进入第6步的前提下，完成第5步统一体检、文档补充与轻量清理。
- 修改文件：
  - `docs/architecture.md`
  - `docs/data_contract.md`
  - `docs/testing.md`
  - `docs/dev_log.md`
- 本阶段检查结论（代码层）：
  - 第5步核心文件齐全：`AddMistakeDraft`、`mistakeOptions`、`id`、`AddMistakeValidationService`、`CreateMistakeService`、`add.tsx`。
  - 新增页已具备：模块/错因/难度选择、拍照/选图、预览、删除、保存前校验、保存中防重复、成功后重置、失败后保留草稿。
  - 保存链路已打通：`CreateMistakeService` 使用 `draftId` 作为 `mistake.id`，并写入 `mistake_images`。
  - `/dev/db` 已支持最近10条错题、按错题查询图片记录、图片 `exists/size` 检查。
- 文档补充：
  - `architecture.md`：追加第5步录入错题数据流与分层约束。
  - `data_contract.md`：追加 `AddMistakeDraft -> mistakes/mistake_images` 字段映射与一致性约束。
  - `testing.md`：追加第5步统一验收清单（交互、保存链路、/dev/db、重启持久化、已知风险）。
- 命令结果：
  - `npm run typecheck`：通过。
  - `npm run lint`：通过。
- 轻量清理说明：
  - 本阶段未改业务逻辑与数据库结构，仅补充文档与验收说明。
- 下一步建议：
  - 可结束第5步并进入第6步“错题列表真实读取”，优先先做 Repository -> Service -> 页面最小链路。

### 2026-05-08 - 第6步阶段6-B：Repository 查询能力增强

- 任务目标：增强 `MistakeRepository` 查询能力，支持题库页真实列表所需的筛选、搜索、排序与计数；本阶段不接页面、不改 UI、不改数据库结构。
- 修改文件：
  - `src/repositories/MistakeRepository.ts`
  - `docs/dev_log.md`
- 核心变化：
  - 扩展 `ListMistakesOptions`：
    - `status?: 'active' | 'mastered' | 'archived' | 'all'`
    - `module?: string | null`
    - `keyword?: string | null`
    - `dueOnly?: boolean`
    - `limit?: number`
    - `offset?: number`
    - `sortBy?: 'created_at' | 'updated_at' | 'next_review_at' | 'review_count'`
    - `sortOrder?: 'asc' | 'desc'`
  - 增强 `listMistakes(options?)`：
    - 默认 `limit=50`、`offset=0`
    - 默认排序 `updated_at desc`
    - 支持 `status/module/keyword/dueOnly` 条件组合
    - `status='all'` 时不加状态条件
    - `dueOnly=true` 时强制筛选 `status=active AND next_review_at<=今天`
    - `keyword` 在 `title/module/error_reason/note` 上执行 `LIKE` 搜索
    - 所有用户输入均通过参数绑定
    - `sortBy/sortOrder` 使用白名单归一化后再拼接固定 SQL 片段
  - 新增 `countMistakes(options?)`：与 `listMistakes` 复用同一筛选条件构建逻辑，返回总数。
  - 新增 `listRecentMistakes(limit?)`：按 `created_at DESC`，默认 10 条。
  - 新增 `listActiveMistakes(limit?)`：`status=active`，按 `next_review_at ASC`，默认 50 条。
  - 新增 `listMasteredMistakes(limit?)`：`status=mastered`，按 `updated_at DESC`，默认 50 条。
  - 保持 `listDueMistakes(todayIsoDate?)` 语义不变：`status=active`、`next_review_at<=today`、`next_review_at ASC`。
- 安全约束：
  - 未引入 ORM。
  - 未修改数据库 schema。
  - 查询条件参数全部绑定，未拼接外部输入。
  - 排序字段与顺序采用白名单归一化，防止注入。
- 验收结果：
  - `npm run typecheck` 通过。
- 下一步建议：
  - 进入 6-C：新增 `MistakeListService` / mapper（或 hook）承接列表 ViewModel 映射与分页编排，再接入题库页。

### 2026-05-08 - 第6步阶段6-C：错题列表 ViewModel / Service

- 任务目标：新增错题列表专用 ViewModel 与 Service，将 Repository 数据转换为页面可直接展示的数据；本阶段不接 UI、不改数据库结构。
- 修改文件：
  - `src/models/MistakeListItem.ts`
  - `src/services/MistakeListService.ts`
  - `src/utils/date.ts`
  - `src/services/index.ts`
  - `docs/dev_log.md`
- 核心变化：
  - 新增 `MistakeListItem` 模型：
    - `MistakeListStatus`: `due_today | upcoming | mastered | archived`
    - `MistakeListItem`：封装列表展示所需字段（title/subtitle/thumbnail/statusLabel/displayStatus 等）
    - `MistakeListFilter`：`segment | keyword | module`
  - 新增 `MistakeListService`：
    - `getMistakeListItems(filter)`：按 segment 映射 Repository 查询并返回 `MistakeListItem[]`
    - `mapMistakeToListItem(mistake)`：统一映射 DB 字段 -> 展示字段
    - `getMistakeListStats()`：返回 `{ total, due, mastered }`
  - 新增最小日期工具 `src/utils/date.ts`：
    - `toDateOnlyString(date)`
    - `formatDateShort(iso)`
    - `isDueTodayOrBefore(iso)`
  - `segment` 到 Repository 的映射：
    - `all` -> `status: 'all'`
    - `due` -> `dueOnly: true, sortBy: 'next_review_at', sortOrder: 'asc'`
    - `mastered` -> `status: 'mastered'`
  - `statusLabel` 规则：
    - `mastered` -> `已七刷`
    - `archived` -> `已归档`
    - `active` 且 `next_review_at <= 今天` -> `今天第 N+1 刷`
    - 其他 active -> `待复做`
- 分层说明：
  - Repository 继续只负责数据查询。
  - Service 负责展示字段转换，页面后续仅消费 `MistakeListItem`。
- 验收结果：
  - `npm run typecheck` 通过。
- 下一步建议：
  - 进入 6-D：将 `library.tsx` 接入 `MistakeListService`，完成真实列表加载、segment/搜索联动、空态与错误态展示。

### 2026-05-08 - 第6步阶段6-D：题库页接入 SQLite 真实列表

- 任务目标：将题库页从静态 mock 切换为 SQLite 真实读取，完成基础展示与状态兜底；本阶段不接详情真实数据、不改新增页。
- 修改文件：
  - `app/(tabs)/library.tsx`
  - `docs/dev_log.md`
- 核心变化：
  - 数据读取：
    - 页面加载时通过 `MistakeListService.getMistakeListItems({ segment: 'all', keyword: '' })` 拉取列表。
    - 使用 `useCallback + useEffect` 组织加载流程。
  - 列表容器：
    - 使用 `FlatList` 渲染。
    - `keyExtractor={(item) => item.id}`，不使用 index。
  - 三态兜底：
    - 加载态：显示 `ActivityIndicator + 正在加载题库...`
    - 错误态：显示错误文案与“点击重试”按钮
    - 空状态：显示“题库还没有错题，先去新增页录入一题。”
  - 卡片展示：
    - 展示 `thumbnailUri`（失败时回退占位图）
    - 展示 `module`、`title`、`subtitle`
    - `ProgressDots`：`total=maxReviewCount`、`current=reviewCount`、`completed=reviewCount`
    - `StatusPill`：使用 `statusLabel`，并按 `displayStatus` 映射 tone
  - 跳转：
    - 点击卡片跳转 `/mistake/[id]`，实际路径 `/mistake/${item.id}`。
  - 轻量统计：
    - 顶部显示“当前共 X 题”，使用当前列表长度。
  - 视觉保留：
    - 保留品牌头、搜索框、分段筛选、白底圆角卡片风格。
- 验收结果：
  - `npm run typecheck` 通过。
- 下一步建议：
  - 进入 6-E：把搜索框与分段筛选真正映射到 Service filter（all/due/mastered + keyword + module），并补充下拉刷新与筛选联动测试。
### 2026-05-08 - 第6步阶段6-E：题库页接入搜索、筛选、排序联动

- 任务目标：让题库页搜索框与分段筛选真正驱动 SQLite 列表查询，补齐刷新、空结果、错误提示等交互兜底；不改数据库结构、不做高级筛选。
- 修改文件：
  - `app/(tabs)/library.tsx`
  - `docs/dev_log.md`
- 核心变化：
  - 分段筛选映射：
    - `all -> segment: all`
    - `pending -> segment: due`
    - `mastered -> segment: mastered`
  - 搜索接入：
    - 新增 `searchText` 与 `debouncedKeyword` 双状态
    - 使用 `setTimeout + clearTimeout`（350ms）实现 debounce
    - 关键词传入 `MistakeListService.getMistakeListItems({ segment, keyword })`
  - 列表刷新机制：
    - 首次加载显示主 loading
    - 筛选/搜索变更走轻量刷新 `isRefreshing`
    - 支持下拉刷新与错误重试
  - 空态区分：
    - 搜索关键词非空且无结果：`没有找到相关错题`
    - 无关键词且无数据：`题库还没有错题，先去新增页录入一题。`
  - 错误态兜底：
    - 显示错误文案 + `点击重试`
  - 搜索清空：
    - 输入框右侧新增清空按钮，清空后立即回到当前 segment 的全量结果
  - 列表稳定性：
    - 继续使用 `keyExtractor={(item) => item.id}`
    - 保留卡片风格、进度点、状态胶囊、点击跳转 `/mistake/[id]`
- 验收结果：
  - `npm run typecheck` 通过。
- 遗留问题：
  - 当前仍未实现模块下拉筛选与排序菜单（按阶段边界保留到后续）。
- 下一步：
  - 进入 6-F：题库页交互打磨与性能/体验收口（例如更细粒度错误提示、列表刷新体验、手工回归清单）。
### 2026-05-08 - 第6步阶段6-F：题库页缩略图、空态、错误态、加载态完善

- 任务目标：不新增业务能力，仅完善题库列表显示体验，包括缩略图占位、空状态分支、错误重试与加载反馈。
- 修改文件：
  - `app/(tabs)/library.tsx`
  - `docs/dev_log.md`
- 核心变化：
  - 缩略图：
    - `thumbnailUri` 存在时使用 `Image` 渲染，固定尺寸 `112 x 112`，`resizeMode="cover"`。
    - 图片加载失败（`onError`）或 `thumbnailUri` 为空时显示占位块。
    - 占位块样式改为 `题目 / 无图` 文案 + 图标，不依赖图片资源。
  - 加载态：
    - 首次加载文案改为 `正在加载错题...`。
    - 保留轻量刷新提示 `刷新中...`，不遮挡列表主内容。
  - 空状态：
    - 全部为空：`暂无错题，去新增页录入第一题`
    - 搜索无结果：`没有找到相关错题`
    - 待复做为空：`今天没有待复做错题`
    - 已七刷为空：`还没有完成七刷的错题`
  - 错误态：
    - 数据读取失败时显示 `数据读取失败：...`。
    - 提供 `重试` 按钮触发重新查询。
  - 去新增入口：
    - 空状态增加 `去新增错题` 按钮，点击跳转 `/add`。
  - 刷新能力：
    - `FlatList` 接入 `RefreshControl`，支持下拉刷新。
- 验收结果：
  - `npm run typecheck` 通过。
- 下一步：
  - 进入 6-G：题库列表交互与可读性收口（如卡片信息层级微调、长文案截断策略、回归测试清单补齐）。
### 2026-05-08 - 第6步阶段6-G：首页“错题队列 / 今日待复做”轻量接入真实数据

- 任务目标：保持首页原有视觉结构不变，将首页关键数据从 mock 切换为 SQLite 真实数据，并补齐 loading/error/empty 兜底。
- 修改文件：
  - `app/(tabs)/index.tsx`
  - `docs/dev_log.md`
- 核心变化：
  - 今日任务统计改为真实数据：
    - 调用 `MistakeListService.getMistakeListStats()` 读取 `total/due/mastered`
    - 首页大卡展示：今日待复做、总错题、已七刷、完成率
    - `total = 0` 时完成率显示 `0%`
  - 优先复做改为真实数据：
    - 调用 `MistakeListService.getMistakeListItems({ segment: 'due', keyword: '' })`
    - 取第 1 条作为“优先复做”卡片
    - 无待复做时显示空状态“今天没有待复做错题”，并提供“去新增错题”按钮
  - 错题队列改为真实数据：
    - 调用 `MistakeListService.getMistakeListItems({ segment: 'all', keyword: '' })`
    - 展示前 3 条真实错题
    - 卡片点击跳转 `/mistake/[id]`
  - 去掉首页假错题兜底：
    - 数据库为空时不再展示 mock 错题，改为空状态文案
  - 状态处理补齐：
    - `loading`：首次进入显示“正在加载今日待复做... / 正在加载错题队列...”
    - `error`：读取失败显示错误文案并提供“重试”按钮
    - `empty`：无数据时显示对应空状态与“去新增错题”入口
  - 页面返回刷新：
    - 使用 `useFocusEffect` 在页面 focus 时自动重新读取首页数据
- 验收结果：
  - 本阶段代码已完成；`npm run typecheck` 当前被既有路由类型问题阻塞：`app/modal.tsx` 使用 `href="/"` 与当前 Expo Router 类型不匹配（非本阶段改动引入）。
- 下一步：
  - 进入 6-H：首页与题库页联动收口（回归验证、文案一致性、边界场景验证清单）。
### 2026-05-08 - 第6步阶段6-H：统一验收、文档更新、轻量清理

- 任务目标：完成第6步收口检查与文档补充，不进入第7步详情页真实读取。
- 修改文件：
  - `app/modal.tsx`
  - `docs/architecture.md`
  - `docs/testing.md`
  - `docs/data_contract.md`
  - `docs/dev_log.md`
- 核心检查结果：
  - 关键文件存在并已实现：`MistakeListItem`、`MistakeListService`、`date.ts`、`library.tsx`、`index.tsx`。
  - Repository 查询能力满足第6步需要：`listMistakes` 支持 `keyword/status/dueOnly/sort/limit/offset`，`countMistakes` 已实现并复用同筛选条件。
  - 页面层未直接写 SQL，查询均经 Service/Repository。
  - 题库页支持真实列表、搜索筛选、缩略图兜底、空态/错态/加载态、重试与下拉刷新。
  - 首页支持真实统计、优先复做与错题队列轻量接入，并在 focus 时刷新。
- 轻量清理：
  - 修复 `app/modal.tsx` 路由类型错误：`href="/"` -> `href="/(tabs)/index"`，解除 typecheck 阻塞。
- 命令结果：
  - `npm run typecheck`：通过。
  - `npm run lint`：通过。
  - 按当前协作约束，本阶段未继续执行 `expo start` / `npm run android`（避免长时阻塞）。
- 下一步：
  - 可结束第6步，进入第7步前先明确详情页查询边界（仅读取 + 展示，不提前接入复做更新）。
- 补充更正：`app/modal.tsx` 最终保留 `href="/"`，并已验证可通过 `npm run typecheck`。

### 2026-05-08 - 第7步阶段7-B：详情页 ViewModel / DetailService

- 任务目标：新增错题详情展示模型与服务层聚合能力，打通“按 id 读取错题 + 图片记录 + 本地文件存在性检查”的只读链路，不改详情页 UI。
- 修改文件：
  - `src/models/MistakeDetailViewModel.ts`
  - `src/services/MistakeDetailService.ts`
  - `src/services/index.ts`
  - `docs/dev_log.md`
- 核心变化：
  - 新增 `MistakeDetailViewModel`：
    - 定义 `DetailImageSlotType`：`question/my_solution/answer/review_solution`。
    - 定义 `DetailImageSlot`：`type/title/uri/exists/fileSize/emptyText`。
    - 定义 `MistakeDetailViewModel`：聚合详情页展示所需字段（标题、副标题、状态、进度、图片槽位等）。
  - 新增 `MistakeDetailService.getMistakeDetail(id)`：
    - 入参校验：`id` 为空直接返回 `ok: false`。
    - 读取主记录：`MistakeRepository.getMistakeById(id)`；找不到返回 `notFound: true`。
    - 读取图片记录：`MistakeImageRepository.listImagesByMistakeId(id)`。
    - 构建图片槽位（本阶段三块）：
      - 题目：优先 `mistake.question_image_uri`，否则回退 `mistake_images(type=question)`。
      - 我的做法：取 `mistake_images(type=my_solution)`。
      - 答案：优先 `mistake.answer_image_uri`，否则回退 `mistake_images(type=answer)`。
    - 对每个有 `uri` 的槽位调用 `ImageStorageService.getImageInfo(uri)`，回填 `exists/fileSize`。
      - 图片检查异常时不抛出到页面，槽位回退为 `exists=false`。
    - 组装展示字段：
      - `statusLabel`：`已七刷/已归档/第 N 刷`。
      - `title`：优先 `mistake.title`，为空回退 `${module}错题`。
      - `subtitle`：`error_reason + difficulty + created_at`（短日期）组合。
  - 更新服务导出：
    - `src/services/index.ts` 新增 `MistakeDetailService` 导出。
- 验收结果：
  - `npm run typecheck` 通过。
- 下一步：
  - 进入 7-C：在不改业务边界的前提下，将 `app/mistake/[id].tsx` 接入 `getMistakeDetail`，补 `loading/error/notFound` 三态并移除 mock 依赖。

### 2026-05-08 - 第7步阶段7-C：详情页读取真实 id 与真实数据

- 任务目标：将 `app/mistake/[id].tsx` 从静态 mock 切换为按路由 id 读取 SQLite 真实详情数据，补齐 `loading/error/notFound` 状态；不接复做写入逻辑。
- 修改文件：
  - `app/mistake/[id].tsx`
  - `docs/dev_log.md`
- 核心变化：
  - 路由 id 读取：
    - 使用 `useLocalSearchParams<{ id?: string | string[] }>()` 获取路由参数。
    - 新增 `normalizeRouteId`，统一处理 `string | string[] | undefined`，并对空字符串做无效拦截。
    - `id` 无效时进入错误态，提示“错题 id 无效，请返回重试”。
  - 详情数据加载：
    - 页面通过 `MistakeDetailService.getMistakeDetail(routeId)` 读取真实详情。
    - 使用 `useEffect` 在进入页面和 `id` 变化时触发重载。
    - 增加 `requestIdRef`，避免异步请求返回顺序反转导致旧数据覆盖新数据。
  - 状态兜底：
    - `loading`：显示 `ActivityIndicator + 正在读取错题详情...`
    - `notFound`：显示“未找到错题”状态卡，支持返回与重试
    - `error`：显示“加载失败”状态卡，支持返回与重试
  - 摘要卡接入真实字段：
    - 展示 `module/title/subtitle/reviewCount/maxReviewCount/statusLabel/difficulty`。
    - `errorReason`、`note` 按有值才展示。
    - 复用 `ProgressDots` 和 `StatusPill`，并按 `status` 映射 tone。
  - 图片区接入 `imageSlots`：
    - 展示题目/我的做法/答案三类图片（过滤 `review_solution`）。
    - `uri && exists=true` 时展示图片。
    - `uri` 存在但文件缺失或加载失败时展示“图片文件不存在”。
    - `uri` 不存在时展示 `emptyText`。
    - 增加“刷新”按钮支持手动重拉详情。
  - 底部复做按钮：
    - 保留按钮 UI 与文案占位，点击仅 `Alert('第 8 步接入复做流程')`。
    - 本阶段不更新 `review_count`，不写入 `review_records`。
- 验收结果：
  - `npm run typecheck` 通过。
- 下一步：
  - 进入 7-D：统一首页/题库页到详情页的跳转入口校验（确保传入真实 SQLite id），补充 Android 真机回归清单与边界场景验证。

### 2026-05-08 - 第7步阶段7-D：详情页图片预览组件完善

- 任务目标：将详情页题目/我的做法/答案图片展示抽离为可复用组件，完善图片存在、缺失、空数据与加载失败状态，不接全屏预览与重拍。
- 修改文件：
  - `src/components/wrongbook/DetailImageCard.tsx`
  - `src/components/wrongbook/index.ts`
  - `app/mistake/[id].tsx`
  - `docs/dev_log.md`
- 核心变化：
  - 新增 `DetailImageCard` 组件：
    - Props：`title/uri/exists/fileSize/emptyText/height`。
    - 默认纵向卡片布局，适配窄屏阅读。
    - 图片展示使用 `Image` + `resizeMode="contain"`，降低裁剪风险。
  - 组件状态完善：
    - `uri` 存在且 `exists=true`：显示图片，并可显示文件大小。
    - `uri` 存在但 `exists=false`：显示“图片文件不存在”与短 uri，不红屏。
    - `uri` 为空：显示 `emptyText`，并使用虚线浅灰占位框。
    - 图片加载失败：`onError` 进入“图片加载失败”状态，并 `console.warn` 记录。
  - 详情页接入：
    - `app/mistake/[id].tsx` 移除内联 `ImageSlotCard`，改为复用 `DetailImageCard`。
    - 保持原有三块图槽（题目/做法/答案）和刷新逻辑不变。
- 验收结果：
  - `npm run typecheck` 当前被 `.expo/types/router.d.ts` 语法损坏阻塞（非本阶段业务代码逻辑报错）。
- 下一步：
  - 进入 7-E：详情页交互与状态文案收口（含 notFound/error 的体验一致性、图片区提示文案统一、Android 真机回归清单补齐）。

### 2026-05-08 - 第7步阶段7-E：详情页 loading / error / not found / 图片缺失状态完善

- 任务目标：不新增业务能力，完善详情页异常状态可用性与可验收性，确保图片异常不影响整页可读性。
- 修改文件：
  - `app/mistake/[id].tsx`
  - `docs/dev_log.md`
- 核心变化：
  - Loading 状态：
    - 首次进入显示 `正在加载错题...`，保留页面骨架避免白屏。
    - 手动刷新支持 `keepCurrent` 模式：保留当前详情内容，仅显示“刷新中...”，减少闪烁。
  - Not Found 状态：
    - 统一标题/文案为“没有找到这道错题”。
    - 展示 `错题 ID` 辅助定位。
    - 提供“返回”与“刷新”按钮。
  - Error 状态：
    - 标题改为“读取错题失败”。
    - 错误文案通过 `toBriefErrorMessage` 压缩为简短版本。
    - 提供“重试”与“返回”按钮。
    - 页面层增加 `Logger.error` 记录（无效 id、读取失败、异常抛错）。
  - 返回行为：
    - 优先 `router.back()`；若不可返回，回退到 `router.replace('/(tabs)/library')`。
  - 复做按钮占位文案：
    - `active`：`开始第 N 刷`（首刷）或 `标记第 N 刷完成`（后续刷次）。
    - `mastered`：`已完成七刷`。
    - `archived`：`已归档`。
    - 非 `active` 状态按钮禁用；`active` 点击仅提示“第 8 步接入复做流程”。
  - 图片异常策略：
    - 继续复用 `DetailImageCard`：空 uri 显示 `emptyText`、文件缺失显示“图片文件不存在”、加载失败显示“图片加载失败”。
    - 单张图片异常不影响页面其他内容与状态。
- 验收结果：
  - `npx eslint "app/mistake/[id].tsx" --no-cache` 通过。
  - `npm run typecheck` 仍被 `.expo/types/router.d.ts` 语法损坏阻塞（非本阶段业务改动引入）。
- 下一步：
  - 进入 7-F：详情页交互验收收口（Android 真机回归路径、边界场景脚本化清单、状态文案与按钮策略最终统一）。

### 2026-05-08 - 第7步阶段7-F：首页与题库页跳转一致性检查

- 任务目标：确保首页与题库页进入详情页时统一传递真实 SQLite `mistake.id`，清理 demo 跳转风险，不新增业务逻辑。
- 修改文件：
  - `app/(tabs)/library.tsx`
  - `app/(tabs)/index.tsx`
  - `docs/dev_log.md`
- 核心变化：
  - 题库页跳转统一：
    - 新增 `normalizeMistakeId` + `handleOpenDetail`。
    - 卡片点击统一走 `handleOpenDetail(item.id)`，内部校验非空后再 `router.push(`/mistake/${routeId}`)`。
    - `id` 为空时仅 `Logger.warn`，不进行错误跳转。
  - 首页跳转统一：
    - 同步新增 `normalizeMistakeId` + `handleOpenDetail`。
    - “优先复做”与“错题队列”两处卡片点击统一走 `handleOpenDetail`。
    - 若 `id` 异常为空，阻断跳转并记录 `Logger.warn`。
  - 入口一致性结论：
    - 题库页、首页、详情页链路均使用真实数据流：`MistakeRepository -> MistakeListService -> MistakeListItem.id -> /mistake/{id}`。
    - 页面内未发现 `demo-1/demo-2` 等假 id 跳转。
  - 空状态行为：
    - 首页/题库无数据时继续显示空状态卡和“去新增错题”，不显示可点击假卡片。
- 验收结果：
  - `npx eslint "app/(tabs)/library.tsx" "app/(tabs)/index.tsx" --no-cache` 通过。
  - `npm run typecheck` 通过。
- 下一步：
  - 建议进入 7-G：详情页入口到回退链路的 Android 真机回归（首页/题库/空状态/异常状态联测）并收口测试清单。


### 2026-05-08 - 第7步阶段7-G：/dev/db 调试能力增强（详情页可达性核验）

- 任务目标：增强 `/dev/db` 最近错题调试列表，支持快速判断某条错题能否进入真实详情页，不改正式业务页面。
- 修改文件：
  - `app/dev/db.tsx`
  - `docs/dev_log.md`
- 核心变化：
  - 最近错题列表新增字段：
    - `id`
    - `title`
    - `module`
    - `question_image_uri_has_value`（题目图 uri 是否有值）
    - `question_image_exists`（题目图文件是否存在；无题目图时显示 `(无题目图)`）
    - `review_count`
    - `status`
  - 最近错题列表新增“打开详情页”按钮：
    - 点击执行 `router.push(`/mistake/${mistake.id}`)`。
    - 增加 `id` 兜底校验，空 id 时仅 `Logger.warn`，不跳转。
  - 轻量实现方式：
    - 复用已有 `MistakeRepository.listMistakes`。
    - 复用已有 `ImageStorageService.getImageInfo` 检查题目图文件存在性。
    - 保留原有“查看该错题图片记录”按钮与结构，不大改开发页。
- 验收结果：
  - `npx eslint "app/dev/db.tsx" --no-cache` 通过。
  - `npm run typecheck` 仍被 `.expo/types/router.d.ts` 语法损坏阻塞（非本阶段改动引入）。
- 下一步：
  - 可进入 7-H：详情页与调试页联动回归（从 `/dev/db` 一键打开详情，覆盖存在图/缺图/无图场景）。

### 2026-05-08 - 第8步阶段8-B：复做服务层闭环（事务一致性）

- 任务目标：仅实现复做提交服务层闭环，不改 UI 页面。
- 修改文件：
  - `src/utils/date.ts`
  - `src/services/ReviewScheduleService.ts`
  - `src/models/ReviewFlow.ts`
  - `src/db/database.ts`
  - `src/db/index.ts`
  - `src/repositories/MistakeRepository.ts`
  - `src/repositories/ReviewRecordRepository.ts`
  - `src/repositories/MistakeImageRepository.ts`
  - `src/repositories/index.ts`
  - `src/services/CompleteReviewService.ts`
  - `src/services/index.ts`
  - `docs/architecture.md`
  - `docs/data_contract.md`
  - `docs/testing.md`
  - `docs/dev_log.md`
- 核心变化：
  - 新增 `ReviewScheduleService`，统一复做索引、可复做判断、下次复做日期和状态计算。
  - 新增 `ReviewFlow` 模型，定义 `ReviewSession`、`CompleteReviewInput`、`CompleteReviewResult`。
  - 新增 `withDatabaseTransaction`，优先复用 `withTransactionAsync`，无该 API 时回退 `BEGIN IMMEDIATE/COMMIT/ROLLBACK`。
  - 新增 `CompleteReviewService.completeReview()`：参数校验、状态硬校验、防重复提交、统一事务写入、失败孤儿图片清理。
  - Repository 最小增强：新增事务内写入方法（`createReviewRecordInTransaction`、`createMistakeImageInTransaction`、`updateReviewProgressInTransaction`）。
- 验收结果：
  - 需执行 `npm run typecheck` 验证类型通过。
- 遗留问题：
  - 本阶段不含 UI 接入，下一阶段再接复做页与详情按钮。
- 下一步：
  - 进入 8-C：复做页 UI 与提交流程接线。
### 2026-05-08 - 第8步阶段8-C：复做页 UI 与提交交互

- 任务目标：接入真实复做页，打通“详情页进入复做页 -> 拍复做照片 -> completeReview 提交 -> 返回详情页”的页面闭环，不改数据库结构。
- 修改文件：
  - `app/review/[id].tsx`
  - `app/mistake/[id].tsx`
  - `app/_layout.tsx`
  - `src/services/ReviewFlowService.ts`
  - `src/services/index.ts`
  - `docs/testing.md`
  - `docs/dev_log.md`
- 核心变化：
  - 新增复做页路由 `app/review/[id].tsx`，支持真实 `id` 读取、loading/notFound/error 状态、返回详情入口。
  - 新增 `ReviewFlowService.getReviewPageData(id)`，聚合详情数据与 `ReviewSession` 给复做页使用。
  - 复做页仅展示题目图片（question），并处理“无图/文件缺失/加载失败”三类兜底文案。
  - 新增“本次复做照片”交互：拍照保存、预览、重拍、删除；提交中禁止重复拍照/删除。
  - 提交按钮接入 `CompleteReviewService.completeReview()`，严格校验“必须有复做照片”和 `canReview` 状态。
  - 提交成功后根据 `newStatus` 提示并 `router.replace('/mistake/[id]')` 返回详情页；失败保留照片与页面状态。
  - 详情页底部按钮改为真实入口：
    - `active && reviewCount < 7` -> `开始第 N 刷`，点击跳转 `/review/[id]`
    - `mastered` -> `已完成七刷`（禁用）
    - `archived` -> `已归档`（禁用）
  - 根路由注册 `review/[id]` 页面。
- 验收结果：
  - `npm run typecheck` 通过。
  - `npm run lint` 通过。
- 遗留问题：
  - 暂不接入“从相册选择”入口（本阶段可选项，已保留拍照主链路）。
- 下一步：
  - 进入 8-D：复做历史展示与详情页联动刷新体验收口（含 Android 真机回归清单）。
### 2026-05-08 - 第8步阶段8-D：详情 / 首页 / 题库联动刷新与 Android 回归

- 任务目标：在不新增业务能力前提下，完成复做提交后的多页状态一致刷新，补齐详情复做记录展示与 7/7 场景回归。
- 修改文件：
  - `app/mistake/[id].tsx`
  - `app/(tabs)/library.tsx`
  - `src/models/MistakeDetailViewModel.ts`
  - `src/services/MistakeDetailService.ts`
  - `docs/testing.md`
  - `docs/architecture.md`
  - `docs/data_contract.md`
  - `docs/dev_log.md`
- 核心变化：
  - 详情页增加 focus 刷新机制，复做返回后自动重拉真实详情。
  - 详情页新增“复做记录”模块，展示第 N 刷、created_at、result、照片状态。
  - `MistakeDetailService` 聚合 `review_records`，页面不直接访问 SQL。
  - 题库页新增 focus 刷新，确保从详情/复做返回时进度与状态即时更新。
  - 保持首页既有 focus 刷新策略，确保统计与队列与复做结果同步。
  - 7/7 场景继续由 `CompleteReviewService` + 状态文案/禁用按钮共同保证。
- 验收结果：
  - `npm run typecheck` 通过。
  - `npx eslint "app/(tabs)/settings.tsx" --no-cache` 通过。
- 遗留问题：
  - 本阶段未新增全局事件总线；依赖 focus 刷新策略，符合 MVP 简化约束。
- 下一步：
  - 可进入最终验收阶段，执行 Android 真机全链路回归并收口问题清单。
### 2026-05-08 - 第8步阶段8-E：最终验收与轻量清理

- 任务目标：完成第8步闭环最终审计，确认“录入 -> 题库 -> 详情 -> 复做 -> 提交 -> 七刷 mastered”链路成立，并收口文档。
- 修改文件：
  - `docs/testing.md`
  - `docs/architecture.md`
  - `docs/data_contract.md`
  - `docs/dev_log.md`
- 核心检查：
  - 录入链路：Add 页面校验与保存写库路径清晰，`question_image_uri/review_count/status/next_review_at`口径符合约定。
  - 题库链路：真实列表、筛选搜索、卡片跳转详情、空态与缩略图失败兜底已覆盖。
  - 详情链路：真实 id 读取、图片槽位展示、复做记录展示、状态按钮文案与禁用策略已覆盖。
  - 复做链路：复做页拍照必填、提交流程仅走 `CompleteReviewService`、防重复点击与失败保留照片已覆盖。
  - 一致性链路：`CompleteReviewService` 统一事务写入 `review_records + mistake_images + mistakes`，并覆盖 7/7 与防重提规则。
  - 刷新链路：详情/题库/首页均采用 focus 刷新策略保持跨页一致。
- 验收结果：
  - `npm run typecheck` 通过。
  - `npm run lint` 通过。
- 遗留风险：
  - Android 真机完整回归仍需按清单执行（相机权限、重启持久化、7/7连续操作）。
- 下一步：
  - 进入最终回归执行阶段（真机全链路跑通并记录阻断问题）。
### 2026-05-08 - 第9步阶段9-C：补关键日志与错误提示

- 任务目标：增强 Android 人工测试可观测性，在不新增业务功能前提下补齐关键服务日志与页面错误定位能力。
- 修改文件：
  - `src/services/CreateMistakeService.ts`
  - `src/services/CompleteReviewService.ts`
  - `src/services/ImageService.ts`
  - `src/services/ImageStorageService.ts`
  - `src/services/MistakeListService.ts`
  - `src/services/MistakeDetailService.ts`
  - `app/(tabs)/library.tsx`
  - `docs/MANUAL_TEST_CHECKLIST.md`
  - `docs/dev_log.md`
- 核心变化：
  - 录入链路补日志：开始保存、draftId/mistakeId、图片存在性、mistakes 写入成功、mistake_images 数量、保存成功/失败。
  - 复做链路补日志：开始提交、current/expected reviewIndex、newReviewCount/newStatus/nextReviewAt、事务内每步成功、事务成功/失败、孤儿图片清理尝试与结果。
  - 图片链路补日志：开始拍照、用户取消、拍照成功、开始复制、保存成功/失败、删除成功/失败。
  - 新增短 URI 输出策略，日志中仅打印短版本 URI，避免超长路径噪声。
  - 题库页补充加载失败 Logger.error，页面错误文案保持可见。
  - 新增 `docs/MANUAL_TEST_CHECKLIST.md`，补充 Expo 终端、adb logcat、截图与步骤记录建议。
- 验收结果：
  - 待执行：`npm run typecheck` / `npm run lint`。
- 遗留问题：
  - 可观测性增强为本地日志，不包含任何远程上报能力。
- 下一步：
  - 进入 9-D：基于真机回归日志做最小缺陷修复与最终收口。


### 2026-05-08 - 第9步阶段9-B：增强现有 /dev/db 调试页

- 任务目标：在不新增业务功能前提下，增强 `/dev/db` 对复做数据一致性的现场检查能力，辅助 Android 真机人工回归。
- 修改文件：
  - `app/dev/db.tsx`
  - `docs/MANUAL_TEST_CHECKLIST.md`
  - `docs/dev_log.md`
- 核心变化：
  - 保留原有按钮能力：初始化数据库、健康检查、查询统计、插入示例错题、查询最近错题、清空开发数据。
  - 最近 10 条错题展示字段扩展：`id/title/module/error_reason/difficulty/review_count/status/next_review_at/question_image_uri/answer_image_uri/created_at/updated_at`，并显示 question/answer URI 是否有值、文件是否存在。
  - 每条错题新增三个调试入口：
    - 打开详情页（`/mistake/[id]`）
    - 打开复做页（`/review/[id]`）
    - 检查该错题一致性
  - 新增“单题一致性检查”模块：
    - mistakes 当前状态（`id/review_count/status/next_review_at`）
    - review_records 列表（`review_index/solution_image_uri/result/created_at`）
    - mistake_images 列表（`type/uri/created_at`）
    - 图片文件存在性（`exists/size`）
  - 新增一致性规则结果（通过/失败/警告上屏显示）：
    - `review_count` 与 `review_records` 数量一致
    - `review_index` 连续性
    - `mastered` 状态规则
    - `active` 状态规则
    - `review_records` 与 `mistake_images(type=review_solution)` 的映射完整性
    - 数据库图片 URI 的本地文件存在性警告
  - 更新人工测试清单，补充如何使用 `/dev/db` 做一致性检查与日志留证。
- 验收结果：
  - 待执行：`npm run typecheck` / `npm run lint`。
- 遗留问题：
  - `/dev/db` 仅用于开发调试，仍不能替代 Android 真实拍照/权限/生命周期场景的人工回归。
- 下一步：
  - 进入 9-D：基于 `/dev/db` 与真机日志完成最小缺陷修复并收口发布前检查。

### 2026-05-09 - 设置页阶段10-A：Tab 入口与基础页面

- 任务目标：新增“设置”Tab 与设置页基础内容，不接数据库、不接调试入口、不改现有业务逻辑。
- 修改文件：
  - `app/(tabs)/settings.tsx`
  - `app/(tabs)/_layout.tsx`
  - `docs/dev_log.md`
- 核心变化：
  - 新增 `app/(tabs)/settings.tsx`，复用 `ScreenContainer`、`BrandHeader`、`SectionTitle`、`CardContainer` 组成基础页面。
  - 页面主标题为“设置”，副标题为“离线运行，本地保存错题和复做记录”。
  - 页面包含两个占位区域：
    - App 信息（应用名称/版本号/构建信息占位）
    - 本地数据说明（离线与本地保存说明，占位文案）
  - 在 `app/(tabs)/_layout.tsx` 增加 `settings` Tab，标题“设置”，图标复用现有 `MaterialIcons` 的 `settings`，原有“今日/新增/题库”保持不变。
- 验收结果：
  - `npm run typecheck` 通过。
- 遗留问题：
  - 当前为基础占位页，尚未接入真实版本信息、本地存储容量/路径等展示能力（符合 S-A 范围）。
- 下一步：
  - 进入 S-B：在设置页补充“关于应用/本地数据说明”的可读化内容与基础交互文案（仍保持离线、无数据库写操作）。

### 2026-05-09 - 设置页阶段10-B：静态设置中心 UI

- 任务目标：将设置页从基础占位升级为清晰可读的静态设置中心，只做 UI，不接调试入口与数据读写。
- 修改文件：
  - `app/(tabs)/settings.tsx`
  - `docs/dev_log.md`
- 核心变化：
  - 顶部品牌区保持“设置 / 离线运行，本地保存错题和复做记录”，并显示绿色离线标签文案 `• 离线`。
  - App 信息卡片完善为静态展示：
    - 应用名：七刷错题本
    - 版本：0.1.0 MVP
    - 模式：离线本地版
    - 数据位置：本机存储
    - 当前状态：开发测试中
  - 新增“核心流程”卡片，展示 4 条流程说明（拍照录入、7 次复做、已掌握标记、本机保存）。
  - 新增“本地数据”卡片，展示 SQLite/本地目录/不支持云同步/卸载风险说明。
  - 新增“后续计划”卡片，展示数据备份恢复、本地通知、学习统计、OCR/AI 识别方向。
  - 统一沿用现有 `ScreenContainer + BrandHeader + SectionTitle + CardContainer` 与 token 样式体系，保持白底、圆角、轻阴影、可滚动布局。
- 验收结果：
  - `npm run typecheck` 通过。
  - `npx eslint "app/(tabs)/settings.tsx" --no-cache` 通过。
- 遗留问题：
  - 所有信息均为静态文案，未接入真实版本号、数据路径探测、备份能力与通知能力（符合 S-B 范围）。
- 下一步：
  - 进入 S-C：基于“版本号区域点击 7 次”做开发入口解锁机制（默认隐藏，且仍不影响正式用户路径）。

### 2026-05-09 - 设置页阶段10-C：隐藏开发模式机制（7 次点击解锁）

- 任务目标：在设置页实现会话级“连续点击版本号 7 次解锁开发调试入口”，不接任何调试路由、不读写数据库。
- 修改文件：
  - `app/(tabs)/settings.tsx`
  - `docs/dev_log.md`
- 核心变化：
  - 新增本地状态：
    - `devTapCount`
    - `isDevModeUnlocked`
    - `devHintMessage`
  - 版本行改为可点击区域（`Pressable`）：
    - 点击目标为整行“版本：0.1.0 MVP”
    - 设置 `minHeight` 与 `hitSlop`，提升 Android 真机点击可用性
  - 解锁规则实现：
    - 连续点击 7 次后解锁，显示提示“已开启开发调试入口”
    - 默认隐藏“开发调试”区域，解锁后显示占位卡片
  - 过程提示实现（Android 风格）：
    - 从第 3 次点击开始显示剩余次数提示
    - 文案示例：`再点 N 次开启开发调试入口`
  - 点击时间窗口：
    - 使用 `lastTapAtRef` 记录上次点击时间
    - 两次点击间隔超过 3 秒（3000ms）时重置计数
  - 仅开发环境可解锁：
    - 使用 `__DEV__` 守卫
    - 非 `__DEV__` 构建不允许解锁
  - 本阶段仍未接入：
    - `/dev/db`
    - `/dev/images`
    - 任何 `router.push` 调试跳转
- 验收结果：
  - `npm run typecheck` 通过。
  - `npx eslint "app/(tabs)/settings.tsx" --no-cache` 通过。
- 遗留问题：
  - 当前为会话级解锁，App 重启后会重新隐藏（符合 S-C 范围）。
- 下一步：
  - 进入 S-D：在已解锁的“开发调试”区域内接入具体调试入口按钮（数据库调试、图片调试）与安全提示文案。

### 2026-05-09 - 设置页阶段10-D：开发调试入口接入

- 任务目标：仅在设置页解锁后显示开发调试入口，并接入数据库调试与图片调试跳转，不改任何 dev 页面业务逻辑。
- 修改文件：
  - `app/(tabs)/settings.tsx`
  - `docs/dev_log.md`
- 核心变化：
  - 解锁区域显示条件收紧为：`__DEV__ && isDevModeUnlocked`。
  - 版本号点击行为调整：
    - 非 `__DEV__` 下不响应点击，不显示解锁提示。
    - `__DEV__` 下继续保留 7 次点击解锁与 3 秒超时重置规则。
  - 解锁后“开发调试”区域新增正式入口：
    - 区域说明：`仅开发阶段使用，正式发布前会隐藏。`
    - `数据库调试` 按钮：`router.push('/dev/db')`
    - `图片调试` 按钮：`router.push('/dev/images')`
    - 每个入口均补充用途说明文案，按钮采用边框浅色样式，便于区分正式功能。
  - 未解锁时不显示任何开发调试区域，不显示 `/dev/db`、`/dev/images` 字样。
  - 不修改底部 Tab，不把 dev 页面放入 Tab。
- 验收结果：
  - `npm run typecheck` 通过。
  - `npx eslint "app/(tabs)/settings.tsx" --no-cache` 通过。
- 遗留问题：
  - 解锁状态仍为会话级，App 重启后需重新点击 7 次解锁（符合当前阶段约束）。
- 下一步：
  - 进入 S-E：补开发入口守卫与发布前防误开检查（例如 release 构建二次确认不显示任何 dev 入口）。

### 2026-05-09 - 设置页阶段10-E：本地数据概况卡片

- 任务目标：在设置页新增正式可见“数据概况”卡片，展示本机错题与复做相关数量；不影响开发入口隐藏机制。
- 修改文件：
  - `app/(tabs)/settings.tsx`
  - `src/repositories/ReviewRecordRepository.ts`
  - `src/repositories/MistakeImageRepository.ts`
  - `docs/dev_log.md`
- 核心变化：
  - 设置页新增“数据概况”卡片，显示 5 个真实统计字段：
    - 总错题数
    - 待复做数
    - 已七刷数
    - 复做记录数
    - 图片记录数
  - 统计数据来源：
    - `MistakeListService.getMistakeListStats()` -> 总错题/待复做/已七刷
    - `ReviewRecordRepository.countReviewRecords()` -> 复做记录总数
    - `MistakeImageRepository.countMistakeImages()` -> 图片记录总数
  - 新增加载与刷新状态：
    - 初次加载与手动刷新时显示 `正在读取本地数据...`
    - 增加 `刷新数据概况` 按钮，点击后重新读取
  - 新增错误态：
    - 读取失败显示 `本地数据概况读取失败`
    - 提供 `重试` 按钮重新读取
  - 空数据兜底：
    - 失败或无数据时展示全 0，避免页面崩溃
  - 保持开发入口机制不变：
    - `__DEV__ && isDevModeUnlocked` 才显示开发调试区域
    - 未解锁不显示 `/dev/db` 与 `/dev/images`
- 验收结果：
  - `npm run typecheck` 通过。
  - `npx eslint "app/(tabs)/settings.tsx" "src/repositories/ReviewRecordRepository.ts" "src/repositories/MistakeImageRepository.ts" --no-cache` 通过。
- 遗留问题：
  - 当前统计读取策略为“进入设置页读取一次 + 手动刷新”，未做 focus 自动刷新（符合本阶段约束）。
- 下一步：
  - 进入 S-F：补设置页数据概况的交互与文案收口（含更新时间提示、空态提示优化与 Android 真机回归清单）。

### 2026-05-09 - 设置页阶段10-E补充：解除 __DEV__ 解锁限制

- 任务目标：允许发布构建也可通过“版本号连续点击 7 次”解锁开发调试入口，不再限制 `__DEV__`。
- 修改文件：
  - `app/(tabs)/settings.tsx`
  - `docs/dev_log.md`
- 核心变化：
  - 移除 `canUseDevUnlock = __DEV__` 及相关分支判断。
  - 版本号行始终可点击，连续 7 次后可解锁开发调试入口（会话级）。
  - 解锁提示文案与区域显示不再依赖 `__DEV__`。
  - 调整调试区提示文案为中性说明：默认隐藏、用于排查问题、谨慎使用。
- 验收结果：
  - `npm run typecheck` 通过。
  - `npx eslint "app/(tabs)/settings.tsx" --no-cache` 通过。
- 遗留问题：
  - 当前仍为会话级解锁，App 重启后需要重新点击 7 次。
- 下一步：
  - 进入 S-F：完善设置页文案与发布前检查清单（确保隐藏入口仍默认不可见）。

### 2026-05-13 - 第9步文档补齐：新增页批量拍照与离开拦截说明

- 任务目标：补齐 docs 中“新增页批量拍照/队列保存”与“离开新增页确认（含切换 Tab）”的架构、数据契约与验收清单说明，保持文档与当前实现一致。
- 修改文件：
  - `docs/data_contract.md`
  - `docs/architecture.md`
  - `docs/testing.md`
  - `docs/dev_log.md`
- 核心变化：
  - `data_contract` 新增批量拍照运行时队列约束、批量落库规则、部分成功重试约束，明确“不改 schema”。
  - `architecture` 新增新增页批量保存链路与离开拦截链路（`beforeRemove + Tabs tabPress + LeaveGuardService`）。
  - `testing` 新增专项验收清单，覆盖 20 张上限、部分失败重试、返回与切 Tab 的离开确认、离开后回页不丢未保存照片。
- 验收结果：
  - 文档变更已写入目标文件。
  - 未涉及数据库字段变更与业务代码执行。
- 遗留问题：
  - 当前文档仍存在历史阶段残留的个别旧文案（不影响本次新增条目）。
- 下一步：
  - 在 Android 真机按 `docs/testing.md` 第 17 节执行一轮手工回归，并把结果补记到 `docs/dev_log.md`。

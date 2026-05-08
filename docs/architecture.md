# 七刷错题本 - 架构说明（MVP 阶段）

## 1. 技术栈
- React Native
- Expo
- TypeScript
- Expo Router
- expo-sqlite（后续使用）
- expo-image-picker（后续使用）
- expo-file-system（后续使用）

## 2. 推荐目录结构说明

### app/
用于 Expo Router 页面，不放复杂业务逻辑。

### src/components/
放可复用 UI 组件，例如 `StatCard`、`MistakeCard`、`PhotoPickerBox`。

### src/constants/
放常量，例如 `MAX_REVIEW_COUNT`、`REVIEW_INTERVAL_DAYS`、`REVIEW_STATUS`。

### src/db/
放数据库初始化和 schema SQL。

### src/repositories/
放数据访问层，例如 `MistakeRepository`。页面层不能直接写 SQL。

### src/services/
放业务服务，例如 `ImageService`、`ReviewService`、`Logger`。

### src/models/
放 TypeScript 类型定义，例如 `Mistake`、`ReviewRecord`。

### src/utils/
放通用工具函数。

### docs/
放产品说明、架构说明、数据结构、验收清单、Prompt。

## 3. 分层边界

### 页面层
只负责展示、用户交互、调用 service/repository。

### Service 层
负责业务逻辑，例如拍照保存、复习时间计算、日志。

### Repository 层
负责 SQLite 增删改查。

### DB 层
负责数据库初始化、建表 SQL、迁移脚本。

## 4. 禁止事项
- 页面层不要直接写 SQL
- 页面层不要直接操作文件系统
- 不要把图片二进制存进 SQLite
- 不要把所有逻辑写进一个页面文件
- 不要引入复杂状态管理库
- 不要一次性做大重构

## 5. 后续扩展方向
- SQLite 数据库
- 图片持久化
- 录入错题
- 错题列表
- 错题详情
- 7 次重做流程
- 本地通知
- 数据导出备份

## 6. ͼƬ����ֲ㣨��4�����䣩

- `ImagePathService`��������ͼƬĿ¼�����ļ�������ID ���ɣ�������������ļ�ϵͳ��
- `ImagePickerService`��������Ȩ���������ա����ѡ�񣬷�����ʱͼƬ��Ϣ�������־û���
- `ImageStorageService`�������𱾵�Ŀ¼�������ļ�����/��ѯ/ɾ����������ҳ���ҵ��
- `ImageOptimizeService`����ѡ���������𱣴�ǰ��������ѹ����׼������д�����ݿ⡣
- `ImageService`��ҳ�������ڣ����� Picker + Optimize + Storage��

ҳ���Լ����
- ��ʽҳ�治ֱ�ӵ��� `expo-image-picker`��
- ҳ�治ֱ�ӵ��� `expo-file-system`��
- ������ʽҳ��ͳһ���� `ImageService`��

## 7. 第5步录入错题数据流（阶段 5-B ~ 5-G）

目标：把“新增页草稿”稳定落库到 `mistakes` 与 `mistake_images`，并保持图片目录与数据库主键一致。

数据流：
1. 新增页初始化调用 `createEmptyAddMistakeDraft()`，提前生成 `draftId`。
2. 用户拍照/选图时，页面仅调用 `ImageService.takePhotoAndSave / pickImageAndSave`，并传入 `mistakeId = draftId`。
3. 图片文件持久化到本地目录（按 `mistakeId` 分目录），页面仅保存返回的 `LocalImage`（含 `uri`）。
4. 用户点击保存时，页面先调用 `validateAddMistakeDraft(draft)` 做表单校验。
5. 校验通过后，页面调用 `CreateMistakeService.createMistakeFromDraft(draft)`。
6. `CreateMistakeService` 复用 `draftId` 作为 `mistakes.id`，写入主表，再按图片类型写入 `mistake_images`。
7. 若运行时支持事务（`withTransactionAsync`），保存流程在事务中执行；否则执行最小回滚策略并记录日志。
8. 保存成功后页面重置为新草稿（新 `draftId`）；保存失败时保留原草稿供用户重试。

分层约束（第5步继续生效）：
- 页面层不直接写 SQL，不直接操作 FileSystem。
- 图片入口统一走 `ImageService`。
- 保存业务编排集中在 `CreateMistakeService`。
- 数据持久化细节集中在 Repository 层。

## 8. 第6步错题列表数据流（6-B ~ 6-G）
目标：将题库页与首页部分模块切换到 SQLite 真实数据，同时保持页面层不直接写 SQL。

数据流分层：
1. 页面层（`app/(tabs)/library.tsx`、`app/(tabs)/index.tsx`）只维护 UI 状态（loading/error/empty、筛选、搜索词、刷新）。
2. Service 层（`src/services/MistakeListService.ts`）负责把页面过滤条件映射为 Repository 查询参数，并将 `Mistake` 映射为展示模型 `MistakeListItem`。
3. Repository 层（`src/repositories/MistakeRepository.ts`）负责 SQL 查询与参数绑定（keyword/status/dueOnly/sort/limit/offset）。
4. DB 层（`src/db/*`）负责数据库初始化与 schema。

题库页（Library）查询链路：
- segment: `all | due | mastered` + keyword -> `MistakeListService.getMistakeListItems(filter)`
- service 根据 segment 映射查询：
  - all -> `status: all`, `updated_at desc`
  - due -> `dueOnly: true`, `next_review_at asc`
  - mastered -> `status: mastered`, `updated_at desc`
- repository 返回 `Mistake[]`，service 映射成 `MistakeListItem[]` 给页面渲染。

首页（Today）轻量真实化链路：
- 统计：`MistakeListService.getMistakeListStats()` -> `total/due/mastered`
- 优先复做：`getMistakeListItems({ segment: 'due', keyword: '' })` 取第1条
- 错题队列：`getMistakeListItems({ segment: 'all', keyword: '' })` 取前 2-3 条
- 页面 focus 时刷新，确保新增页保存后返回首页可看到最新结果。

约束：
- 页面层不拼接 SQL，不直接访问 SQLite。
- 查询条件中的用户输入均由 Repository 参数绑定。
- 展示模型与数据库表解耦，避免页面直接依赖数据库字段。

## 9. 第8步复做提交流程（8-B）

- `CompleteReviewService.completeReview` 是复做提交唯一入口。
- 页面层不能直接更新 `mistakes.review_count`，也不能绕过服务层直接写 `review_records`。
- `review_count`、`review_records`、`mistake_images(type=review_solution)` 必须在同一事务中写入。
- 事务更新 `mistakes` 时必须使用条件保护（`id + oldReviewCount + status=active`），防止重复提交。

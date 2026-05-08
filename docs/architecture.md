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

# AGENTS.md

## 1. 项目背景
- 项目名称（暂定）：七刷错题本。
- 项目定位：离线高中数学错题记录 App。
- 开发方式：Windows + VSCode + Codex 驱动开发，开发者本人不直接手写代码。
- 技术栈：React Native + Expo + TypeScript + Expo Router。
- 运行重点：Android 真机/模拟器优先，不依赖 Expo Go。

## 2. MVP 目标
- 第一版只实现本地离线错题复习闭环：
  1. 录入错题
  2. 拍题目照片
  3. 拍答案照片
  4. 保存到本地
  5. 错题列表
  6. 错题详情
  7. 重做 7 次并标记已掌握

## 3. 第一版明确不做
- 不做登录
- 不做云同步
- 不做 OCR
- 不做 AI 批改
- 不做支付
- 不做会员
- 不做社区
- 不做复杂统计图
- 不做服务器接口
- 不做 iOS 本地调试

## 4. 目录约定
- `app/`：Expo Router 页面
- `src/components/`：可复用组件
- `src/services/`：业务服务
- `src/db/`：数据库初始化和 schema
- `src/repositories/`：数据访问层
- `src/models/`：TypeScript 数据模型
- `src/constants/`：常量
- `docs/`：产品、架构、数据结构、测试文档

说明：若目录当前尚未创建，后续按本约定逐步补齐。

## 5. 分层规则
- 页面层不要直接写 SQL。
- 页面层不要直接操作文件系统。
- SQL 集中放在 `src/db/`。
- 数据访问放在 `src/repositories/`。
- 图片保存逻辑放在 `src/services/ImageService.ts`。
- 7 次复习逻辑放在 `src/services/ReviewService.ts`。

## 6. 开发规则
- 每次只做一个小任务。
- 不要一次性实现多个大功能。
- 不要随意重构无关代码。
- 不要引入大型状态管理库。
- 不要删除 `docs/` 下的说明文件。
- 修改数据库字段前必须先更新 `docs/data_contract.md`。
- 每次修改后必须说明修改了哪些文件。
- 每次修改后必须给出验收步骤。

## 7. 常用命令
以下命令来自当前 `package.json` 的已有 scripts：

- 安装依赖：`npm install`
- 启动开发服务：`npm run start`
- 启动 Android：`npm run android`
- 启动 iOS：`npm run ios`
- 启动 Web：`npm run web`
- 启动 Dev Client：`npm run dev-client`
- 检查 Expo 依赖匹配：`npm run check:deps`
- TypeScript 类型检查：`npm run typecheck`
- 运行 Lint：`npm run lint`
- 重置模板项目：`npm run reset-project`

当前缺少常见脚本（如测试、格式化等）：建议后续补充。

## 8. 每次完成任务后的输出格式
Codex 每次完成任务后，输出必须包含：

1. 修改文件列表
2. 每个文件的作用
3. 如何运行
4. 如何验收
5. 是否有风险
6. 下一步建议

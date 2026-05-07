# Prompt 06 - Review Flow

## 任务目标
- 实现错题 7 次重做流程与状态流转。
- 维护 `review_count`、`review_records`、`next_review_at` 和 `status` 的一致性。

## 明确不做
- 不做复杂学习曲线可视化和高级统计图。
- 不做 AI 评估与自动批改。
- 不做大规模架构迁移与无关重构。

## 需要修改的文件类型
- 复习流程页面：`app/**/*.tsx`
- 复习服务与仓储：`src/services/ReviewService*.ts`、`src/repositories/**/*.ts`
- 数据模型与常量：`src/models/**/*.ts`、`src/constants/**/*.ts`
- 对应文档：`docs/testing.md`、`docs/data_contract.md`

## 验收标准
- 新错题默认显示 `0/7`。
- 每完成一次重做，进度从 `n/7` 变为 `(n+1)/7`。
- 每次重做都生成一条 `review_record`。
- 当 `review_count >= 7` 时，状态自动变为 `mastered`。
- `mastered` 错题不再出现在今日待复习。

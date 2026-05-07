# Prompt 03 - Database

## 任务目标
- 建立 SQLite 基础能力：数据库初始化、建表、最小迁移策略。
- 按 `data_contract.md` 落地 `mistakes`、`mistake_images`、`review_records` 三张表。

## 明确不做
- 不实现页面完整业务流程。
- 不存储图片二进制到数据库。
- 不实现云同步或远程接口。

## 需要修改的文件类型
- 数据库层文件：`src/db/**/*.ts`、`src/db/**/*.sql`
- 数据访问层文件：`src/repositories/**/*.ts`
- 数据模型文件：`src/models/**/*.ts`
- 对应文档：`docs/data_contract.md`、`docs/architecture.md`

## 验收标准
- App 启动时可完成数据库初始化。
- 三张核心表可创建且字段与文档一致。
- 可完成最小的新增与查询验证。
- 重启 App 后数据仍可查询到。

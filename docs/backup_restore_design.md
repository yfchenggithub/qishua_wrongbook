# 七刷错题本离线备份与恢复设计（阶段一）

## 1. 目标与范围
- 当前阶段只做：设计文档、基础类型、目录结构、依赖检查。
- 当前阶段不做：真实备份、真实恢复、数据库写入/清空、业务流程改造。
- 必须保持：App 继续完全离线可用，不引入云服务，不要求登录，不破坏 7 刷逻辑与现有功能。

## 2. 备份包命名格式
- 备份文件名：`qishua-backup-YYYYMMDD-HHmmss.qsbk`
- 示例：`qishua-backup-20260517-213045.qsbk`

## 3. 备份包内部结构
```
qishua-backup-YYYYMMDD-HHmmss.qsbk
├─ manifest.json
├─ data.json
└─ images/
   ├─ IMG17159486230001.jpg
   ├─ IMG17159486230002.jpg
   └─ ...
```

说明：
- 采用逻辑备份，不以 SQLite 物理数据库文件作为唯一备份方案。
- `images/` 存放备份包内图片文件，`data.json` 只保存结构化数据和图片映射关系。

## 4. manifest.json 结构

### 4.1 示例
```json
{
  "format": "qishua-backup",
  "formatVersion": 1,
  "appName": "七刷错题本",
  "appVersion": "0.1.0",
  "createdAt": "2026-05-17T21:30:45.123+08:00",
  "schemaVersion": 2,
  "devicePlatform": "android",
  "counts": {
    "mistakes": 128,
    "mistakeImages": 342,
    "reviewRecords": 209,
    "imageFiles": 342
  },
  "warnings": []
}
```

### 4.2 字段说明
- `format`: 固定值 `qishua-backup`，用于识别包类型。
- `formatVersion`: 备份格式版本号（初版为 `1`）。
- `appName`: App 名称。
- `appVersion`: 生成该备份时的 App 版本。
- `createdAt`: 备份创建时间（ISO 8601，包含本地时区偏移）。
- `schemaVersion`: 数据 schema 版本（对应当前 DB 版本）。
- `devicePlatform`: 备份来源平台（android/ios/web/unknown）。
- `counts`: 数据量摘要。
- `warnings`: 备份过程中产生的警告信息数组（可空）。

## 5. data.json 结构

### 5.1 顶层结构
```json
{
  "mistakes": [],
  "mistakeImages": [],
  "reviewRecords": [],
  "extra": {}
}
```

### 5.2 mistakes（按当前 schema 字段）
每条记录字段：
- `id`
- `subject`
- `module`
- `title`
- `error_reason`
- `difficulty`
- `note`
- `review_count`
- `status`
- `created_at`
- `updated_at`
- `next_review_at`
- `last_review_at`
- `last_review_result`

### 5.3 mistakeImages（按当前 schema + 备份映射字段）
每条记录字段：
- `id`
- `mistake_id`
- `review_record_id`
- `type`
- `sort_order`
- `created_at`
- `sourceUri`（仅用于追踪来源，不作为恢复依据）
- `backupRelativePath`（如 `images/IMG17159486230001.jpg`，恢复以此为准）

说明：
- 当前数据库字段 `mistake_images.uri` 在逻辑备份中映射为 `sourceUri + backupRelativePath`。
- 恢复时以 `backupRelativePath` 找包内文件，并生成新设备可访问的 `uri` 回写数据库。

### 5.4 reviewRecords（按当前 schema 字段）
每条记录字段：
- `id`
- `mistake_id`
- `review_index`
- `result`
- `note`
- `created_at`

### 5.5 extra
- 预留扩展字段，当前可为空对象 `{}`。

## 6. 图片处理规则
- 备份时不能把旧设备绝对 `uri` 作为恢复依据。
- 备份时图片记录必须映射到 `backupRelativePath`。
- 恢复时必须将图片复制到当前设备 App 本地图片目录。
- 恢复后数据库中的 `uri` 必须是当前设备可访问的新 `uri`。
- 不恢复旧字段：`question_image_uri`、`answer_image_uri`、`solution_image_uri`。
- 图片数据以 `mistake_images` 表为准。

## 7. 恢复安全策略
- 先检查备份文件结构与内容（扩展名、manifest、data、images 完整性）。
- 先展示恢复预览（记录数、图片数、告警信息、版本兼容性）。
- 用户二次确认后再恢复。
- 恢复前自动生成“当前数据安全备份”。
- 恢复采用全量覆盖，不做合并。
- 恢复失败必须尽量回滚到恢复前状态。
- 失败时必须保留恢复前安全备份，便于用户回退。

## 8. 当前 schema 字段映射（以 src/db/schema.ts 为准）

### 8.1 mistakes
| 数据库表字段 | data.json 字段 | 说明 |
| --- | --- | --- |
| `mistakes.id` | `mistakes[].id` | 直接映射 |
| `mistakes.subject` | `mistakes[].subject` | 直接映射 |
| `mistakes.module` | `mistakes[].module` | 直接映射 |
| `mistakes.title` | `mistakes[].title` | 直接映射 |
| `mistakes.error_reason` | `mistakes[].error_reason` | 直接映射 |
| `mistakes.difficulty` | `mistakes[].difficulty` | 直接映射 |
| `mistakes.note` | `mistakes[].note` | 直接映射 |
| `mistakes.review_count` | `mistakes[].review_count` | 直接映射 |
| `mistakes.status` | `mistakes[].status` | 直接映射 |
| `mistakes.created_at` | `mistakes[].created_at` | 直接映射 |
| `mistakes.updated_at` | `mistakes[].updated_at` | 直接映射 |
| `mistakes.next_review_at` | `mistakes[].next_review_at` | 直接映射 |
| `mistakes.last_review_at` | `mistakes[].last_review_at` | 直接映射 |
| `mistakes.last_review_result` | `mistakes[].last_review_result` | 直接映射 |

### 8.2 mistake_images
| 数据库表字段 | data.json 字段 | 说明 |
| --- | --- | --- |
| `mistake_images.id` | `mistakeImages[].id` | 直接映射 |
| `mistake_images.mistake_id` | `mistakeImages[].mistake_id` | 直接映射 |
| `mistake_images.review_record_id` | `mistakeImages[].review_record_id` | 直接映射 |
| `mistake_images.type` | `mistakeImages[].type` | 直接映射 |
| `mistake_images.sort_order` | `mistakeImages[].sort_order` | 直接映射 |
| `mistake_images.created_at` | `mistakeImages[].created_at` | 直接映射 |
| `mistake_images.uri` | `mistakeImages[].sourceUri` | 仅追踪来源，不用于恢复 |
| `mistake_images.uri` | `mistakeImages[].backupRelativePath` | 通过复制图片文件生成包内相对路径 |

### 8.3 review_records
| 数据库表字段 | data.json 字段 | 说明 |
| --- | --- | --- |
| `review_records.id` | `reviewRecords[].id` | 直接映射 |
| `review_records.mistake_id` | `reviewRecords[].mistake_id` | 直接映射 |
| `review_records.review_index` | `reviewRecords[].review_index` | 直接映射 |
| `review_records.result` | `reviewRecords[].result` | 直接映射 |
| `review_records.note` | `reviewRecords[].note` | 直接映射 |
| `review_records.created_at` | `reviewRecords[].created_at` | 直接映射 |

## 9. 分阶段落地建议
- 阶段一（本次）：文档 + 类型 + 骨架 + 依赖检查。
- 阶段二：实现“创建逻辑备份包 + 分享导出”。
- 阶段三：实现“选择备份包 + 预检预览 + 全量恢复 + 失败回滚”。

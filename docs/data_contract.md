# 七刷错题本 - 数据约定（V1）

本文档定义第一版离线数据结构与约束。
说明：SQLite 仅保存结构化元数据、图片 `uri` 和轻量 JSON 元数据，不保存图片二进制。

## 一、mistakes 表

| 字段名 | 类型 | 约束/默认值 | 说明 |
| --- | --- | --- | --- |
| id | string | 主键，必填 | 错题 ID |
| subject | string | 默认 `math` | 科目 |
| module | string | 必填 | 模块：`函数/数列/导数/圆锥曲线/立体几何/概率统计/其他`，也可保存用户自定义模块 |
| title | string | 可空 | 错题标题 |
| error_reason | string | 可空 | 错因：`粗心/不会/思路卡住/计算错误/概念不清/其他`，也可保存自定义文本 |
| difficulty | number | 默认 `3`，范围 `1-5` | 难度 |
| note | string | 可空 | 备注原文 |
| note_highlights | string | 可空 | 备注高亮区间 JSON，元素为 `{ start, end, color }`，`color` 枚举：`yellow/red/green` |
| review_count | number | 默认 `0`，范围 `0-7` | 当前已重做次数 |
| status | string | 必填，枚举：`collected/active/mastered/archived` | 错题状态：`collected` 表示已记录但未加入七刷，`active` 表示七刷中 |
| created_at | string | 必填 | 创建时间（ISO 8601 字符串） |
| updated_at | string | 必填 | 更新时间（ISO 8601 字符串） |
| next_review_at | string | 可空 | 下次复习时间（ISO 8601 字符串） |
| last_review_at | string | 可空 | 最近复习时间（ISO 8601 字符串） |
| last_review_result | string | 可空，枚举：`mastered/unsure/wrong` | 最近一次复做结果 |
| is_pinned | boolean | 默认 `false` | 是否在题库中置顶显示 |
| last_viewed_at | string | 可空 | 最近进入详情页查看时间（ISO 8601 字符串） |

## 二、mistake_images 表

| 字段名 | 类型 | 约束/默认值 | 说明 |
| --- | --- | --- | --- |
| id | string | 主键，必填 | 图片记录 ID |
| mistake_id | string | 必填，外键关联 `mistakes.id` | 所属错题 ID |
| review_record_id | string | 可空，外键关联 `review_records.id` | 复做照片所属复做记录 ID |
| type | string | 必填，枚举：`question/my_solution/answer/review_solution` | 图片类型 |
| uri | string | 必填 | 本地图片 uri |
| sort_order | number | 默认 `0`，范围 `>= 0` | 同类型图片排序 |
| created_at | string | 必填 | 创建时间（ISO 8601 字符串） |

## 三、review_records 表

| 字段名 | 类型 | 约束/默认值 | 说明 |
| --- | --- | --- | --- |
| id | string | 主键，必填 | 复习记录 ID |
| mistake_id | string | 必填，外键关联 `mistakes.id` | 所属错题 ID |
| review_index | number | 必填，范围 `1-7` | 第几次重做 |
| result | string | 必填，枚举：`mastered/unsure/wrong` | 本次结果 |
| note | string | 可空 | 本次文字讲解原文 |
| note_highlights | string | 可空 | 本次文字讲解高亮区间 JSON，元素为 `{ start, end, color }`，`color` 枚举：`yellow/red/green` |
| voice_note | string | 可空 | 本次语音讲解 JSON 元数据 |
| created_at | string | 必填 | 创建时间（ISO 8601 字符串） |

## 四、review_sheets 表

| 字段名 | 类型 | 约束/默认值 | 说明 |
| --- | --- | --- | --- |
| id | string | 主键，必填 | 今日复习卷 ID |
| created_at | string | 必填 | 创建时间（ISO 8601 字符串） |
| submitted_at | string | 可空 | 提交时间（ISO 8601 字符串） |
| is_submitted | number | 默认 `0`，枚举：`0/1` | 是否已提交 |

## 五、review_sheet_items 表

| 字段名 | 类型 | 约束/默认值 | 说明 |
| --- | --- | --- | --- |
| id | string | 主键，必填 | 复习卷条目 ID |
| sheet_id | string | 必填，外键关联 `review_sheets.id` | 所属复习卷 ID |
| mistake_id | string | 必填，外键关联 `mistakes.id` | 对应错题 ID |
| sort_order | number | 必填，范围 `>= 0` | 复习卷内排序 |
| created_at | string | 必填 | 创建时间（ISO 8601 字符串） |

## 六、module_question_counters 表

| 字段名 | 类型 | 约束/默认值 | 说明 |
| --- | --- | --- | --- |
| module | string | 主键，必填 | 模块名 |
| last_question_no | number | 必填，范围 `>= 0` | 该模块已分配的最大题号 |
| updated_at | string | 必填 | 最近更新时间（ISO 8601 字符串） |

## 七、custom_modules 表

| 字段名 | 类型 | 约束/默认值 | 说明 |
| --- | --- | --- | --- |
| id | string | 主键，必填 | 自定义模块 ID |
| name | string | 必填，唯一 | 自定义模块名称 |
| icon | string | 默认 `label` | 模块图标名 |
| color | string | 默认 `#2EBB61` | 模块颜色 |
| sort_order | number | 默认 `0` | 排序值 |
| created_at | string | 必填 | 创建时间（ISO 8601 字符串） |
| updated_at | string | 必填 | 更新时间（ISO 8601 字符串） |

## 八、custom_error_reasons 表

| 字段名 | 类型 | 约束/默认值 | 说明 |
| --- | --- | --- | --- |
| id | string | 主键，必填 | 自定义错因 ID |
| name | string | 必填，唯一 | 自定义错因名称 |
| icon | string | 默认 `error-outline` | 错因图标名 |
| color | string | 默认 `#F59E0B` | 错因颜色 |
| sort_order | number | 默认 `0` | 排序值 |
| created_at | string | 必填 | 创建时间（ISO 8601 字符串） |
| updated_at | string | 必填 | 更新时间（ISO 8601 字符串） |

## 九、mistake_relations 表

| 字段名 | 类型 | 约束/默认值 | 说明 |
| --- | --- | --- | --- |
| id | string | 主键，必填 | 相关错题关系 ID |
| source_mistake_id | string | 必填，外键关联 `mistakes.id` | 发起关联的错题 ID |
| target_mistake_id | string | 必填，外键关联 `mistakes.id` | 被关联的错题 ID |
| source | string | 必填，枚举：`system/manual` | 关系来源：系统建议加入/用户手动添加 |
| created_at | string | 必填 | 创建时间（ISO 8601 字符串） |

- `source_mistake_id` 与 `target_mistake_id` 不能相同。
- 业务层必须阻止同一对错题重复关联；A-B 与 B-A 视为同一组关系。
- 详情页按双向关系展示：只要当前错题出现在 `source_mistake_id` 或 `target_mistake_id`，另一端即为相关错题。
- 删除任一错题时，必须同步删除对应关系。

## 十、mistake_tags 表

| 字段名 | 类型 | 约束/默认值 | 说明 |
| --- | --- | --- | --- |
| id | string | 主键，必填 | 标签记录 ID |
| mistake_id | string | 必填，外键关联 `mistakes.id` | 所属错题 ID |
| name | string | 必填 | 标签展示名，如 `回文串`、`双指针`、`删除一个字符` |
| normalized_name | string | 必填 | 标签归一化名，用于去重和推荐匹配 |
| sort_order | number | 默认 `0`，范围 `>= 0` | 当前错题内标签展示顺序 |
| created_at | string | 必填 | 创建时间（ISO 8601 字符串） |
| updated_at | string | 必填 | 更新时间（ISO 8601 字符串） |

- 同一道错题内 `normalized_name` 必须唯一。
- 标签用于细化系统推荐相关错题；推荐逻辑应优先匹配共享标签，再回退到模块、错因、难度。
- 删除错题时，必须同步删除对应标签。
- 标签由用户手工维护，业务层应限制空标签、过长标签和同题重复标签。

## 十一、图片存储原则

- SQLite 只保存图片 `uri`，不保存图片二进制。
- 图片文件由 `ImageService` 编排并持久化到 App 本地目录。
- 建议目录：`qishua_wrongbook/mistakes/{mistakeId}/`。
- 删除错题时应同步清理对应本地图片目录。

## 十二、文本高亮原则

- `note_highlights` 只保存选中文本的区间和颜色，不修改 `note` 原文。
- 区间采用前闭后开：`start` 包含，`end` 不包含，基于当前 `note` 字符串索引。
- 保存时业务层必须裁剪越界区间，丢弃空区间和非法颜色。
- 当用户对重叠区间重新标色时，新颜色覆盖旧颜色。
- 当 `note` 为空时，对应 `note_highlights` 必须为空。

## 十三、7 次复习规则

- `MAX_REVIEW_COUNT = 7`。
- `REVIEW_INTERVAL_DAYS = [0, 1, 3, 7, 14, 30, 60]`。
- 新增页直接保存的错题默认 `status = collected`，`review_count = 0`，`next_review_at = null`，不进入今日复做。
- 用户明确选择“加入七刷”后，错题从 `collected` 变为 `active`，`next_review_at` 设置为加入时间。
- 当 `review_count >= 7` 时，`status = mastered`。
- 当 `status = mastered` 时，`next_review_at = null`。
- 当 `status = collected`、`status = mastered` 或 `status = archived` 时，业务层必须拒绝继续复做。

## 十四、数据兼容原则

- 第一版字段不要频繁改名。
- 修改数据库字段前先更新 `docs/data_contract.md`。
- 页面层不要绕过 Repository 直接访问数据库。
- 展示层模型如 `MistakeListItem`、`MistakeDetailViewModel` 不等同于数据库表。

## 十五、新增页批量拍照规则

- 题目图片允许在新增页进入队列模式，`photoQueue` 仅存在于页面运行时状态，不落库。
- 队列上限为 `20` 张；超限时必须阻止继续添加并提示用户先保存当前队列。
- 批量保存时，队列中的每一张题目图都独立落一条 `mistakes` 记录，并写入对应 `mistake_images(type=question)` 记录。
- 当队列数量为 `1` 时：沿用当前草稿 `draftId`，允许同时携带 `mySolutionImage`、`answerImage` 和 `note`。
- 当队列数量大于 `1` 时：每条记录生成新的 `mistakeId`；`mySolutionImage`、`answerImage`、`note` 不复制到批量子项，避免一张做法图/答案图误绑定多题。
- 批量保存不新增数据库表；仍使用 `mistakes`、`mistake_images` 现有契约。

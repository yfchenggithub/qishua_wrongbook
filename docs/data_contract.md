# 七刷错题本 - 数据约定（V1）

本文档定义第一版离线数据结构与约束。
说明：SQLite 仅保存结构化元数据、图片 `uri` 和轻量 JSON 元数据，不保存图片二进制。

## 一、mistakes 表

| 字段名 | 类型 | 约束/默认值 | 说明 |
| --- | --- | --- | --- |
| id | string | 主键，必填 | 错题 ID |
| subject | string | 默认 `math` | 科目 |
| module | string | 必填，兼容字段 | 模块名称快照，用于兼容旧数据和旧备份；后续关联与查询以 `module_id` 为准 |
| module_id | number | 必填，外键关联 `modules.id` | 模块永久数字 ID；模块改名、排序或停用时保持不变 |
| question_no | number | 必填，范围 `1-999`，与 `module_id` 联合唯一 | 当前模块内的永久顺序号；展示层据此生成 `A001` 或 `U016-001` |
| title | string | 可空 | 错题标题 |
| error_reason | string | 可空 | 错因：`粗心/不会/思路卡住/计算错误/概念不清/其他`，也可保存自定义文本 |
| error_reason_ids | string | 可空 | 多选错因稳定 ID 的 JSON 字符串数组；旧数据可仅有 `error_reason` |
| difficulty | number | 默认 `3`，范围 `1-5` | 难度 |
| note | string | 可空 | 备注原文 |
| my_solution_text | string | 可空 | “我的做法”文字说明 |
| answer_text | string | 可空 | “答案／解析”文字说明 |
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
| module_id | number | 主键，必填，外键关联 `modules.id` | 模块永久数字 ID |
| last_question_no | number | 必填，范围 `0-999` | 该模块已分配的最大题号；只递增，不回收 |
| updated_at | string | 必填 | 最近更新时间（ISO 8601 字符串） |

## 七、modules 表

| 字段名 | 类型 | 约束/默认值 | 说明 |
| --- | --- | --- | --- |
| id | number | 主键，必填 | 模块永久数字 ID；系统与未分类使用固定 ID，自定义模块使用 `>= 1001` 的单调递增 ID |
| type | string | 必填，枚举：`system/custom/unclassified` | 系统模块、自定义模块或未分类模块 |
| name | string | 必填，唯一 | 当前模块名称；改名只更新本表，不改变永久 ID |
| display_code | string | 必填，唯一 | 仅用于兼容和展示；系统模块为 `A-J`，自定义模块为 `U001-U999`，未分类为 `Z` |
| custom_no | number | 自定义模块必填，范围 `1-999`，唯一；其他类型为空 | 自定义模块永久序号，例如 `16` 对应 `U016` |
| icon | string | 默认 `label` | 模块图标名 |
| color | string | 默认使用统一品牌色 token（当前 `#34C759`） | 模块颜色 |
| sort_order | number | 默认 `0` | 排序值 |
| is_active | number | 默认 `1`，枚举：`0/1` | 模块是否可继续选择；停用不删除永久 ID 和展示代码 |
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
- 新增页仅题目照片为必填项；未选择模块时由业务层关联固定的“未分类”模块记录并写入其永久 `module_id`，其余补充信息可在保存前填写或在详情页后续补充。
- 用户明确选择单题或批量“加入七刷”后，仍处于 `collected` 的目标错题变为 `active`，`next_review_at` 统一设置为本次加入时间；批量操作不影响已是其他状态的错题。
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

## 十六、新增错题补充信息兼容规则

- `module` 与 `error_reason` 继续保存可直接展示和搜索的文本，避免旧页面、旧备份和旧数据失效；`module` 不再作为数据库关联键。
- `module_id` 是后续模块关联的唯一依据；`error_reason_ids` 用于新增流程中的稳定选择状态。读取旧数据时只允许在一次性迁移中根据名称回退匹配模块。
- `my_solution_text` 与 `answer_text` 均为可空字段；图片仍按 `mistake_images.type` 保存，并允许同类型多条记录按 `sort_order` 排序。
- 新增页中的所有补充信息只在最终提交时随错题事务写入；Sheet 内保存只更新页面草稿。

## 十七、错题编号与模块关联规则

### 17.1 永久模块 ID

- 所有系统模块、自定义模块和“未分类”都必须在 `modules` 表中拥有永久数字 `id`。
- `mistakes.module_id`、`module_question_counters.module_id` 以及后续所有模块关联只保存该数字 ID，不得使用模块名称或显示代码作为关联键。
- 系统模块固定使用 `module_id = 1-10`，顺序与 `A-J` 一致；“未分类”固定使用 `module_id = 11`。
- 自定义模块使用从 `1001` 开始的单调递增 `module_id`；该 ID 与 `U001` 等显示代码相互独立，禁止业务代码通过二者互相推算。
- 模块改名、调整顺序或停用时，永久 `module_id`、`display_code` 和已经分配的题号均不得改变。
- 自定义模块删除采用停用语义：设置 `is_active = 0`，不物理删除模块记录，不回收 `module_id` 或 `custom_no`。

### 17.2 模块显示代码

- 模块显示代码只负责兼容和展示，不参与数据库关联。
- 系统模块代码固定如下：
  - `A`：函数
  - `B`：数列
  - `C`：导数
  - `D`：圆锥曲线
  - `E`：立体几何
  - `F`：平面几何
  - `G`：三角函数
  - `H`：概率统计
  - `I`：不等式
  - `J`：其他
- “未分类”的显示代码固定为 `Z`。
- 自定义模块显示代码格式固定为 `U` 加三位永久序号，范围为 `U001-U999`。
- `U016` 表示第 16 个自定义模块。`U001-U015` 用于迁移或保留现有自定义模块；新增自定义模块的分配下限为 `U016`。
- 新增自定义模块时，下一个 `custom_no` 取 `max(15, 历史最大 custom_no) + 1`；停用模块留下的号码不得复用。

### 17.3 错题显示编号

- 每道错题在其当前模块内拥有独立的 `question_no`，从 `1` 开始，最大为 `999`。
- 系统模块和未分类错题的展示编号为 `{display_code}{question_no 三位补零}`，例如 `A001`、`B001`、`J001`、`Z001`。
- 自定义模块错题的展示编号为 `{display_code}-{question_no 三位补零}`，例如 `U001-001`、`U016-001`、`U999-999`。
- 展示编号由 `modules.display_code` 和 `mistakes.question_no` 生成，不作为外键，也不代替错题主键。
- `question_no` 与 `title` 相互独立；修改标题不得改变题号，页面不得从标题解析当前题号。

### 17.4 模块内序号分配

- 新增错题时，必须在同一个数据库事务内通过 `module_id` 领取下一个序号、更新 `module_question_counters` 并写入 `mistakes.question_no`。
- 批量新增同一模块的多道错题时，必须在同一个事务内预留连续号码。
- 已成功提交的号码只递增、不回收；删除错题或将错题迁移到其他模块时，不得把旧号码重新分配给其他错题。整个创建事务回滚时，该号码视为从未分配。
- 当模块的 `last_question_no` 已达到 `999` 时，必须拒绝继续在该模块新增错题或迁入错题，并回滚当前事务；第一版不扩展为四位数字。

### 17.5 修改模块

- 修改错题模块时，必须在一个数据库事务中为目标 `module_id` 领取新 `question_no`，并同时更新模块名称兼容快照、`module_id` 与 `question_no`。
- 原题号立即停用且永不复用。例如 `A003` 改到数列模块后可得到 `B005`，后续函数题从 `A004` 继续。
- 如果目标模块无法分配题号，模块和题号都不得发生部分更新。

### 17.6 历史数据与备份兼容

- 数据库升级时，必须先建立系统模块和未分类模块的固定记录，再把旧 `module`/字符串 `module_id` 映射到新的永久数字 `module_id`。
- 现有自定义模块按 `sort_order ASC, created_at ASC, id ASC` 稳定分配 `U001` 起的 `custom_no`；不足 15 个时保留 `U001-U015` 中未使用的号码，后续新增仍从不低于 `U016` 开始。
- 旧错题必须补齐 `question_no`；迁移应优先保留旧规范标题中可解析且未冲突的模块内题号，其余错题按 `created_at ASC, id ASC` 从该模块当前最大题号之后依次分配。
- 历史标题和旧字母编号只作为一次性迁移参考；迁移完成后，业务逻辑不得再依赖标题、模块名称或旧显示编号进行关联。
- 迁移后 `module_question_counters.last_question_no` 必须至少等于该模块已存在题号和旧计数器中的最大值。
- 新版备份必须保存完整 `modules`、`mistakes.module_id`、`mistakes.question_no` 以及模块计数器，确保恢复后模块关联稳定且旧号码不会复用。
- 恢复旧版备份时，必须按与数据库升级相同的规则生成永久模块 ID 和模块内题号；不得静默生成重复关联或重复题号。

## 十八、module_imports 表

`module_imports` 记录已经成功导入的 `.qsm` 题包及其本机模块映射，用于重复导入检测和来源追踪。只有题包的全部图片与业务数据都成功落盘后，才允许在同一数据库事务中写入本表。

| 字段名 | 类型 | 约束/默认值 | 说明 |
| --- | --- | --- | --- |
| id | string | 主键，必填 | 本机导入记录 ID，不使用题包 `packageId` 代替 |
| package_id | string | 必填，唯一 | `.qsm` manifest 中的不可变题包 ID；同一题包在本机只允许导入一次 |
| content_version | number | 必填，范围 `>= 1` | 题包内容版本；V1 固定为 `1` |
| module_id | number | 必填，唯一，外键关联 `modules.id` | 导入后新建的本机自定义模块 ID |
| source_module_name | string | 必填 | 包内原始模块名称；本机模块改名后仍保留 |
| description | string | 可空 | 包内模块简介 |
| creator_name | string | 可空 | 作者展示昵称，不代表经过身份认证 |
| package_created_at | string | 必填 | 题包创建时间（ISO 8601，包含时区） |
| imported_at | string | 必填 | 本机成功导入时间（ISO 8601） |

- `package_id` 是 V1 重复导入检测的唯一依据；不得通过模块名称、文件名或本机模块 ID 判断重复。
- 导入题包时必须创建新的 `modules(type=custom)` 记录；不得把来源记录关联到系统模块或未分类模块。
- 模块采用停用语义时，`module_imports` 继续保留，以免停用后绕过重复导入检测。
- 物理删除模块时，数据库通过外键级联删除对应导入来源记录。
- `creator_name` 只用于展示；业务逻辑不得把它当作用户账号、可信身份或权限依据。

## 十九、module_import_items 表

`module_import_items` 保存题包内部题目键到本机错题 ID 的映射，为来源展示、问题定位以及未来可能的版本更新保留稳定关系。

| 字段名 | 类型 | 约束/默认值 | 说明 |
| --- | --- | --- | --- |
| import_id | string | 必填，联合主键，外键关联 `module_imports.id` | 所属本机导入记录 ID |
| item_id | string | 必填，联合主键 | `.qsm` 包内稳定题目键，如 `Q001` |
| mistake_id | string | 必填，唯一，外键关联 `mistakes.id` | 导入后生成的本机错题 ID |
| position | number | 必填，范围 `1-999`，与 `import_id` 联合唯一 | 题目在原题包中的连续顺序 |

- 联合主键为 `(import_id, item_id)`。
- 同一次导入中的 `position` 必须从 `1` 开始连续且不可重复；数据库保证唯一性，连续性由导入 Service 在事务前校验。
- 同一个本机错题最多对应一条题包来源映射。
- 删除 `module_imports` 时级联删除其全部 item 映射。
- 删除错题时级联删除对应 item 映射，但不删除 `module_imports`，确保题包仍被视为已经导入。
- `item_id`、题包原题号和本机 `mistakes.question_no` 相互独立；导入后题号仍按本机模块计数器分配。

## 二十、题包来源数据兼容原则

- 数据库 schemaVersion 11 起新增 `module_imports` 与 `module_import_items`。
- 从 schemaVersion 10 及更早版本升级时，两表初始化为空，不推测历史错题是否来自题包。
- schemaVersion 11 及以上的完整备份必须保存并恢复两张来源表；恢复时先写入 `modules` 和 `mistakes`，再写入来源记录及 item 映射。
- 恢复 schemaVersion 10 及更早备份时，两张来源表保持为空。
- 题包导入失败或事务回滚时，两张来源表不得留下任何记录。
- 页面层不得直接查询或写入两张表；重复检测和来源读取统一通过 Repository/Service 完成。

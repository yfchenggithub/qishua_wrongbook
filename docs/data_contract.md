# 七刷错题本 - 数据约定（V1）

本文档定义第一版离线数据结构与约束。  
说明：SQLite 仅保存结构化元数据与图片 `uri`，不保存图片二进制。

## 一、mistakes 表

| 字段名 | 类型 | 约束/默认值 | 说明 |
| --- | --- | --- | --- |
| id | string | 主键，必填 | 错题 ID |
| subject | string | 默认 `math` | 科目 |
| module | string | 必填 | 模块：`函数/数列/导数/圆锥曲线/立体几何/概率统计/其他` |
| title | string | 可空 | 错题标题 |
| error_reason | string | 可空 | 错因：`粗心/不会/思路卡住/计算错误/概念不清/其他` |
| difficulty | number | 默认 `3`，范围 `1-5` | 难度 |
| question_image_uri | string | 可空 | 题目照片本地 uri |
| answer_image_uri | string | 可空 | 答案照片本地 uri |
| note | string | 可空 | 备注 |
| review_count | number | 默认 `0`，范围 `0-7` | 当前已重做次数 |
| status | string | 必填，枚举：`active/mastered/archived` | 错题状态 |
| created_at | string | 必填 | 创建时间（ISO 8601 字符串） |
| updated_at | string | 必填 | 更新时间（ISO 8601 字符串） |
| next_review_at | string | 可空 | 下次复习时间（ISO 8601 字符串） |

## 二、mistake_images 表

| 字段名 | 类型 | 约束/默认值 | 说明 |
| --- | --- | --- | --- |
| id | string | 主键，必填 | 图片记录 ID |
| mistake_id | string | 必填，外键关联 `mistakes.id` | 所属错题 ID |
| type | string | 必填，枚举：`question/my_solution/answer/review_solution` | 图片类型 |
| uri | string | 必填 | 本地图片 uri |
| created_at | string | 必填 | 创建时间（ISO 8601 字符串） |

## 三、review_records 表

| 字段名 | 类型 | 约束/默认值 | 说明 |
| --- | --- | --- | --- |
| id | string | 主键，必填 | 复习记录 ID |
| mistake_id | string | 必填，外键关联 `mistakes.id` | 所属错题 ID |
| review_index | number | 必填，范围 `1-7` | 第几次重做 |
| solution_image_uri | string | 可空 | 本次做法图片 uri |
| result | string | 必填，枚举：`done/still_wrong/too_easy` | 本次结果 |
| created_at | string | 必填 | 创建时间（ISO 8601 字符串） |

## 1. 图片存储原则
- SQLite 只保存 `uri`。
- 图片文件放在 App 本地目录。
- 按 `mistake_id` 分目录保存图片。

## 2. 7 次复习规则
- `MAX_REVIEW_COUNT = 7`
- `REVIEW_INTERVAL_DAYS = [0, 1, 3, 7, 14, 30, 60]`
- 当 `review_count >= 7` 时，`status = mastered`。

## 3. 数据兼容原则
- 第一版字段不要频繁改名。
- 修改字段前先更新 `docs/data_contract.md`。
- 页面层不要绕过 Repository 直接访问数据库。

## 4. ͼƬ�ֶ���־û�Լ������4�����䣩

- SQLite ֻ����ͼƬ `uri`������ `question_image_uri`��`answer_image_uri`��`solution_image_uri`����
- ͼƬ�������ļ���д�� SQLite��
- ͼƬ�ļ��� `ImageService` ���Ų��־û��� App ����Ŀ¼��
- ����Ŀ¼��`qishua_wrongbook/mistakes/{mistakeId}/`��
- ɾ������ʱӦͬ��������Ӧ����ͼƬĿ¼������ҵ��׶ν��룩��

## 5. AddMistakeDraft 与落库映射（第5步补充）

### 5.1 Draft 结构（页面态）
- `AddMistakeDraft.draftId`：草稿主键，保存前即生成。
- `questionImage/mySolutionImage/answerImage`：本地图片对象，核心字段为 `uri`。

### 5.2 mistakes 表映射
| AddMistakeDraft 字段 | mistakes 字段 | 规则 |
| --- | --- | --- |
| `draftId` | `id` | 直接复用，保证图片目录与数据库主键一致 |
| `subject` | `subject` | 空值回退为 `math` |
| `module` | `module` | 必填 |
| `title` | `title` | 可空 |
| `errorReason` | `error_reason` | 可空 |
| `difficulty` | `difficulty` | 必须在 `1-5` |
| `questionImage.uri` | `question_image_uri` | 必填 |
| `answerImage?.uri` | `answer_image_uri` | 可空 |
| `note` | `note` | 可空 |
| （系统字段） | `review_count` | 默认 `0` |
| （系统字段） | `status` | 默认 `active` |
| （系统字段） | `next_review_at` | 保存时写入当前时间（ISO 字符串） |

### 5.3 mistake_images 表映射
| Draft 图片字段 | mistake_images.type | 是否必填 |
| --- | --- | --- |
| `questionImage` | `question` | 必填 |
| `mySolutionImage` | `my_solution` | 可选 |
| `answerImage` | `answer` | 可选 |

写入规则：
- `mistake_id = draftId`。
- `uri` 保存本地持久化路径。
- 每张存在的图片各写一条记录。

### 5.4 一致性约束
- SQLite 仅保存图片 `uri`，不保存图片二进制。
- 图片文件由 `ImageService` 落地到本地目录；数据库保存时不重复复制图片。
- 运行时支持事务时优先使用事务；无事务封装时采用最小补偿回滚并记日志。

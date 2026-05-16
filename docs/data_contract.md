# 七刷错题�?- 数据约定（V1�?
本文档定义第一版离线数据结构与约束�? 
说明：SQLite 仅保存结构化元数据与图片 `uri`，不保存图片二进制�?
## 一、mistakes �?
| 字段�?| 类型 | 约束/默认�?| 说明 |
| --- | --- | --- | --- |
| id | string | 主键，必�?| 错题 ID |
| subject | string | 默认 `math` | 科目 |
| module | string | 必填 | 模块：`函数/数列/导数/圆锥曲线/立体几何/概率统计/其他` |
| title | string | 可空 | 错题标题 |
| error_reason | string | 可空 | 错因：`粗心/不会/思路卡住/计算错误/概念不清/其他` |
| difficulty | number | 默认 `3`，范�?`1-5` | 难度 |
| legacy-question-image-uri(removed) | string | 可空 | 题目照片本地 uri |
| legacy-answer-image-uri(removed) | string | 可空 | 答案照片本地 uri |
| note | string | 可空 | 备注 |
| review_count | number | 默认 `0`，范�?`0-7` | 当前已重做次�?|
| status | string | 必填，枚举：`active/mastered/archived` | 错题状�?|
| created_at | string | 必填 | 创建时间（ISO 8601 字符串） |
| updated_at | string | 必填 | 更新时间（ISO 8601 字符串） |
| next_review_at | string | 可空 | 下次复习时间（ISO 8601 字符串） |

## 二、mistake_images �?
| 字段�?| 类型 | 约束/默认�?| 说明 |
| --- | --- | --- | --- |
| id | string | 主键，必�?| 图片记录 ID |
| mistake_id | string | 必填，外键关�?`mistakes.id` | 所属错�?ID |
| type | string | 必填，枚举：`question/my_solution/answer/review_solution` | 图片类型 |
| uri | string | 必填 | 本地图片 uri |
| created_at | string | 必填 | 创建时间（ISO 8601 字符串） |

## 三、review_records �?
| 字段�?| 类型 | 约束/默认�?| 说明 |
| --- | --- | --- | --- |
| id | string | 主键，必�?| 复习记录 ID |
| mistake_id | string | 必填，外键关�?`mistakes.id` | 所属错�?ID |
| review_index | number | 必填，范�?`1-7` | 第几次重�?|
| legacy-solution-image-uri(removed) | string | 可空 | 本次做法图片 uri |
| result | string | 必填，枚举：`mastered/unsure/wrong` | 本次结果 |
| created_at | string | 必填 | 创建时间（ISO 8601 字符串） |

## 1. 图片存储原则
- SQLite 只保�?`uri`�?- 图片文件放在 App 本地目录�?- �?`mistake_id` 分目录保存图片�?
## 2. 7 次复习规�?- `MAX_REVIEW_COUNT = 7`
- `REVIEW_INTERVAL_DAYS = [0, 1, 3, 7, 14, 30, 60]`
- �?`review_count >= 7` 时，`status = mastered`�?
## 3. 数据兼容原则
- 第一版字段不要频繁改名�?- 修改字段前先更新 `docs/data_contract.md`�?- 页面层不要绕�?Repository 直接访问数据库�?
## 4. ͼƬ�ֶ���־û�Լ������4�����䣩

- SQLite ֻ����ͼƬ `uri`������ `legacy-question-image-uri(removed)`��`legacy-answer-image-uri(removed)`��`legacy-solution-image-uri(removed)`����
- ͼƬ�������ļ���д�� SQLite��
- ͼƬ�ļ��� `ImageService` ���Ų��־û��� App ����Ŀ¼��
- ����Ŀ¼��`qishua_wrongbook/mistakes/{mistakeId}/`��
- ɾ������ʱӦͬ��������Ӧ����ͼƬĿ¼������ҵ��׶ν��룩��

## 5. AddMistakeDraft 与落库映射（�?步补充）

### 5.1 Draft 结构（页面态）
- `AddMistakeDraft.draftId`：草稿主键，保存前即生成�?- `questionImage/mySolutionImage/answerImage`：本地图片对象，核心字段�?`uri`�?
### 5.2 mistakes 表映�?| AddMistakeDraft 字段 | mistakes 字段 | 规则 |
| --- | --- | --- |
| `draftId` | `id` | 直接复用，保证图片目录与数据库主键一�?|
| `subject` | `subject` | 空值回退�?`math` |
| `module` | `module` | 必填 |
| `title` | `title` | 可空 |
| `errorReason` | `error_reason` | 可空 |
| `difficulty` | `difficulty` | 必须�?`1-5` |
| `questionImage.uri` | `legacy-question-image-uri(removed)` | 必填 |
| `answerImage?.uri` | `legacy-answer-image-uri(removed)` | 可空 |
| `note` | `note` | 可空 |
| （系统字段） | `review_count` | 默认 `0` |
| （系统字段） | `status` | 默认 `active` |
| （系统字段） | `next_review_at` | 保存时写入当前时间（ISO 字符串） |

### 5.3 mistake_images 表映�?| Draft 图片字段 | mistake_images.type | 是否必填 |
| --- | --- | --- |
| `questionImage` | `question` | 必填 |
| `mySolutionImage` | `my_solution` | 可�?|
| `answerImage` | `answer` | 可�?|

写入规则�?- `mistake_id = draftId`�?- `uri` 保存本地持久化路径�?- 每张存在的图片各写一条记录�?
### 5.4 一致性约�?- SQLite 仅保存图�?`uri`，不保存图片二进制�?- 图片文件�?`ImageService` 落地到本地目录；数据库保存时不重复复制图片�?- 运行时支持事务时优先使用事务；无事务封装时采用最小补偿回滚并记日志�?

## 6. 展示层模型说明（�?步补充）

- `MistakeListItem`（`src/models/MistakeListItem.ts`）是展示�?ViewModel，不是数据库表�?- `MistakeListItem` �?`MistakeListService.mapMistakeToListItem()` 从数据库实体 `Mistake` 映射得到�?- 页面应优先消�?`MistakeListItem`，不要在页面层直接依�?`mistakes` 表字段拼装展示文案�?- `MistakeListItem` 中如 `subtitle`、`statusLabel`、`displayStatus`、`maxReviewCount` 属于展示衍生字段，不落库�?- 数据库结构仍�?`mistakes` / `mistake_images` / `review_records` 为准，本补充不涉�?schema 变更�?

## 7. �?步复做数据契约补充（8-B�?
- `review_records.legacy-solution-image-uri(removed)` 在复做提交业务层为必填�?- 每次复做提交都应写入 `mistake_images` 一�?`type = review_solution` 的记录，用于追踪复做照片�?- �?`status = mastered` 时，业务层必须拒绝继续复做�?- �?`status = archived` 时，业务层必须拒绝继续复做�?- �?`review_count >= 7` 时，`status` 必须�?`mastered`�?- �?`status = mastered` 时，`next_review_at` 必须�?`null`�?
## 8. �?步数据契约补充（8-D�?

- `status = mastered` 时，`next_review_at` 必须�?`null`�?
- `review_records` 是错题复做历史，�?`review_index` 表示第几刷�?
- `mistake_images.type = review_solution` 对应每次复做拍摄的解题照片�?
- 复做详情展示可同时使用：
  - `review_records.legacy-solution-image-uri(removed)`（本次复做记录）
  - `mistake_images(type=review_solution)`（图片资产追踪）
## 9. �?步模型关系说明（8-E�?

- `AddMistakeDraft`：新增页临时草稿模型，保存前仅存在于页面态�?
- `CreateMistakeService`：把 `AddMistakeDraft` 映射到：
  - `mistakes`（主记录�?
  - `mistake_images`（question/my_solution/answer 图片记录�?
- `MistakeListService`：把 `mistakes` 映射�?`MistakeListItem` 供题库页/首页列表展示�?
- `MistakeDetailService`：聚�?`mistakes + mistake_images + review_records`，映射为 `MistakeDetailViewModel` 供详情页展示�?
- `ReviewFlowService`：基�?`MistakeDetailViewModel` 计算 `ReviewSession`，供复做页展示当前刷次与可复做状态�?
- `CompleteReviewService`：消�?`ReviewFlow.CompleteReviewInput`，统一提交一次复做并返回 `CompleteReviewResult`�?
- `review_records`：记录每次复做历史（第几刷、结果、时间、slegacy-solution-image-uri(removed)）�?
- `mistake_images(type=review_solution)`：记录每次复做照片的图片资产轨迹�?
- `mistakes`：保存当前进度状态（`review_count/status/next_review_at`），�?`status=mastered` �?`next_review_at=null`�?

## 10. �?步补充：新增页批量拍照与离开拦截契约�?-I�?
### 10.1 批量拍照队列（页面态）
- 题目图片允许在新增页进入队列模式，`photoQueue` 仅存在于页面运行时状态，不落库�?- 队列上限�?`20` 张；超限时必须阻止继续添加并提示用户先保存当前队列�?
### 10.2 批量保存落库规则
- 点击保存时，队列中的每一张题目图都独立落一�?`mistakes` 记录，并写入对应 `mistake_images(type=question)` 记录�?- 当队列数量为 `1` 时：沿用当前草稿 `draftId`，允许同时携�?`mySolutionImage`、`answerImage` �?`note`�?- 当队列数量大�?`1` 时：每条记录生成新的 `mistakeId`；`mySolutionImage`、`answerImage`、`note` 不复制到批量子项，避免“一张做法图/答案图”误绑定多题�?- 批量保存不新增数据库表，不修改既有字段；仍使�?`mistakes`、`mistake_images` 现有契约�?
### 10.3 部分成功与重试约�?- 若批量保存出现部分失败：已成功项保留落库结果；失败项应保留在队列中供用户重试�?- 失败重试时仍按“每张题目图 -> 一�?mistakes 记录”规则执行，且不得覆盖已成功写入的数据�?



## 11. ģ����ż�����2026-05-16 ���䣩

Ϊ��֤��ģ�� �� �� n �⡱�����������Ӧ�����������ϸ�����������־û���������

### 11.1 module_question_counters ��
| �ֶ��� | ���� | Լ��/Ĭ��ֵ | ˵�� |
| --- | --- | --- | --- |
| module | string | ���������� | ģ���� |
| last_question_no | number | ���>= 0 | ��ģ���ѷ���������� |
| updated_at | string | ���� | �������ʱ�䣨ISO 8601�� |

### 11.2 �������
- �½�����ʱ��ҵ����Ȱ�ģ��ԭ��Ԥ����һ��ţ���д�� mistakes.title��
- ����ͳһд�룺ģ�� �� �� n �⡣
- �״����ü���ʱ������ݸ�ģ����ʷ���ݽ���һ�ζ��루��ʷ��Ŀ����ɽ������ȡ�ϴ�ֵ����
- ��������ɿ��������ţ�������ҳ���ڴ�״̬��

# 七刷错题本 - 人工测试与日志采集指南

本文档用于 Android 真机/模拟器手工测试时的问题定位，重点记录“操作步骤 + 页面现象 + 日志片段”。

## 1. 测试前准备

- 启动项目：`npx expo start`
- 确认终端可见实时日志输出（包含 `Logger` 的 `INFO/WARN/ERROR`）。
- 在 Android 设备连接正常后，再执行真机操作。

## 2. 推荐日志采集方式

### 2.1 Expo CLI 终端日志

- 首选方式：直接查看运行 `npx expo start` 的终端输出。
- 每次复现问题后，复制对应时间段日志片段。

### 2.2 Android 系统日志（adb logcat）

- 当出现原生崩溃、白屏、相机异常退出时，使用：
  - `adb logcat`
- 建议结合时间点过滤并保存关键片段，避免只截取最后一行。

### 2.3 DevTools 辅助

- React Native DevTools / Expo 调试面板可用于补充 JS 报错栈信息。
- 若终端日志不足，优先补充错误堆栈和触发步骤。

## 3. 每个问题建议记录

- 设备信息：机型、Android 版本、App 启动方式（真机/模拟器）。
- 操作步骤：从哪个页面开始，点击了什么，是否授权相机/相册。
- 页面表现：错误提示文案、是否卡死、是否返回上页。
- 日志证据：
  - 终端日志片段（`Logger` 输出）
  - `adb logcat` 关键片段（如有）
  - 截图或录屏

## 4. 重点观察日志关键字

- 录入链路：`CreateMistakeService`
- 复做提交链路：`CompleteReviewService`
- 图片链路：`ImageService`、`ImageStorageService`
- 列表与详情读取：`MistakeListService`、`MistakeDetailService`

## 5. 结果回填建议

- 对照 `docs/testing.md` 勾选验收项。
- 对失败项记录：
  - 失败步骤编号
  - 页面错误提示
  - 日志片段
  - 是否可稳定复现

## 6. 使用 /dev/db 做数据库一致性检查（第9-B）

1. 进入 `/dev/db` 后，先点击“查询最近 10 条错题”。
2. 在某条错题上点击“打开详情页”确认详情路由可用，再返回 `/dev/db`。
3. 点击“打开复做页”确认复做路由可用（`mastered/archived` 也允许进入，由页面自行拦截）。
4. 点击“检查该错题一致性”，重点看“单题一致性检查”模块：
   - `review_count` 是否等于 `review_records` 数量
   - `review_index` 是否从 `1` 连续到 `review_count`
   - `mastered` 时是否 `review_count=7` 且 `next_review_at=null`
   - 每条 `review_record.solution_image_uri` 是否能在 `mistake_images(type=review_solution)` 找到
5. 查看“图片文件存在性”列表：
   - 来源包含 `mistakes`、`review_records`、`mistake_images`
   - 若 `exists=false`，表示数据库有 URI 但本地文件不存在，需要回归拍照保存流程。
6. 如果规则出现“失败/警告”文案，记录：
   - 错题 id
   - 操作步骤
   - 页面截图
   - 终端 Logger 片段（必要时补 `adb logcat`）

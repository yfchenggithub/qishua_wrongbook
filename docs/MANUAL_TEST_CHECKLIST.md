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

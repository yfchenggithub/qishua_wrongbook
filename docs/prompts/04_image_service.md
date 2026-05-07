# Prompt 04 - Image Service

## 任务目标
- 接入拍照/选图流程并封装图片服务。
- 将图片持久化到 App 本地目录，并返回稳定 `uri`。

## 明确不做
- 不做 OCR、AI 批改、云端上传。
- 不在页面层直接操作文件系统。
- 不把图片二进制写入 SQLite。

## 需要修改的文件类型
- 业务服务文件：`src/services/ImageService*.ts`
- 轻量页面接入文件：`app/**/*.tsx`
- 常量与工具文件：`src/constants/**/*.ts`、`src/utils/**/*.ts`
- 对应文档：`docs/testing.md`、`docs/architecture.md`

## 验收标准
- 点击拍照按钮可打开相机（或系统能力入口）。
- 用户取消拍照不会崩溃。
- 拍照后页面可显示图片。
- 重启 App 后图片仍可访问，且保存为持久化 `uri`。

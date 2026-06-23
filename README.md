# 七刷错题本

离线高中数学错题记录 App（React Native + Expo + TypeScript + Expo Router）。

## 当前状态

- 当前已发布首版：`v1.0.0`
- 发布范围：MVP 离线闭环
- 运行重点：Android 真机/模拟器优先，推荐使用 Dev Client，不依赖 Expo Go
- 版本记录：见 `CHANGELOG.md`

## 安装 APK / 内测包（非开发验收）

适用对象：产品、运营、测试同学，不需要本地 Node/Android 开发环境。

### 方式 A：安装 APK 文件（Android）

1. 向发布同学获取本版本 APK 文件（`v1.0.0`）。
   <img src="image.png" alt="APK 安装二维码" width="280" />
2. 在 Android 设备打开 APK 文件时，按系统提示允许“安装未知应用”。
3. 完成安装后，打开“七刷错题本”。
4. 进入应用后在“设置/关于”页确认版本号为 `1.0.0`。

### 方式 B：通过 EAS 内测包链接安装（Android）

1. 向发布同学获取 EAS build 链接或二维码（internal distribution）。
2. 在 Android 设备打开链接，下载并安装对应 APK。
3. 首次安装如被系统拦截，按提示允许当前来源安装应用。
4. 安装后打开 App，确认可正常进入首页并完成一次基础操作（如新增错题）。

### 验收入口建议

- 快速回归：`docs/MANUAL_TEST_CHECKLIST.md`
- 全量验收：`docs/testing.md`

## 首版（v1.0.0）能力

- 录入错题（题目、答案、标签等基础信息）
- 拍摄/选择题目图片
- 拍摄/选择答案图片
- 本地离线保存（SQLite + 本地文件）
- 错题列表浏览
- 错题详情查看
- 7 次重做进度与“已掌握”标记

## 首版明确不做

- 登录
- 云同步
- OCR
- AI 批改
- 支付/会员
- 社区
- 复杂统计图
- 服务端接口
- iOS 本地调试（首版开发重点非 iOS）

## 技术栈

- React Native
- Expo
- TypeScript
- Expo Router
- expo-sqlite

## 目录约定

- `app/`：Expo Router 页面
- `src/components/`：可复用组件
- `src/services/`：业务服务
- `src/db/`：数据库初始化和 schema
- `src/repositories/`：数据访问层
- `src/models/`：TypeScript 数据模型
- `src/constants/`：常量
- `docs/`：产品、架构、数据结构、测试文档

## 快速开始

1. 安装依赖

```bash
npm install
```

2. 启动开发服务

```bash
npm run start
```

3. 启动 Android（推荐）

```bash
npm run android
```

4. 启动 Dev Client（推荐）

```bash
npm run dev-client
```

## 常用命令

### 依赖安装

```powershell
npm install
```

### 开发运行

```powershell
npm run start       # 启动 Expo 开发服务
npm run android     # 构建并运行到 Android 真机/模拟器
npm run dev-client  # 启动 Dev Client 开发服务
```

### 代码检查

```powershell
npm run check:deps      # 检查 Expo 依赖匹配
npm run check:encoding  # 检查文件编码
npm run typecheck       # TypeScript 类型检查
npm run lint            # 代码规范检查
npm run preflight       # 编码/类型/lint 一键检查
```

### Android Release APK

从项目根目录执行：

```powershell
.\android\gradlew.bat -p android assembleRelease
```

生成位置：

```text
android/app/build/outputs/apk/release/app-release.apk
```

说明：当前 release 构建仍使用 `debug.keystore` 签名，适合本地安装测试；正式发布前需要替换为正式 release keystore。

## 相关文档

- 版本记录：`CHANGELOG.md`
- 产品文档：`docs/product.md`
- 架构说明：`docs/architecture.md`
- 数据约定：`docs/data_contract.md`
- 测试清单：`docs/testing.md`
- 手工回归清单：`docs/MANUAL_TEST_CHECKLIST.md`
- 开发日志：`docs/dev_log.md`

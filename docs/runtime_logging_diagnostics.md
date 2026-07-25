# 运行日志诊断信息

## 目标

运行日志在不记录用户内容和持久设备标识的前提下，补充问题发生时的设备资源与运行状态，方便判断低内存、存储不足、温控、节电或机型兼容问题。

## 采集时机

- App 启动：`RuntimeContext` 日志记录完整运行环境。
- `WARN` / `ERROR`：日志写入后异步补充 `metadata.runtimeDiagnostics` 快照。
- 导出日志：导出文件头重新采集一次当前状态。
- `INFO` / `DEBUG`：不逐条采集，避免重复数据和额外开销。

## 字段范围

- 硬件：真机/模拟器、品牌、厂商、型号、Android API、CPU 核数与架构、board/hardware/product/device、可用时的 SoC 信息。
- 内存：设备总量、可用量、低内存状态与阈值；App PSS、Java heap、Native heap；Android 内存档位。
- 存储：App 所在数据分区的总量与可用量。
- 电池与电源：电量、充放电、供电类型、健康、温度、电压、节电模式。
- 运行状态：采集时间、App 前后台、进程重要性、会话/设备/进程运行时长、最近内存回收级别、交互和温控状态。

## 安全与降级

- 不采集姓名、手机号、位置、网络详情、媒体内容、账号数据、序列号、Android ID、广告 ID 或其他持久设备标识。
- Android 原生模块不可用时，日志仍保留采集时间、App 前后台和会话时长，并将 `nativeDiagnosticsAvailable` 记为 `false`。
- 诊断采集失败不会阻断原业务，也不会递归写入新的告警日志。

## 手工验收

1. 重新构建并安装 Android Dev Client，启动 App。
2. 打开“设置 > 运行日志”，找到 `RuntimeContext`，展开 metadata。
3. 确认 `diagnostics.hardware`、`memory`、`storage`、`battery`、`runtime` 存在，且 `nativeDiagnosticsAvailable` 为 `true`。
4. 触发一条 `WARN` 或 `ERROR` 后刷新日志，确认该条 metadata 中出现 `runtimeDiagnostics`。
5. 导出日志，确认文件头包含设备内存、App 内存、CPU、硬件、本机存储、电池、运行状态、电源与温控。
6. 使用未包含最新原生模块的旧构建验证降级：日志仍正常生成，且 `nativeDiagnosticsAvailable` 为 `false`。

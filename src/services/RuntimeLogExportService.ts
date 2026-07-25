import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { shareFile as shareFileWithNativeModule } from '@/src/services/AndroidFileShareService';
import type { RuntimeLogItem } from '@/src/services/Logger';
import {
  getRuntimeLogContext,
  getRuntimeLogContextWithDiagnostics,
  type RuntimeLogContext,
} from '@/src/services/RuntimeContextService';

const EXPORT_CACHE_DIRECTORY = 'runtime-log-exports';
const EXPORT_FILE_PREFIX = 'qishua-runtime-logs';
const TEXT_MIME_TYPE = 'text/plain';
const TEXT_UTI = 'public.plain-text';
const LOG_SEPARATOR = '--------------------------------------------------';

export interface RuntimeLogExportFilters {
  levelLabel: string;
  keyword: string;
  rangeLabel: string;
  timeOrderLabel: string;
}

export interface RuntimeLogExportInput {
  logs: readonly RuntimeLogItem[];
  totalLogCount: number;
  filters: RuntimeLogExportFilters;
}

export interface RuntimeLogExportResult {
  fileName: string;
  fileUri: string;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function pad3(value: number): string {
  return String(value).padStart(3, '0');
}

export function formatRuntimeLogTimestamp(timestamp: string): string {
  const normalized = timestamp.trim();
  if (!normalized) {
    return '';
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return normalized;
  }

  return [
    `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`,
    `${pad2(parsed.getHours())}:${pad2(parsed.getMinutes())}:${pad2(parsed.getSeconds())}.${pad3(parsed.getMilliseconds())}`,
  ].join(' ');
}

function formatExportTimestamp(date: Date): string {
  return [
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`,
  ].join(' ');
}

function formatFileTimestamp(date: Date): string {
  return [
    `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`,
    `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`,
  ].join('-');
}

function safeString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return '[无法序列化]';
  }
}

function formatBytes(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return '未知';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  let displayedValue = value;
  while (displayedValue >= 1024 && unitIndex < units.length - 1) {
    displayedValue /= 1024;
    unitIndex += 1;
  }
  const fractionDigits = displayedValue >= 100 || unitIndex === 0 ? 0 : 1;
  return `${displayedValue.toFixed(fractionDigits)} ${units[unitIndex]}`;
}

function formatPercent(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value.toFixed(1)}%`
    : '未知';
}

function formatDuration(milliseconds: number | undefined): string {
  if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds) || milliseconds < 0) {
    return '未知';
  }

  const totalSeconds = Math.floor(milliseconds / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [
    ...(days > 0 ? [`${days}天`] : []),
    ...(hours > 0 ? [`${hours}小时`] : []),
    ...(minutes > 0 ? [`${minutes}分`] : []),
    `${seconds}秒`,
  ].join('');
}

function formatBoolean(value: boolean | undefined): string {
  if (value === true) {
    return '是';
  }
  if (value === false) {
    return '否';
  }
  return '未知';
}

export function formatRuntimeLogMetadata(metadata: unknown, pretty = true): string {
  if (metadata === undefined) {
    return '';
  }

  if (typeof metadata === 'string') {
    return metadata;
  }

  if (metadata instanceof Error) {
    const errorPayload: Record<string, unknown> = {
      name: metadata.name,
      message: metadata.message,
    };
    if (metadata.stack) {
      errorPayload.stack = metadata.stack;
    }
    return JSON.stringify(errorPayload, null, pretty ? 2 : 0);
  }

  try {
    const seen = new WeakSet<object>();
    const serialized = JSON.stringify(
      metadata,
      (_key, value: unknown) => {
        if (typeof value === 'bigint') {
          return value.toString();
        }

        if (value instanceof Error) {
          const errorPayload: Record<string, unknown> = {
            name: value.name,
            message: value.message,
          };
          if (value.stack) {
            errorPayload.stack = value.stack;
          }
          return errorPayload;
        }

        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) {
            return '[Circular]';
          }
          seen.add(value);
        }

        return value;
      },
      pretty ? 2 : 0,
    );

    return typeof serialized === 'string' ? serialized : safeString(metadata);
  } catch {
    return safeString(metadata);
  }
}

export function formatRuntimeLogEntry(log: RuntimeLogItem): string {
  const timestamp = formatRuntimeLogTimestamp(log.timestamp) || log.timestamp || 'unknown-time';
  const level = log.level.toUpperCase();
  const scope = log.scope?.trim() || 'unknown';
  const metadata = formatRuntimeLogMetadata(log.metadata, true);
  const lines = [
    `[${timestamp}] [${level}] [${scope}]`,
    log.message,
  ];

  if (metadata) {
    lines.push(`metadata: ${metadata}`);
  }

  return lines.join('\n');
}

export function buildRuntimeLogsTxt(
  input: RuntimeLogExportInput,
  exportedAt: Date = new Date(),
  context: RuntimeLogContext = getRuntimeLogContext(),
): string {
  const header = [
    `导出时间：${formatExportTimestamp(exportedAt)}`,
    `原始日志：${input.totalLogCount} 条`,
    `导出日志：${input.logs.length} 条`,
    `级别：${input.filters.levelLabel}`,
    `关键词：${input.filters.keyword || '无'}`,
    `显示范围：${input.filters.rangeLabel}`,
    `时间顺序：${input.filters.timeOrderLabel}`,
  ];

  if (context.app.version) {
    header.push(`App 版本号：${context.app.version}`);
  }
  if (context.app.buildVersion) {
    header.push(`build 版本：${context.app.buildVersion}`);
  }
  header.push(`操作系统：${context.system.name} ${context.system.version}`);
  if (context.system.brand) {
    header.push(`手机品牌：${context.system.brand}`);
  }
  if (context.system.model) {
    header.push(`手机型号：${context.system.model}`);
  }
  header.push(`运行环境：${context.app.executionEnvironment} / ${context.app.buildMode}`);
  if (context.session.id) {
    header.push(`会话 ID：${context.session.id}`);
  }
  header.push(`会话开始：${formatRuntimeLogTimestamp(context.session.startedAt)}`);
  if (context.system.locale) {
    header.push(`语言地区：${context.system.locale}`);
  }
  if (context.system.timeZone) {
    header.push(`时区：${context.system.timeZone}`);
  }
  header.push(`界面模式：${context.system.colorScheme}`);
  header.push(
    `屏幕环境：${context.display.width}×${context.display.height} @${context.display.scale}，字体缩放 ${context.display.fontScale}`,
  );
  const diagnostics = context.diagnostics;
  if (diagnostics) {
    const hardware = diagnostics.hardware;
    const memory = diagnostics.memory;
    const storage = diagnostics.storage;
    const battery = diagnostics.battery;
    const runtime = diagnostics.runtime;

    header.push(`诊断采集时间：${formatRuntimeLogTimestamp(runtime.capturedAt)}`);
    header.push(`原生诊断可用：${formatBoolean(runtime.nativeDiagnosticsAvailable)}`);
    if (hardware) {
      header.push(
        `设备类型：${hardware.deviceKind === 'physical' ? '真机' : hardware.deviceKind === 'emulator' ? '模拟器' : '未知'}`,
      );
      header.push(
        `CPU：${hardware.cpuCoreCount ?? '未知'} 核 / ${hardware.cpuArchitectures?.join(', ') || '未知'}`,
      );
      header.push(
        `硬件：brand=${hardware.brand ?? '未知'}，manufacturer=${hardware.manufacturer ?? '未知'}，model=${hardware.model ?? '未知'}，board=${hardware.board ?? '未知'}，hardware=${hardware.hardware ?? '未知'}，product=${hardware.product ?? '未知'}，device=${hardware.device ?? '未知'}`,
      );
      if (hardware.socManufacturer || hardware.socModel) {
        header.push(
          `SoC：${[hardware.socManufacturer, hardware.socModel].filter(Boolean).join(' ')}`,
        );
      }
    }
    if (memory) {
      header.push(
        `设备内存：总量 ${formatBytes(memory.deviceTotalBytes)}，可用 ${formatBytes(memory.deviceAvailableBytes)}（${formatPercent(memory.deviceAvailablePercent)}），低内存 ${formatBoolean(memory.lowMemory)}`,
      );
      header.push(
        `App 内存：PSS ${formatBytes(memory.appTotalPssBytes)}，Java heap ${formatBytes(memory.appJavaHeapUsedBytes)} / ${formatBytes(memory.appJavaHeapMaxBytes)}，Native heap ${formatBytes(memory.appNativeHeapAllocatedBytes)}`,
      );
      header.push(
        `Android 内存档位：${memory.memoryClassMb ?? '未知'} MB / large ${memory.largeMemoryClassMb ?? '未知'} MB，低内存设备 ${formatBoolean(memory.lowRamDevice)}`,
      );
    }
    if (storage) {
      header.push(
        `本机存储：总量 ${formatBytes(storage.totalBytes)}，可用 ${formatBytes(storage.availableBytes)}（${formatPercent(storage.availablePercent)}）`,
      );
    }
    if (battery) {
      header.push(
        `电池：${formatPercent(battery.levelPercent)}，${battery.state ?? 'unknown'}，供电 ${battery.powerSource ?? 'unknown'}，温度 ${battery.temperatureCelsius ?? '未知'}°C，健康 ${battery.health ?? 'unknown'}`,
      );
    }
    header.push(
      `运行状态：App ${runtime.appState}，进程 ${runtime.processImportance ?? 'unknown'}，会话 ${formatDuration(runtime.sessionUptimeMs)}，设备已运行 ${formatDuration(runtime.deviceUptimeMs)}`,
    );
    header.push(
      `电源与温控：节电模式 ${formatBoolean(runtime.powerSaveMode)}，设备交互中 ${formatBoolean(runtime.interactive)}，温控 ${runtime.thermalStatus ?? 'unknown'}，最近内存回收级别 ${runtime.lastTrimMemoryLevel ?? '未知'}`,
    );
  }
  if (context.promotion?.source) {
    header.push(`推广来源：${context.promotion.source}`);
  }
  if (context.promotion?.channel) {
    header.push(`推广渠道：${context.promotion.channel}`);
  }
  if (context.promotion?.campaign) {
    header.push(`推广活动：${context.promotion.campaign}`);
  }

  const body = input.logs.map(formatRuntimeLogEntry).join(`\n\n${LOG_SEPARATOR}\n\n`);
  return `${header.join('\n')}\n\n${LOG_SEPARATOR}\n\n${body}\n`;
}

async function openSharePanel(fileUri: string): Promise<void> {
  try {
    const openedWithNativeModule = await shareFileWithNativeModule(
      fileUri,
      TEXT_MIME_TYPE,
      '分享运行日志',
    );
    if (openedWithNativeModule) {
      return;
    }
  } catch {
    // Fall through to Expo Sharing when the native helper cannot open the chooser.
  }

  const sharingAvailable = await Sharing.isAvailableAsync();
  if (!sharingAvailable) {
    throw new Error('Sharing is unavailable on this device.');
  }

  await Sharing.shareAsync(fileUri, {
    dialogTitle: '分享运行日志',
    mimeType: TEXT_MIME_TYPE,
    UTI: TEXT_UTI,
  });
}

export async function exportRuntimeLogsTxt(
  input: RuntimeLogExportInput,
): Promise<RuntimeLogExportResult> {
  if (input.logs.length === 0) {
    throw new Error('No runtime logs to export.');
  }

  const exportedAt = new Date();
  const runtimeContext = await getRuntimeLogContextWithDiagnostics();
  const fileName = `${EXPORT_FILE_PREFIX}-${formatFileTimestamp(exportedAt)}.txt`;
  const exportDirectory = new Directory(Paths.cache, EXPORT_CACHE_DIRECTORY);
  exportDirectory.create({ intermediates: true, idempotent: true });

  const outputFile = new File(exportDirectory, fileName);
  outputFile.create({ intermediates: true, overwrite: true });
  // A UTF-8 BOM improves Chinese text detection in desktop TXT viewers.
  outputFile.write(`\uFEFF${buildRuntimeLogsTxt(input, exportedAt, runtimeContext)}`);

  await openSharePanel(outputFile.uri);

  return {
    fileName,
    fileUri: outputFile.uri,
  };
}

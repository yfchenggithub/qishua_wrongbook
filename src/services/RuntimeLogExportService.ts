import Constants from 'expo-constants';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { shareFile as shareFileWithNativeModule } from '@/src/services/AndroidFileShareService';
import type { RuntimeLogItem } from '@/src/services/Logger';

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

interface RuntimeEnvironmentInfo {
  appVersion: string | null;
  buildVersion: string | null;
  operatingSystem: string;
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

function getRuntimeEnvironmentInfo(): RuntimeEnvironmentInfo {
  const configuredVersion = Constants.expoConfig?.version;
  const appVersion = typeof configuredVersion === 'string' && configuredVersion.trim()
    ? configuredVersion.trim()
    : null;

  let buildVersion: string | null = null;
  if (Platform.OS === 'android') {
    const versionCode = Constants.platform?.android?.versionCode;
    if (typeof versionCode === 'number' && Number.isFinite(versionCode)) {
      buildVersion = String(versionCode);
    }
  } else if (Platform.OS === 'ios') {
    const buildNumber = Constants.platform?.ios?.buildNumber;
    if (typeof buildNumber === 'string' && buildNumber.trim()) {
      buildVersion = buildNumber.trim();
    }
  }

  const osName = Platform.OS === 'android'
    ? 'Android'
    : Platform.OS === 'ios'
      ? 'iOS'
      : Platform.OS;

  return {
    appVersion,
    buildVersion,
    operatingSystem: `${osName} ${String(Platform.Version)}`,
  };
}

export function buildRuntimeLogsTxt(
  input: RuntimeLogExportInput,
  exportedAt: Date = new Date(),
): string {
  const environment = getRuntimeEnvironmentInfo();
  const header = [
    `导出时间：${formatExportTimestamp(exportedAt)}`,
    `原始日志：${input.totalLogCount} 条`,
    `导出日志：${input.logs.length} 条`,
    `级别：${input.filters.levelLabel}`,
    `关键词：${input.filters.keyword || '无'}`,
    `显示范围：${input.filters.rangeLabel}`,
    `时间顺序：${input.filters.timeOrderLabel}`,
  ];

  if (environment.appVersion) {
    header.push(`App 版本号：${environment.appVersion}`);
  }
  if (environment.buildVersion) {
    header.push(`build 版本：${environment.buildVersion}`);
  }
  if (environment.operatingSystem) {
    header.push(`操作系统：${environment.operatingSystem}`);
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
  const fileName = `${EXPORT_FILE_PREFIX}-${formatFileTimestamp(exportedAt)}.txt`;
  const exportDirectory = new Directory(Paths.cache, EXPORT_CACHE_DIRECTORY);
  exportDirectory.create({ intermediates: true, idempotent: true });

  const outputFile = new File(exportDirectory, fileName);
  outputFile.create({ intermediates: true, overwrite: true });
  // A UTF-8 BOM improves Chinese text detection in desktop TXT viewers.
  outputFile.write(`\uFEFF${buildRuntimeLogsTxt(input, exportedAt)}`);

  await openSharePanel(outputFile.uri);

  return {
    fileName,
    fileUri: outputFile.uri,
  };
}

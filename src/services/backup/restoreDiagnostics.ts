import { Logger } from '@/src/services/Logger';
import { BackupRestoreError, getBackupErrorUserMessage, type BackupRestoreErrorCode } from '@/src/services/backup/BackupRestoreError';
import type { BackupCounts } from '@/src/services/backup/BackupTypes';

const MAX_LOG_STRING_LENGTH = 240;
const MAX_METADATA_ARRAY_LENGTH = 20;
const MAX_WARNING_OR_ERROR_ITEMS = 5;
const SAFE_STACK_LINE_COUNT = 3;
const FALLBACK_FILE_NAME = 'unknown.qsbk';
const SHORT_PATH_SEGMENT_COUNT = 3;

export type RestoreLogLevel = 'info' | 'warn' | 'error';

export type RestoreStage =
  | 'file_pick'
  | 'file_stat'
  | 'temp_copy'
  | 'package_read'
  | 'validate'
  | 'before_snapshot'
  | 'db_clear'
  | 'db_import'
  | 'images_restore'
  | 'verify'
  | 'rollback'
  | 'cleanup'
  | 'unknown';

export interface RestoreWarningItem {
  code: string;
  stage: RestoreStage;
  message: string;
  shortTarget?: string;
  detail?: string;
}

export interface RestoreErrorItem {
  code: string;
  stage: RestoreStage;
  message: string;
  shortTarget?: string;
  rootCauseMessage?: string;
}

export interface RestoreDurations {
  totalDurationMs: number;
  tempCopyDurationMs: number;
  packageReadDurationMs: number;
  validateDurationMs: number;
  beforeSnapshotDurationMs: number;
  dbClearDurationMs: number;
  dbImportDurationMs: number;
  imageRestoreDurationMs: number;
  verifyDurationMs: number;
  rollbackDurationMs: number;
  cleanupDurationMs: number;
}

export interface SafeErrorInfo {
  name: string;
  message: string;
  code?: string;
  stackTop?: string;
}

export interface BuildRestoreErrorInput {
  errorCode: BackupRestoreErrorCode;
  stage: RestoreStage;
  step: string;
  cause?: unknown;
  details?: Record<string, unknown>;
  userMessage?: string;
}

export function createRestoreSessionId(): string {
  return `restore-${Date.now()}-${Math.floor(Math.random() * 100000)
    .toString()
    .padStart(5, '0')}`;
}

export function nowMs(): number {
  return Date.now();
}

function clampText(value: string): string {
  if (value.length <= MAX_LOG_STRING_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_LOG_STRING_LENGTH)}...`;
}

function normalizePathLikeInput(pathOrUri: string): string {
  return pathOrUri.trim().replace(/[?#].*$/, '').replace(/\\/g, '/');
}

export function shortPath(pathOrUri: string | null | undefined): string | null {
  if (typeof pathOrUri !== 'string') {
    return null;
  }

  const normalized = normalizePathLikeInput(pathOrUri);
  if (!normalized) {
    return null;
  }

  const withoutScheme = normalized.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '');
  const segments = withoutScheme.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return null;
  }

  return segments.slice(-SHORT_PATH_SEGMENT_COUNT).join('/');
}

export function getUriScheme(uri: string | null | undefined): string {
  if (typeof uri !== 'string') {
    return 'unknown';
  }
  const matched = uri.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  return matched ? matched[1].toLowerCase() : 'unknown';
}

export function shortFileInfo(file: { name?: string | null; uri?: string | null }): string {
  const rawName =
    typeof file.name === 'string' && file.name.trim().length > 0
      ? file.name.trim()
      : shortPath(file.uri) ?? FALLBACK_FILE_NAME;
  if (rawName.length <= 48) {
    return rawName;
  }
  return `${rawName.slice(0, 24)}...${rawName.slice(-18)}`;
}

export function safeError(error: unknown): SafeErrorInfo {
  if (error instanceof BackupRestoreError) {
    const causeError = safeError(error.cause);
    return {
      name: error.name,
      message: clampText(error.message),
      code: error.code,
      stackTop: causeError.stackTop,
    };
  }

  if (error instanceof Error) {
    const stackTop =
      typeof error.stack === 'string'
        ? error.stack
            .split('\n')
            .slice(0, SAFE_STACK_LINE_COUNT)
            .map((line) => line.trim())
            .join('\n')
        : undefined;

    const candidateCode = (error as { code?: unknown }).code;
    const code = typeof candidateCode === 'string' ? candidateCode : undefined;

    return {
      name: error.name,
      message: clampText(error.message || String(error)),
      code,
      stackTop: stackTop ? clampText(stackTop) : undefined,
    };
  }

  return {
    name: 'UnknownError',
    message: clampText(String(error)),
  };
}

export function appendWarning(warnings: RestoreWarningItem[], item: RestoreWarningItem): void {
  warnings.push({
    code: clampText(item.code),
    stage: item.stage,
    message: clampText(item.message),
    shortTarget: item.shortTarget ? clampText(item.shortTarget) : undefined,
    detail: item.detail ? clampText(item.detail) : undefined,
  });
}

export function appendError(errors: RestoreErrorItem[], item: RestoreErrorItem): void {
  errors.push({
    code: clampText(item.code),
    stage: item.stage,
    message: clampText(item.message),
    shortTarget: item.shortTarget ? clampText(item.shortTarget) : undefined,
    rootCauseMessage: item.rootCauseMessage ? clampText(item.rootCauseMessage) : undefined,
  });
}

export function firstItems<T>(items: T[]): T[] {
  return items.slice(0, MAX_WARNING_OR_ERROR_ITEMS);
}

export function sanitizeMetadata<T>(metadata: T): T {
  const sanitizeValue = (value: unknown, depth: number): unknown => {
    if (value === null || value === undefined) {
      return value;
    }
    if (depth > 6) {
      return '[Truncated]';
    }
    if (typeof value === 'string') {
      return clampText(value);
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
    if (Array.isArray(value)) {
      const limited = value.slice(0, MAX_METADATA_ARRAY_LENGTH).map((item) => sanitizeValue(item, depth + 1));
      if (value.length > MAX_METADATA_ARRAY_LENGTH) {
        limited.push(`[... ${value.length - MAX_METADATA_ARRAY_LENGTH} more items]`);
      }
      return limited;
    }
    if (typeof value === 'object') {
      const output: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        output[key] = sanitizeValue(item, depth + 1);
      }
      return output;
    }
    return String(value);
  };

  return sanitizeValue(metadata, 0) as T;
}

export function logRestoreEvent(
  scope: string,
  level: RestoreLogLevel,
  eventName: string,
  metadata: Record<string, unknown>,
): void {
  const safeMetadata = sanitizeMetadata(metadata);
  if (level === 'error') {
    Logger.error(scope, eventName, safeMetadata);
    return;
  }
  if (level === 'warn') {
    Logger.warn(scope, eventName, safeMetadata);
    return;
  }
  Logger.info(scope, eventName, safeMetadata);
}

export function createEmptyDurations(): RestoreDurations {
  return {
    totalDurationMs: 0,
    tempCopyDurationMs: 0,
    packageReadDurationMs: 0,
    validateDurationMs: 0,
    beforeSnapshotDurationMs: 0,
    dbClearDurationMs: 0,
    dbImportDurationMs: 0,
    imageRestoreDurationMs: 0,
    verifyDurationMs: 0,
    rollbackDurationMs: 0,
    cleanupDurationMs: 0,
  };
}

export function createEmptyCounts(): BackupCounts {
  return {
    mistakes: 0,
    mistakeImages: 0,
    reviewRecords: 0,
    imageFiles: 0,
  };
}

export function buildRestoreError(input: BuildRestoreErrorInput): BackupRestoreError {
  const baseMessage = input.userMessage ?? getBackupErrorUserMessage(input.errorCode);
  const normalizedMessage = typeof baseMessage === 'string' && baseMessage.trim().length > 0 ? baseMessage : 'Restore failed.';
  return new BackupRestoreError(input.errorCode, normalizedMessage, {
    cause: input.cause,
    stage: input.stage,
    step: input.step,
    details: {
      ...(input.details ?? {}),
      errorCode: input.errorCode,
      stage: input.stage,
      step: input.step,
      rootCause: safeError(input.cause),
    },
  });
}

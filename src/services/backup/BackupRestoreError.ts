export type BackupRestoreErrorCode =
  | 'NOT_IMPLEMENTED'
  | 'INVALID_BACKUP_FILE'
  | 'CORRUPTED_BACKUP_FILE'
  | 'UNSUPPORTED_BACKUP_VERSION'
  | 'IMAGE_MISSING'
  | 'BACKUP_FAILED'
  | 'RESTORE_FAILED'
  | 'PERMISSION_OR_FILE_ACCESS_FAILED'
  | 'RESTORE_FILE_PICK_FAILED'
  | 'RESTORE_FILE_STAT_FAILED'
  | 'RESTORE_TEMP_COPY_FAILED'
  | 'RESTORE_PACKAGE_READ_FAILED'
  | 'RESTORE_MANIFEST_MISSING'
  | 'RESTORE_SCHEMA_UNSUPPORTED'
  | 'RESTORE_JSON_PARSE_FAILED'
  | 'RESTORE_DATA_VALIDATE_FAILED'
  | 'RESTORE_BEFORE_SNAPSHOT_FAILED'
  | 'RESTORE_DB_CLEAR_FAILED'
  | 'RESTORE_DB_IMPORT_FAILED'
  | 'RESTORE_IMAGE_RESTORE_FAILED'
  | 'RESTORE_VERIFY_FAILED'
  | 'RESTORE_ROLLBACK_FAILED'
  | 'RESTORE_UNKNOWN_FAILED';

export interface BackupRestoreErrorOptions {
  stage?: string;
  step?: string;
  details?: Record<string, unknown>;
  cause?: unknown;
}

const USER_MESSAGE_MAP: Record<Exclude<BackupRestoreErrorCode, 'NOT_IMPLEMENTED'>, string> = {
  INVALID_BACKUP_FILE: '备份文件格式不正确',
  CORRUPTED_BACKUP_FILE: '备份文件已损坏',
  UNSUPPORTED_BACKUP_VERSION: '备份版本暂不支持',
  IMAGE_MISSING: '部分图片缺失',
  BACKUP_FAILED: '备份失败',
  RESTORE_FAILED: '恢复失败',
  PERMISSION_OR_FILE_ACCESS_FAILED: '无法读取备份文件',
  RESTORE_FILE_PICK_FAILED: '选择备份文件失败',
  RESTORE_FILE_STAT_FAILED: '读取备份文件信息失败',
  RESTORE_TEMP_COPY_FAILED: '复制备份文件失败',
  RESTORE_PACKAGE_READ_FAILED: '读取备份包失败',
  RESTORE_MANIFEST_MISSING: '备份包缺少 manifest',
  RESTORE_SCHEMA_UNSUPPORTED: '备份 schemaVersion 不支持',
  RESTORE_JSON_PARSE_FAILED: '备份 JSON 解析失败',
  RESTORE_DATA_VALIDATE_FAILED: '备份数据结构校验失败',
  RESTORE_BEFORE_SNAPSHOT_FAILED: '恢复前安全备份失败',
  RESTORE_DB_CLEAR_FAILED: '清空旧数据失败',
  RESTORE_DB_IMPORT_FAILED: '写入数据库失败',
  RESTORE_IMAGE_RESTORE_FAILED: '恢复图片失败',
  RESTORE_VERIFY_FAILED: '恢复后校验失败',
  RESTORE_ROLLBACK_FAILED: '回滚失败',
  RESTORE_UNKNOWN_FAILED: '恢复失败',
};

export class BackupRestoreError extends Error {
  readonly code: BackupRestoreErrorCode;
  readonly errorCode: BackupRestoreErrorCode;
  readonly stage?: string;
  readonly step?: string;
  readonly details: Record<string, unknown> | undefined;
  readonly cause: unknown;

  constructor(code: BackupRestoreErrorCode, message: string, options?: BackupRestoreErrorOptions) {
    super(message);
    this.name = 'BackupRestoreError';
    this.code = code;
    this.errorCode = code;
    this.stage = options?.stage;
    this.step = options?.step;
    this.details = {
      ...(options?.details ?? {}),
      errorCode: code,
      stage: options?.stage,
      step: options?.step,
    };
    this.cause = options?.cause;
  }
}

export function createNotImplementedBackupError(action: string): BackupRestoreError {
  return new BackupRestoreError(
    'NOT_IMPLEMENTED',
    `Backup action "${action}" is not implemented in current phase.`,
    {
      details: {
        action,
      },
    },
  );
}

export function getBackupErrorUserMessage(code: BackupRestoreErrorCode): string {
  if (code === 'NOT_IMPLEMENTED') {
    return '该功能即将支持';
  }
  return USER_MESSAGE_MAP[code];
}

export function normalizeBackupError(
  error: unknown,
  fallbackCode: Exclude<BackupRestoreErrorCode, 'NOT_IMPLEMENTED'>,
): BackupRestoreError {
  if (error instanceof BackupRestoreError) {
    const message = error.message.trim();
    if (message.length > 0) {
      return error;
    }
    return new BackupRestoreError(error.code, getBackupErrorUserMessage(error.code), {
      stage: error.stage,
      step: error.step,
      details: error.details,
      cause: error.cause,
    });
  }

  if (error instanceof Error) {
    const normalizedMessage = `${error.name} ${error.message}`.toLowerCase();
    const guessedCode: Exclude<BackupRestoreErrorCode, 'NOT_IMPLEMENTED'> =
      normalizedMessage.includes('permission') ||
      normalizedMessage.includes('access') ||
      normalizedMessage.includes('denied') ||
      normalizedMessage.includes('not permitted') ||
      normalizedMessage.includes('eperm') ||
      normalizedMessage.includes('enoent') ||
      normalizedMessage.includes('not found')
        ? 'PERMISSION_OR_FILE_ACCESS_FAILED'
        : fallbackCode;

    const errorLike = error as Error & { stage?: unknown; step?: unknown };
    const stage = typeof errorLike.stage === 'string' ? errorLike.stage : undefined;
    const step = typeof errorLike.step === 'string' ? errorLike.step : undefined;

    return new BackupRestoreError(guessedCode, getBackupErrorUserMessage(guessedCode), {
      stage,
      step,
      details: {
        errorName: error.name,
      },
      cause: error,
    });
  }

  return new BackupRestoreError(fallbackCode, getBackupErrorUserMessage(fallbackCode), {
    cause: error,
  });
}

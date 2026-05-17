export type BackupRestoreErrorCode =
  | 'NOT_IMPLEMENTED'
  | 'INVALID_BACKUP_FILE'
  | 'CORRUPTED_BACKUP_FILE'
  | 'UNSUPPORTED_BACKUP_VERSION'
  | 'IMAGE_MISSING'
  | 'BACKUP_FAILED'
  | 'RESTORE_FAILED'
  | 'PERMISSION_OR_FILE_ACCESS_FAILED';

export interface BackupRestoreErrorOptions {
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
};

export class BackupRestoreError extends Error {
  readonly code: BackupRestoreErrorCode;
  readonly details: Record<string, unknown> | undefined;
  readonly cause: unknown;

  constructor(code: BackupRestoreErrorCode, message: string, options?: BackupRestoreErrorOptions) {
    super(message);
    this.name = 'BackupRestoreError';
    this.code = code;
    this.details = options?.details;
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

    return new BackupRestoreError(guessedCode, getBackupErrorUserMessage(guessedCode), {
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

export type BackupRestoreErrorCode =
  | 'NOT_IMPLEMENTED'
  | 'UNSUPPORTED_FORMAT'
  | 'INVALID_MANIFEST'
  | 'INVALID_DATA_PAYLOAD'
  | 'MISSING_IMAGE_FILE'
  | 'FILE_IO_FAILED'
  | 'RESTORE_PRECHECK_FAILED'
  | 'RESTORE_CONFIRMATION_REQUIRED'
  | 'RESTORE_ABORTED'
  | 'RESTORE_ROLLBACK_FAILED';

export interface BackupRestoreErrorOptions {
  details?: Record<string, unknown>;
  cause?: unknown;
}

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
    `Backup action "${action}" is not implemented in phase 1.`,
    {
      details: {
        action,
      },
    },
  );
}


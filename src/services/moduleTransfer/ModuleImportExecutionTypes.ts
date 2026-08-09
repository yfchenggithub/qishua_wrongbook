import type { ModuleImportPreviewFailureCode } from '@/src/services/moduleTransfer/ModuleImportPreviewTypes';
import type { ModuleImportStagingFailureCode } from '@/src/services/moduleTransfer/ModuleImportStagingTypes';

export interface ExecuteModuleImportInput {
  fileUri: string;
  fileName: string;
  fileSizeBytes?: number | null;
  importedAt?: string;
}

export interface ExecutedModuleImport {
  importId: string;
  packageId: string;
  moduleId: number;
  moduleName: string;
  moduleDisplayCode: string;
  mistakeIds: string[];
  imageCount: number;
  relationCount: number;
  importedAt: string;
  cleanupWarning?: string;
}

export type ModuleImportExecutionFailureCode =
  | 'invalid_input'
  | 'preview_failed'
  | 'duplicate_check_failed'
  | 'local_data_read_failed'
  | 'already_imported'
  | 'staging_failed'
  | 'image_commit_failed'
  | 'transaction_failed';

export type ExecuteModuleImportResult =
  | {
      ok: true;
      value: ExecutedModuleImport;
    }
  | {
      ok: false;
      code: ModuleImportExecutionFailureCode;
      message: string;
      causeCode?: ModuleImportPreviewFailureCode | ModuleImportStagingFailureCode;
      cleanupWarning?: string;
    };

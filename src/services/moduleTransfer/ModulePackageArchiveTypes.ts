import type {
  ModulePackageArchiveEntry,
  ModulePackageValidationIssue,
} from '@/src/models/ModulePackage';
import type { PreparedModuleExport } from '@/src/services/moduleTransfer/ModuleTransferTypes';

export type ModulePackageArchiveImageMode = 'copied' | 'converted';

export interface ModulePackageArchiveProgressEvent {
  current: number;
  total: number;
  assetId: string;
  relativePath: string;
  mode: ModulePackageArchiveImageMode;
  sourceSizeBytes: number;
  archivedSizeBytes: number;
}

export interface CreateModulePackageArchiveInput {
  prepared: PreparedModuleExport;
  fileName?: string;
  jpegQuality?: number;
  onAssetPacked?: (event: ModulePackageArchiveProgressEvent) => void;
}

export interface ModulePackageArchiveResult {
  fileUri: string;
  fileName: string;
  sizeBytes: number;
  copiedImageCount: number;
  convertedImageCount: number;
  entries: ModulePackageArchiveEntry[];
}

export type ModulePackageArchiveFailureCode =
  | 'invalid_input'
  | 'payload_invalid'
  | 'asset_mapping_invalid'
  | 'source_image_missing'
  | 'source_image_empty'
  | 'source_image_read_failed'
  | 'image_conversion_failed'
  | 'image_too_large'
  | 'archive_write_failed'
  | 'archive_invalid';

export type CreateModulePackageArchiveResult =
  | {
      ok: true;
      value: ModulePackageArchiveResult;
    }
  | {
      ok: false;
      code: ModulePackageArchiveFailureCode;
      message: string;
      assetId?: string;
      validationIssues?: ModulePackageValidationIssue[];
    };

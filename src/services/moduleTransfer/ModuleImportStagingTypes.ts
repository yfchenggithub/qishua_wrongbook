import type { ModulePackageImageType } from '@/src/models/ModulePackage';

export interface StagedModuleImportAsset {
  assetId: string;
  type: ModulePackageImageType;
  relativePath: string;
  stagedUri: string;
  sizeBytes: number;
}

export interface StagedModuleImportPackage {
  directoryUri: string;
  assets: StagedModuleImportAsset[];
}

export type ModuleImportStagingFailureCode =
  | 'source_file_missing'
  | 'archive_changed'
  | 'unsafe_entry_path'
  | 'entry_limit_exceeded'
  | 'size_limit_exceeded'
  | 'zip_read_failed'
  | 'image_write_failed'
  | 'image_invalid';

import type {
  ModulePackageArchiveEntry,
  ModulePackageImageType,
  ModulePackagePayload,
  ModulePackageValidationIssue,
} from '@/src/models/ModulePackage';

export interface ReadModuleImportPreviewInput {
  fileUri: string;
  fileName: string;
  fileSizeBytes?: number | null;
}

export interface ModuleImportPreviewQuestion {
  itemId: string;
  position: number;
  title: string | null;
  difficulty: number;
  tags: string[];
  imageCount: number;
  hasMySolution: boolean;
  hasAnswer: boolean;
}

export interface ModuleImportPreviewImage {
  assetId: string;
  type: ModulePackageImageType;
  relativePath: string;
  sizeBytes: number;
}

export interface ModuleImportPreview {
  fileName: string;
  compressedSizeBytes: number;
  totalUncompressedSizeBytes: number;
  packageId: string;
  contentVersion: number;
  appName: string;
  appVersion: string;
  createdAt: string;
  creatorName: string | null;
  module: {
    name: string;
    description: string | null;
    subject: 'math';
    icon: string;
    color: string;
  };
  counts: {
    questions: number;
    images: number;
    relations: number;
  };
  warnings: string[];
  questions: ModuleImportPreviewQuestion[];
}

export interface ParsedModulePackagePreview {
  sourceFileUri: string;
  payload: ModulePackagePayload;
  entries: ModulePackageArchiveEntry[];
  images: ModuleImportPreviewImage[];
  preview: ModuleImportPreview;
}

export type ModuleImportPreviewFailureCode =
  | 'invalid_input'
  | 'invalid_extension'
  | 'file_not_found'
  | 'file_empty'
  | 'compressed_size_limit_exceeded'
  | 'zip_read_failed'
  | 'unsafe_entry_path'
  | 'duplicate_entry'
  | 'entry_limit_exceeded'
  | 'entry_size_limit_exceeded'
  | 'uncompressed_size_limit_exceeded'
  | 'required_file_missing'
  | 'json_invalid'
  | 'invalid_format'
  | 'payload_invalid'
  | 'archive_invalid'
  | 'image_invalid';

export type ReadModuleImportPreviewResult =
  | {
      ok: true;
      value: ParsedModulePackagePreview;
    }
  | {
      ok: false;
      code: ModuleImportPreviewFailureCode;
      message: string;
      entryPath?: string;
      validationIssues?: ModulePackageValidationIssue[];
    };

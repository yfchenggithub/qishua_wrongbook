import type { TextHighlightRange } from '@/src/models/TextHighlight';

export const MODULE_PACKAGE_FORMAT = 'qishua_module' as const;
export const MODULE_PACKAGE_FORMAT_VERSION = 1 as const;
export const MODULE_PACKAGE_CONTENT_VERSION = 1 as const;
export const MODULE_PACKAGE_FILE_EXTENSION = '.qsm' as const;
export const MODULE_PACKAGE_MANIFEST_FILE_NAME = 'manifest.json' as const;
export const MODULE_PACKAGE_DATA_FILE_NAME = 'module.json' as const;
export const MODULE_PACKAGE_IMAGES_DIR_NAME = 'images' as const;

export type ModulePackageSubject = 'math';
export type ModulePackageImageType = 'question' | 'my_solution' | 'answer';
export type ModulePackageErrorReasonKind = 'builtin' | 'custom';

export interface ModulePackageCounts {
  questions: number;
  images: number;
  relations: number;
}

export interface ModulePackageCreator {
  displayName: string | null;
}

export interface ModulePackageMetadata {
  name: string;
  description: string | null;
  subject: ModulePackageSubject;
  icon: string;
  color: string;
}

export interface ModulePackageManifest {
  format: typeof MODULE_PACKAGE_FORMAT;
  formatVersion: typeof MODULE_PACKAGE_FORMAT_VERSION;
  packageId: string;
  contentVersion: typeof MODULE_PACKAGE_CONTENT_VERSION;
  appName: string;
  appVersion: string;
  createdAt: string;
  creator: ModulePackageCreator;
  module: ModulePackageMetadata;
  counts: ModulePackageCounts;
  warnings: string[];
}

export interface ModulePackageBuiltinErrorReason {
  kind: 'builtin';
  key: string;
  name: string;
}

export interface ModulePackageCustomErrorReason {
  kind: 'custom';
  name: string;
}

export type ModulePackageErrorReason =
  | ModulePackageBuiltinErrorReason
  | ModulePackageCustomErrorReason;

export interface ModulePackageImage {
  assetId: string;
  type: ModulePackageImageType;
  sortOrder: number;
  relativePath: string;
}

export interface ModulePackageQuestion {
  itemId: string;
  position: number;
  subject: ModulePackageSubject;
  title: string | null;
  difficulty: number;
  errorReasons: ModulePackageErrorReason[];
  note: string | null;
  noteHighlights: TextHighlightRange[];
  mySolutionText: string | null;
  answerText: string | null;
  tags: string[];
  images: ModulePackageImage[];
}

export interface ModulePackageRelation {
  sourceItemId: string;
  targetItemId: string;
}

export interface ModulePackageData {
  questions: ModulePackageQuestion[];
  relations: ModulePackageRelation[];
}

export interface ModulePackagePayload {
  manifest: ModulePackageManifest;
  data: ModulePackageData;
}

/**
 * ZIP entry metadata supplied by the future archive adapter. The validator
 * consumes metadata only and never reads or writes files.
 */
export interface ModulePackageArchiveEntry {
  relativePath: string;
  uncompressedSize: number;
  isDirectory?: boolean;
}

export type ModulePackageValidationCode =
  | 'required'
  | 'invalid_type'
  | 'invalid_value'
  | 'unsupported_version'
  | 'out_of_range'
  | 'duplicate'
  | 'count_mismatch'
  | 'invalid_reference'
  | 'invalid_path'
  | 'missing_file'
  | 'unexpected_file'
  | 'limit_exceeded';

export interface ModulePackageValidationIssue {
  code: ModulePackageValidationCode;
  path: string;
  message: string;
}

export type ModulePackageValidationResult<T> =
  | {
      ok: true;
      value: T;
      errors: [];
      warnings: ModulePackageValidationIssue[];
    }
  | {
      ok: false;
      errors: ModulePackageValidationIssue[];
      warnings: ModulePackageValidationIssue[];
    };

export interface ValidateModulePackageArchiveInput {
  manifest: unknown;
  data: unknown;
  entries: readonly ModulePackageArchiveEntry[];
  compressedSizeBytes?: number;
}

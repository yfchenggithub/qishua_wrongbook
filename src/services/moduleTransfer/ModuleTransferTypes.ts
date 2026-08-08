import type {
  ModulePackageImageType,
  ModulePackagePayload,
  ModulePackageValidationIssue,
} from '@/src/models/ModulePackage';

export interface PrepareModuleExportInput {
  moduleId: number;
  creatorName?: string | null;
  description?: string | null;
  packageId?: string;
  createdAt?: string;
  appName?: string;
  appVersion?: string;
}

export type ModuleExportWarningCode =
  | 'invalid_error_reason_ids'
  | 'unresolved_error_reason'
  | 'ignored_invalid_question_image_uri'
  | 'ignored_optional_image_uri'
  | 'ignored_stale_relation';

export interface ModuleExportWarning {
  code: ModuleExportWarningCode;
  count: number;
  message: string;
}

export interface ModuleExportSourceAsset {
  assetId: string;
  sourceImageId: string;
  sourceMistakeId: string;
  sourceUri: string;
  type: ModulePackageImageType;
  relativePath: string;
}

export interface PreparedModuleExport {
  sourceModuleId: number;
  payload: ModulePackagePayload;
  assets: ModuleExportSourceAsset[];
  warnings: ModuleExportWarning[];
}

export type ModuleExportFailureCode =
  | 'invalid_input'
  | 'module_not_found'
  | 'module_not_exportable'
  | 'empty_module'
  | 'missing_question_image'
  | 'payload_invalid'
  | 'read_failed';

export type PrepareModuleExportResult =
  | {
      ok: true;
      value: PreparedModuleExport;
    }
  | {
      ok: false;
      code: ModuleExportFailureCode;
      message: string;
      validationIssues?: ModulePackageValidationIssue[];
    };

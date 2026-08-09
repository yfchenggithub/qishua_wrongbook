export interface ShareModulePackageInput {
  fileUri: string;
  fileName: string;
}

export type ModulePackageShareFailureCode =
  | 'invalid_input'
  | 'file_missing'
  | 'share_unavailable'
  | 'cancelled'
  | 'share_failed';

export type ShareModulePackageResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      code: ModulePackageShareFailureCode;
      message: string;
    };

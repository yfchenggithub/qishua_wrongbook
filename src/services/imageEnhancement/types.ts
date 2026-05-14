export type ScanEnhanceResult = {
  enhancedUri: string;
  width: number;
  height: number;
};

export type ImageEnhancementErrorCode =
  | 'INVALID_INPUT'
  | 'READ_IMAGE_FAILED'
  | 'ENHANCE_FAILED'
  | 'INVALID_OUTPUT';

export class ImageEnhancementError extends Error {
  readonly code: ImageEnhancementErrorCode;

  constructor(code: ImageEnhancementErrorCode, message: string) {
    super(message);
    this.name = 'ImageEnhancementError';
    this.code = code;
  }
}

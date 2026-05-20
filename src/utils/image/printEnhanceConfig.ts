export type PrintEnhanceMode = 'original' | 'clear_print' | 'bw_scan';

export type ActivePrintEnhanceMode = 'original' | 'clear_print';

export type ClearPrintEnhanceConfig = {
  maxLongEdgePx: number;
  jpegQuality: number;
  cssFilter: string;
};

export const PRINT_ENHANCE_TEMP_DIR_PARTS = [
  'qishua_wrongbook',
  'tmp',
  'export',
  'print-enhanced',
] as const;

export const PRINT_ENHANCE_MAX_CONCURRENCY = 1;

export const CLEAR_PRINT_ENHANCE_CONFIG: ClearPrintEnhanceConfig = {
  // Keep long edge in a print-safe range to reduce memory pressure in batch export.
  maxLongEdgePx: 2200,
  jpegQuality: 0.9,
  // Mild print-friendly filter: grayscale + slight contrast/brightness gain.
  cssFilter: 'grayscale(1) contrast(1.14) brightness(1.04)',
};

export const DEFAULT_PRINT_ENHANCE_MODE: ActivePrintEnhanceMode = 'clear_print';

export function toActivePrintEnhanceMode(mode?: PrintEnhanceMode | null): ActivePrintEnhanceMode {
  if (mode === 'original' || mode === 'clear_print') {
    return mode;
  }
  return DEFAULT_PRINT_ENHANCE_MODE;
}

export function getPrintEnhanceCssFilter(mode: ActivePrintEnhanceMode): string | null {
  if (mode === 'clear_print') {
    return CLEAR_PRINT_ENHANCE_CONFIG.cssFilter;
  }
  return null;
}

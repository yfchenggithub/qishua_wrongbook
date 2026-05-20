export type PrintEnhanceMode = 'original' | 'clear_print' | 'bw_scan';

export type ActivePrintEnhanceMode = PrintEnhanceMode;

export type ClearPrintEnhanceConfig = {
  maxLongEdgePx: number;
  jpegQuality: number;
  cssFilter: string;
};

export type BwScanEnhanceConfig = {
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

export const BW_SCAN_ENHANCE_CONFIG: BwScanEnhanceConfig = {
  // Keep a stronger fallback scan-like filter when preprocessing is unavailable.
  cssFilter: 'grayscale(1) contrast(1.26) brightness(1.08)',
};

export const DEFAULT_PRINT_ENHANCE_MODE: ActivePrintEnhanceMode = 'clear_print';

export function toActivePrintEnhanceMode(mode?: PrintEnhanceMode | null): ActivePrintEnhanceMode {
  if (mode === 'original' || mode === 'clear_print' || mode === 'bw_scan') {
    return mode;
  }
  return DEFAULT_PRINT_ENHANCE_MODE;
}

export function getPrintEnhanceCssFilter(mode: ActivePrintEnhanceMode): string | null {
  // Stage 5: PDF output should rely on native preprocessing results.
  // Keep CSS filter disabled to avoid pseudo-enhancement artifacts.
  if (mode === 'clear_print' || mode === 'bw_scan') {
    return null;
  }
  return null;
}

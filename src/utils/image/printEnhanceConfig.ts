export type PrintEnhanceMode = 'original' | 'clear_print' | 'bw_scan';
export type PrintEnhanceClearPrintStrength = 'weak' | 'medium' | 'strong';
export type PrintEnhanceConcurrency = number;
export type PrintEnhancePerformanceProfile = 'balanced' | 'speed_first';

export type ActivePrintEnhanceMode = PrintEnhanceMode;

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

export const PRINT_ENHANCE_MIN_CONCURRENCY = 1;
export const PRINT_ENHANCE_MAX_CONCURRENCY = 3;
export const DEFAULT_PRINT_ENHANCE_CONCURRENCY: PrintEnhanceConcurrency = 1;

export const CLEAR_PRINT_ENHANCE_CONFIG: ClearPrintEnhanceConfig = {
  // Keep long edge in a print-safe range to reduce memory pressure in batch export.
  maxLongEdgePx: 2200,
  jpegQuality: 0.9,
  // Mild print-friendly filter: grayscale + slight contrast/brightness gain.
  cssFilter: 'grayscale(1) contrast(1.14) brightness(1.04)',
};

export const DEFAULT_PRINT_ENHANCE_MODE: ActivePrintEnhanceMode = 'clear_print';
export const DEFAULT_CLEAR_PRINT_STRENGTH: PrintEnhanceClearPrintStrength = 'medium';
export const DEFAULT_PRINT_ENHANCE_PERFORMANCE_PROFILE: PrintEnhancePerformanceProfile = 'balanced';

export function toActivePrintEnhanceMode(mode?: PrintEnhanceMode | null): ActivePrintEnhanceMode {
  // Keep backward compatibility for persisted values, but only two modes are active in product.
  if (mode === 'original' || mode === 'clear_print') {
    return mode;
  }
  return DEFAULT_PRINT_ENHANCE_MODE;
}

export function toActiveClearPrintStrength(
  strength?: PrintEnhanceClearPrintStrength | null,
): PrintEnhanceClearPrintStrength {
  if (strength === 'weak' || strength === 'medium' || strength === 'strong') {
    return strength;
  }
  return DEFAULT_CLEAR_PRINT_STRENGTH;
}

export function toActivePrintEnhanceConcurrency(
  concurrency?: number | null,
): PrintEnhanceConcurrency {
  if (typeof concurrency !== 'number' || !Number.isFinite(concurrency)) {
    return DEFAULT_PRINT_ENHANCE_CONCURRENCY;
  }
  const normalized = Math.floor(concurrency);
  if (normalized < PRINT_ENHANCE_MIN_CONCURRENCY) {
    return PRINT_ENHANCE_MIN_CONCURRENCY;
  }
  if (normalized > PRINT_ENHANCE_MAX_CONCURRENCY) {
    return PRINT_ENHANCE_MAX_CONCURRENCY;
  }
  return normalized;
}

export function toActivePrintEnhancePerformanceProfile(
  profile?: PrintEnhancePerformanceProfile | null,
): PrintEnhancePerformanceProfile {
  if (profile === 'balanced' || profile === 'speed_first') {
    return profile;
  }
  return DEFAULT_PRINT_ENHANCE_PERFORMANCE_PROFILE;
}

export function getPrintEnhanceCssFilter(mode: ActivePrintEnhanceMode): string | null {
  // Stage 5: PDF output should rely on native preprocessing results.
  // Keep CSS filter disabled to avoid pseudo-enhancement artifacts.
  if (mode === 'clear_print' || mode === 'bw_scan') {
    return null;
  }
  return null;
}

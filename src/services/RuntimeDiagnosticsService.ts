import { AppState, NativeModules, Platform } from 'react-native';

const sessionStartedAt = new Date().toISOString();
const sessionStartedAtMs = Date.now();

export interface RuntimeHardwareDiagnostics {
  deviceKind?: 'physical' | 'emulator';
  brand?: string;
  manufacturer?: string;
  model?: string;
  androidApiLevel?: number;
  board?: string;
  hardware?: string;
  product?: string;
  device?: string;
  socManufacturer?: string;
  socModel?: string;
  cpuCoreCount?: number;
  cpuArchitectures?: string[];
}

export interface RuntimeMemoryDiagnostics {
  deviceTotalBytes?: number;
  deviceAvailableBytes?: number;
  deviceUsedBytes?: number;
  deviceAvailablePercent?: number;
  lowMemory?: boolean;
  lowMemoryThresholdBytes?: number;
  memoryClassMb?: number;
  largeMemoryClassMb?: number;
  lowRamDevice?: boolean;
  appJavaHeapUsedBytes?: number;
  appJavaHeapAllocatedBytes?: number;
  appJavaHeapMaxBytes?: number;
  appNativeHeapAllocatedBytes?: number;
  appTotalPssBytes?: number;
}

export interface RuntimeStorageDiagnostics {
  totalBytes?: number;
  availableBytes?: number;
  usedBytes?: number;
  availablePercent?: number;
}

export interface RuntimeBatteryDiagnostics {
  levelPercent?: number;
  state?: 'charging' | 'discharging' | 'full' | 'not_charging' | 'unknown';
  powerSource?: 'ac' | 'usb' | 'wireless' | 'dock' | 'unplugged' | 'unknown';
  health?: string;
  temperatureCelsius?: number;
  voltageMillivolts?: number;
}

export interface RuntimeStateDiagnostics {
  capturedAt: string;
  appState: string;
  sessionUptimeMs: number;
  nativeDiagnosticsAvailable: boolean;
  deviceUptimeMs?: number;
  processUptimeMs?: number;
  processImportance?: string;
  lastTrimMemoryLevel?: number;
  powerSaveMode?: boolean;
  interactive?: boolean;
  thermalStatus?: string;
}

export interface RuntimeDiagnosticsSnapshot {
  hardware?: RuntimeHardwareDiagnostics;
  memory?: RuntimeMemoryDiagnostics;
  storage?: RuntimeStorageDiagnostics;
  battery?: RuntimeBatteryDiagnostics;
  runtime: RuntimeStateDiagnostics;
}

interface QishuaRuntimeDiagnosticsNativeModule {
  getSnapshot(): Promise<unknown>;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function resolveNativeModule(): QishuaRuntimeDiagnosticsNativeModule | null {
  if (Platform.OS !== 'android') {
    return null;
  }

  const candidate = (
    NativeModules as Record<string, unknown>
  ).QishuaRuntimeDiagnosticsModule as Partial<QishuaRuntimeDiagnosticsNativeModule> | undefined;

  return candidate && typeof candidate.getSnapshot === 'function'
    ? candidate as QishuaRuntimeDiagnosticsNativeModule
    : null;
}

function mergeNativeSnapshot(
  baseSnapshot: RuntimeDiagnosticsSnapshot,
  nativeValue: unknown,
): RuntimeDiagnosticsSnapshot {
  const nativeSnapshot = toRecord(nativeValue);
  if (!nativeSnapshot) {
    return baseSnapshot;
  }

  const nativeRuntime = toRecord(nativeSnapshot.runtime);
  const nativeHardware = toRecord(nativeSnapshot.hardware);
  const nativeMemory = toRecord(nativeSnapshot.memory);
  const nativeStorage = toRecord(nativeSnapshot.storage);
  const nativeBattery = toRecord(nativeSnapshot.battery);

  return {
    ...(nativeHardware ? { hardware: nativeHardware as RuntimeHardwareDiagnostics } : {}),
    ...(nativeMemory ? { memory: nativeMemory as RuntimeMemoryDiagnostics } : {}),
    ...(nativeStorage ? { storage: nativeStorage as RuntimeStorageDiagnostics } : {}),
    ...(nativeBattery ? { battery: nativeBattery as RuntimeBatteryDiagnostics } : {}),
    runtime: {
      ...(nativeRuntime ? nativeRuntime as Partial<RuntimeStateDiagnostics> : {}),
      ...baseSnapshot.runtime,
      nativeDiagnosticsAvailable: true,
    },
  };
}

export function getRuntimeSessionStartedAt(): string {
  return sessionStartedAt;
}

/**
 * Captures only local troubleshooting data. It intentionally excludes network
 * details, location, media, account data, and persistent device identifiers.
 */
export async function captureRuntimeDiagnostics(): Promise<RuntimeDiagnosticsSnapshot> {
  const capturedAtMs = Date.now();
  const baseSnapshot: RuntimeDiagnosticsSnapshot = {
    runtime: {
      capturedAt: new Date(capturedAtMs).toISOString(),
      appState: AppState.currentState ?? 'unknown',
      sessionUptimeMs: Math.max(0, capturedAtMs - sessionStartedAtMs),
      nativeDiagnosticsAvailable: false,
    },
  };
  const nativeModule = resolveNativeModule();
  if (!nativeModule) {
    return baseSnapshot;
  }

  try {
    return mergeNativeSnapshot(baseSnapshot, await nativeModule.getSnapshot());
  } catch {
    return baseSnapshot;
  }
}

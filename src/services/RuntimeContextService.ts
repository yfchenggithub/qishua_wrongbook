import Constants from 'expo-constants';
import { Appearance, Dimensions, I18nManager, Platform } from 'react-native';

import {
  captureRuntimeDiagnostics,
  getRuntimeSessionStartedAt,
  type RuntimeDiagnosticsSnapshot,
} from '@/src/services/RuntimeDiagnosticsService';

export interface RuntimePromotionContext {
  source?: string;
  channel?: string;
  campaign?: string;
}

export interface RuntimeLogContext {
  session: {
    id?: string;
    startedAt: string;
  };
  app: {
    version?: string;
    buildVersion?: string;
    executionEnvironment: string;
    buildMode: 'development' | 'production';
  };
  system: {
    name: string;
    version: string;
    brand?: string;
    model?: string;
    locale?: string;
    timeZone?: string;
    colorScheme: 'light' | 'dark' | 'unspecified';
    interfaceDirection: 'ltr' | 'rtl';
  };
  display: {
    width: number;
    height: number;
    scale: number;
    fontScale: number;
  };
  diagnostics?: RuntimeDiagnosticsSnapshot;
  promotion?: RuntimePromotionContext;
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().replace(/[\r\n]+/g, ' ');
  return normalized ? normalized.slice(0, 160) : undefined;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : null;
}

function getBuildVersion(): string | undefined {
  if (Platform.OS === 'android') {
    const versionCode = Constants.platform?.android?.versionCode;
    return typeof versionCode === 'number' && Number.isFinite(versionCode)
      ? String(versionCode)
      : undefined;
  }

  if (Platform.OS === 'ios') {
    return normalizeOptionalText(Constants.platform?.ios?.buildNumber);
  }

  return undefined;
}

function getLocaleAndTimeZone(): { locale?: string; timeZone?: string } {
  try {
    const resolvedOptions = Intl.DateTimeFormat().resolvedOptions();
    return {
      locale: normalizeOptionalText(resolvedOptions.locale),
      timeZone: normalizeOptionalText(resolvedOptions.timeZone),
    };
  } catch {
    return {};
  }
}

function getPromotionContext(): RuntimePromotionContext | undefined {
  const extra = toRecord(Constants.expoConfig?.extra);
  const promotion = toRecord(extra?.promotion);
  if (!promotion) {
    return undefined;
  }

  const context: RuntimePromotionContext = {
    source: normalizeOptionalText(promotion.source),
    channel: normalizeOptionalText(promotion.channel),
    campaign: normalizeOptionalText(promotion.campaign),
  };

  return context.source || context.channel || context.campaign ? context : undefined;
}

function getSystemName(): string {
  if (Platform.OS === 'android') {
    return 'Android';
  }
  if (Platform.OS === 'ios') {
    return 'iOS';
  }
  return Platform.OS;
}

function getDeviceBrand(): string | undefined {
  if (Platform.OS === 'android') {
    return normalizeOptionalText(Platform.constants.Brand)
      ?? normalizeOptionalText(Platform.constants.Manufacturer);
  }

  if (Platform.OS === 'ios') {
    return 'Apple';
  }

  return undefined;
}

function getDeviceModel(): string | undefined {
  if (Platform.OS === 'android') {
    return normalizeOptionalText(Platform.constants.Model);
  }

  if (Platform.OS === 'ios') {
    return normalizeOptionalText(Constants.platform?.ios?.model);
  }

  return undefined;
}

/**
 * Returns local diagnostic context only. It deliberately excludes persistent
 * device identifiers and personal fields such as name, phone, location, or media.
 * Optional promotion attribution is read only from expo.extra.promotion when the
 * app build explicitly provides source/channel/campaign values.
 */
export function getRuntimeLogContext(): RuntimeLogContext {
  const screen = Dimensions.get('screen');
  const localeAndTimeZone = getLocaleAndTimeZone();
  const configuredColorScheme = Appearance.getColorScheme();
  const sessionId = normalizeOptionalText(Constants.sessionId);
  const appVersion = normalizeOptionalText(Constants.expoConfig?.version);
  const buildVersion = getBuildVersion();
  const promotion = getPromotionContext();
  const deviceBrand = getDeviceBrand();
  const deviceModel = getDeviceModel();

  return {
    session: {
      ...(sessionId ? { id: sessionId } : {}),
      startedAt: getRuntimeSessionStartedAt(),
    },
    app: {
      ...(appVersion ? { version: appVersion } : {}),
      ...(buildVersion ? { buildVersion } : {}),
      executionEnvironment: String(Constants.executionEnvironment),
      buildMode: __DEV__ ? 'development' : 'production',
    },
    system: {
      name: getSystemName(),
      version: String(Platform.Version),
      ...(deviceBrand ? { brand: deviceBrand } : {}),
      ...(deviceModel ? { model: deviceModel } : {}),
      ...localeAndTimeZone,
      colorScheme: configuredColorScheme === 'light' || configuredColorScheme === 'dark'
        ? configuredColorScheme
        : 'unspecified',
      interfaceDirection: I18nManager.isRTL ? 'rtl' : 'ltr',
    },
    display: {
      width: Math.round(screen.width),
      height: Math.round(screen.height),
      scale: screen.scale,
      fontScale: screen.fontScale,
    },
    ...(promotion ? { promotion } : {}),
  };
}

export async function getRuntimeLogContextWithDiagnostics(): Promise<RuntimeLogContext> {
  const context = getRuntimeLogContext();
  return {
    ...context,
    diagnostics: await captureRuntimeDiagnostics(),
  };
}

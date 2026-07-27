import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';

import { Logger } from '@/src/services/Logger';

const SERVICE_SCOPE = 'AndroidNativeWorksheetPdfService';
const MODULE_NAME = 'QishuaWorksheetPdfModule';
const STAGE_EVENT_NAME = 'QishuaWorksheetPdfStage';

export const ANDROID_NATIVE_WORKSHEET_PDF_TIMEOUT_MS = 120_000;

export type AndroidNativeWorksheetPdfItem = {
  title: string;
  module: string;
  progress: string;
  difficulty: string;
  dueDate: string;
  imageUri: string | null;
  fallbackImageUri: string | null;
  imageWidth: number;
  imageHeight: number;
};

export type PrintAndroidNativeWorksheetPdfOptions = {
  date: string;
  sheetId: string;
  totalQuestionCount: number;
  questionNumberOffset: number;
  qrSize: number;
  qrCells: number[];
  items: AndroidNativeWorksheetPdfItem[];
  timeoutMs?: number;
};

export type PrintAndroidNativeWorksheetPdfResult = {
  uri: string;
  numberOfPages: number;
};

type NativeWorksheetPdfRequest = PrintAndroidNativeWorksheetPdfOptions & {
  requestId: string;
  timeoutMs: number;
};

type NativeWorksheetPdfResult = {
  uri?: string;
  numberOfPages?: number;
};

type NativeWorksheetPdfModule = {
  printWorksheetToFile: (
    request: NativeWorksheetPdfRequest,
  ) => Promise<NativeWorksheetPdfResult>;
};

type NativeWorksheetPdfStageEvent = {
  requestId?: string;
  stage?: string;
  level?: string;
  elapsedMs?: number;
  timeoutMs?: number;
  itemCount?: number;
  itemNumber?: number;
  pageCount?: number;
  outputBytes?: number;
  message?: string;
  blockedStage?: string;
};

function getNativeModule(): NativeWorksheetPdfModule | null {
  if (Platform.OS !== 'android') {
    return null;
  }
  const candidate = (NativeModules as Record<string, unknown>)[MODULE_NAME] as
    | Partial<NativeWorksheetPdfModule>
    | undefined;
  return typeof candidate?.printWorksheetToFile === 'function'
    ? candidate as NativeWorksheetPdfModule
    : null;
}

function createRequestId(): string {
  return `worksheet-pdf-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function toSafeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code.trim().length > 0 ? code : null;
}

function logNativeStage(event: NativeWorksheetPdfStageEvent): void {
  const stage = typeof event.stage === 'string' && event.stage.trim().length > 0
    ? event.stage.trim()
    : 'native_worksheet_pdf_unknown_stage';
  const metadata = {
    requestId: event.requestId ?? null,
    elapsedMs: toSafeNumber(event.elapsedMs),
    timeoutMs: toSafeNumber(event.timeoutMs),
    itemCount: toSafeNumber(event.itemCount),
    itemNumber: toSafeNumber(event.itemNumber),
    pageCount: toSafeNumber(event.pageCount),
    outputBytes: toSafeNumber(event.outputBytes),
    blockedStage: event.blockedStage ?? null,
    nativeMessage: event.message ?? null,
  };

  if (event.level === 'error') {
    Logger.error(SERVICE_SCOPE, stage, metadata);
  } else if (event.level === 'warn') {
    Logger.warn(SERVICE_SCOPE, stage, metadata);
  } else {
    Logger.info(SERVICE_SCOPE, stage, metadata);
  }
}

export function isAndroidNativeWorksheetPdfAvailable(): boolean {
  return getNativeModule() !== null;
}

export async function printAndroidNativeWorksheetPdf(
  options: PrintAndroidNativeWorksheetPdfOptions,
): Promise<PrintAndroidNativeWorksheetPdfResult> {
  const nativeModule = getNativeModule();
  if (!nativeModule) {
    throw new Error(
      'QishuaWorksheetPdfModule is unavailable. Rebuild and reinstall the Android app.',
    );
  }

  const requestId = createRequestId();
  const timeoutMs = Math.max(
    10_000,
    Math.min(
      600_000,
      Math.floor(options.timeoutMs ?? ANDROID_NATIVE_WORKSHEET_PDF_TIMEOUT_MS),
    ),
  );
  const subscription = DeviceEventEmitter.addListener(
    STAGE_EVENT_NAME,
    (event: NativeWorksheetPdfStageEvent) => {
      if (event.requestId === requestId) {
        logNativeStage(event);
      }
    },
  );

  try {
    const result = await nativeModule.printWorksheetToFile({
      ...options,
      requestId,
      timeoutMs,
    });
    const uri = typeof result?.uri === 'string' ? result.uri.trim() : '';
    const numberOfPages = Math.max(0, Math.floor(result?.numberOfPages ?? 0));
    if (!uri || numberOfPages <= 0) {
      throw new Error('Native worksheet PDF completed without a usable output file.');
    }
    return {
      uri,
      numberOfPages,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'native_worksheet_pdf_request_rejected', {
      requestId,
      timeoutMs,
      itemCount: options.items.length,
      errorCode: toErrorCode(error),
      error,
    });
    throw error;
  } finally {
    subscription.remove();
  }
}

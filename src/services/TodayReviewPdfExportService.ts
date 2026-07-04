import { Directory, File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Image, Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';

import type { TodayReviewExportItem } from '@/src/models/TodayReviewExportItem';
import { getCachedPrintEnhancedImageForPdf, type PrintEnhanceCacheStatus } from '@/src/services/export/PrintEnhanceCacheService';
import {
  cleanupPrintEnhancedTempFiles,
  type PrintEnhanceEngine,
  type PrintEnhanceOutputFormat,
} from '@/src/services/export/PrintImageEnhancer';
import { Logger } from '@/src/services/Logger';
import { getTodayReviewExportItems } from '@/src/services/MistakeListService';
import { parseLocalDateTime, toDateOnlyString } from '@/src/utils/date';
import {
  DEFAULT_PRINT_ENHANCE_CONCURRENCY,
  DEFAULT_PRINT_ENHANCE_PERFORMANCE_PROFILE,
  DEFAULT_CLEAR_PRINT_STRENGTH,
  DEFAULT_PRINT_ENHANCE_MODE,
  getPrintEnhanceCssFilter,
  toActivePrintEnhanceConcurrency,
  toActivePrintEnhancePerformanceProfile,
  toActiveClearPrintStrength,
  toActivePrintEnhanceMode,
  type PrintEnhanceConcurrency,
  type PrintEnhancePerformanceProfile,
  type PrintEnhanceClearPrintStrength,
  type PrintEnhanceMode,
} from '@/src/utils/image/printEnhanceConfig';

const SERVICE_SCOPE = 'TodayReviewPdfExportService';
const EXPORT_DIR_NAME = 'qishua_wrongbook';
const EXPORT_SUB_DIR_NAME = 'exports';
const PDF_MIME_TYPE = 'application/pdf';
const PDF_FILE_PREFIX = 'qishua_today_review';
const DEFAULT_EXPORT_PRINT_ENHANCE_MODE: PrintEnhanceMode = DEFAULT_PRINT_ENHANCE_MODE;
const SUSPICIOUS_PDF_SIZE_BYTES = 4 * 1024;
const EXPORT_ITEMS_PER_PDF_FILE = 40;
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const PDF_PAGE_MARGIN_MM = 12;
const PDF_CONTENT_WIDTH_MM = A4_WIDTH_MM - PDF_PAGE_MARGIN_MM * 2;
const PDF_CONTENT_HEIGHT_MM = A4_HEIGHT_MM - PDF_PAGE_MARGIN_MM * 2;
const SINGLE_PAGE_FIXED_HEIGHT_MM = 72;
const TWO_PAGE_QUESTION_FIXED_HEIGHT_MM = 58;
const ANSWER_PAGE_FIXED_HEIGHT_MM = 62;
const ANSWER_MIN_HEIGHT_MM = 80;
const THOUGHT_MIN_HEIGHT_MM = 35;
const RESULT_AREA_HEIGHT_MM = 18;
const SINGLE_PAGE_IMAGE_WIDTH_RATIO_SHORT = 0.84;
const SINGLE_PAGE_IMAGE_WIDTH_RATIO_MEDIUM = 0.9;
const TWO_PAGE_IMAGE_WIDTH_RATIO = 0.95;
const EXPORT_BUSY_MESSAGE = '导出/分享进行中，请稍后再试。';
const SHARE_BUSY_ERROR_FRAGMENT = 'another share request is being processed';
let isExportInProgress = false;
const INVALID_PDF_URI_MESSAGE = 'Invalid PDF file path. Please generate the worksheet again.';
const MISSING_PDF_FILE_MESSAGE = 'PDF file does not exist. Please generate it again.';
const OPEN_WITH_OTHER_APP_FAILED_MESSAGE = 'Unable to open PDF. Try sharing it and opening from another app.';
const SHARE_DIALOG_TITLE = 'Share Today Practice PDF';
const OPEN_WITH_OTHER_APP_DIALOG_TITLE = 'Open PDF with another app';
const FALLBACK_EXPORT_ERROR_MESSAGE = '导出失败，请稍后重试';
const SHARE_UNAVAILABLE_MESSAGE = '当前设备暂不支持分享，请在文件管理中查看已导出的练习卷';
const EMPTY_MESSAGE = '今天没有待复做题，无需导出练习卷';

export type ExportTodayReviewPdfOptions = {
  date?: string;
  printEnhanceMode?: PrintEnhanceMode;
  printEnhanceClearPrintStrength?: PrintEnhanceClearPrintStrength;
  printEnhanceConcurrency?: PrintEnhanceConcurrency;
  printEnhancePerformanceProfile?: PrintEnhancePerformanceProfile;
  onProgress?: (progress: ExportTodayReviewPdfProgress) => void;
};

export type ExportTodayReviewPdfStage =
  | 'prepare_items'
  | 'process_images'
  | 'generate_pdf'
  | 'save_pdf'
  | 'open_share';

export type ExportTodayReviewPdfProgress = {
  stage: ExportTodayReviewPdfStage;
  itemCount: number | null;
  current: number;
  total: number;
  message: string;
};

export type ExportTodayReviewPdfResult =
  | {
      success: true;
      fileUri: string;
      fileUris: string[];
      exportedCount: number;
      pdfPartCount: number;
    }
  | {
      success: false;
      reason: 'empty' | 'generate_failed' | 'share_unavailable' | 'busy' | 'unknown';
      message: string;
      exportedCount?: number;
      fileUri?: string;
      fileUris?: string[];
      pdfPartCount?: number;
    };

export type ShareTodayReviewPdfResult =
  | {
      success: true;
    }
  | {
      success: false;
      reason: 'invalid_uri' | 'file_missing' | 'share_unavailable' | 'busy' | 'cancelled' | 'unknown';
      message: string;
    };

export type OpenTodayReviewPdfWithOtherAppResult =
  | {
      success: true;
    }
  | {
      success: false;
      reason: 'invalid_uri' | 'file_missing' | 'open_failed' | 'unknown';
      message: string;
    };

type TodayReviewPdfRenderItem = {
  raw: TodayReviewExportItem;
  questionImageSrc: string | null;
  questionImageSize: PrintImageSize | null;
};

type PrintImageSize = {
  width: number;
  height: number;
};

type QuestionPrintLayout =
  | {
      kind: 'single_page';
      ratio: number;
      imageDisplayWidthMm: number;
      imageMaxHeightMm: number;
      estimatedImageHeightMm: number;
      remainingAnswerSpaceMm: number;
    }
  | {
      kind: 'question_answer_pages';
      ratio: number;
      imageDisplayWidthMm: number;
      imageMaxHeightMm: number;
      estimatedImageHeightMm: number;
      remainingAnswerSpaceMm: number;
    };

type QuestionImageEnhanceTrace = {
  mode: PrintEnhanceMode;
  clearPrintStrength: PrintEnhanceClearPrintStrength;
  performanceProfile: PrintEnhancePerformanceProfile;
  sourceUri: string;
  enhancedUri: string;
  selectedUri: string | null;
  engine: PrintEnhanceEngine;
  outputFormat: PrintEnhanceOutputFormat;
  success: boolean;
  usedFallback: boolean;
  durationMs: number;
  cacheStatus: PrintEnhanceCacheStatus;
};

type BuildQuestionImageSrcResult = {
  imageDataUri: string | null;
  imageSize: PrintImageSize | null;
  temporaryEnhancedUri: string | null;
  trace: QuestionImageEnhanceTrace | null;
  base64ReadDurationMs: number;
  base64ReadAttemptCount: number;
};

type BuildRenderItemsProcessMetrics = {
  processedImageItemCount: number;
  enhanceDurationTotalMs: number;
  base64ReadDurationTotalMs: number;
  base64ReadAttemptTotalCount: number;
  enhanceDurationMaxMs: number;
  base64ReadDurationMaxMs: number;
};

type BuildRenderItemsResult = {
  renderItems: TodayReviewPdfRenderItem[];
  temporaryEnhancedUris: string[];
  processMetrics: BuildRenderItemsProcessMetrics;
};

type RenderItemBuildResult = {
  renderItem: TodayReviewPdfRenderItem;
  temporaryEnhancedUri: string | null;
  enhanceDurationMs: number;
  base64ReadDurationMs: number;
  base64ReadAttemptCount: number;
  processedImageItemCount: number;
};

type BuildItemsProgress = {
  current: number;
  total: number;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toSafeUriPreview(uri: string | null | undefined): string | null {
  const normalized = normalizeOptionalText(uri);
  if (!normalized) {
    return null;
  }
  if (normalized.length <= 72) {
    return normalized;
  }
  return `${normalized.slice(0, 28)}...${normalized.slice(-24)}`;
}

function toDisplayText(value: string | null | undefined, fallback: string): string {
  return normalizeOptionalText(value) ?? fallback;
}

function isShareBusyError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.toLowerCase().includes(SHARE_BUSY_ERROR_FRAGMENT);
}

function isUserCancelledShare(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  const name = error.name.toLowerCase();
  return (
    message.includes('cancel')
    || message.includes('canceled')
    || message.includes('cancelled')
    || message.includes('dismiss')
    || message.includes('did not share')
    || name.includes('abort')
  );
}

function toAndroidFilePath(uri: string): string {
  if (uri.startsWith('file://')) {
    return uri.slice('file://'.length);
  }
  return uri;
}

function resolveBaseDate(date?: string): Date {
  const parsed = parseLocalDateTime(normalizeOptionalText(date));
  if (parsed) {
    return parsed;
  }
  if (normalizeOptionalText(date)) {
    Logger.warn(SERVICE_SCOPE, 'Invalid export date input, fallback to current date.', {
      inputDate: date,
    });
  }
  return new Date();
}

function buildExportFileName(
  dateString: string,
  exportedAt = new Date(),
  partIndex?: number,
  partCount?: number,
): string {
  const safeDate = normalizeOptionalText(dateString) ?? toDateOnlyString(exportedAt);
  const safePartCount = typeof partCount === 'number' && Number.isFinite(partCount)
    ? Math.max(1, Math.floor(partCount))
    : 1;
  const safePartIndex = typeof partIndex === 'number' && Number.isFinite(partIndex)
    ? Math.max(1, Math.floor(partIndex))
    : 1;
  const partSuffix = safePartCount > 1
    ? `_part${String(Math.min(safePartIndex, safePartCount)).padStart(2, '0')}-of-${String(safePartCount).padStart(2, '0')}`
    : '';
  const uniqueStamp = exportedAt.getTime();
  return `${PDF_FILE_PREFIX}_${safeDate}${partSuffix}_${uniqueStamp}.pdf`;
}

function getExportItemsPerPdfFile(): number {
  return Math.max(1, Math.floor(EXPORT_ITEMS_PER_PDF_FILE));
}

function chunkExportItems(items: TodayReviewExportItem[], chunkSize: number): TodayReviewExportItem[][] {
  const safeChunkSize = Math.max(1, Math.floor(chunkSize));
  const chunks: TodayReviewExportItem[][] = [];
  for (let start = 0; start < items.length; start += safeChunkSize) {
    chunks.push(items.slice(start, start + safeChunkSize));
  }
  return chunks;
}

function getFileSizeBytes(uri: string): number | null {
  try {
    const info = new File(uri).info();
    if (!info.exists) {
      return null;
    }
    return typeof info.size === 'number' && Number.isFinite(info.size)
      ? Math.max(0, Math.floor(info.size))
      : null;
  } catch {
    return null;
  }
}

function countWorksheetPagesInHtml(html: string): number {
  return (html.match(/<section class="worksheet-page\b/g) ?? []).length;
}

function summarizeExportItems(items: TodayReviewExportItem[]): {
  index: number;
  mistakeId: string;
  module: string;
  title: string;
  dueDate: string;
  hasQuestionImageUri: boolean;
  currentReviewIndex: number;
  totalReviewCount: number;
}[] {
  return items.slice(0, 8).map((item, index) => ({
    index: index + 1,
    mistakeId: item.mistakeId,
    module: item.module,
    title: item.title,
    dueDate: item.dueDate,
    hasQuestionImageUri: !!normalizeOptionalText(item.questionImageUri),
    currentReviewIndex: Number.isFinite(item.currentReviewIndex) ? Math.floor(item.currentReviewIndex) : -1,
    totalReviewCount: Number.isFinite(item.totalReviewCount) ? Math.floor(item.totalReviewCount) : -1,
  }));
}

function buildFallbackPdfHtml(
  items: TodayReviewPdfRenderItem[],
  dateString: string,
  totalCount = items.length,
  questionNumberOffset = 0,
): string {
  const cardsHtml = items
    .map((item, index) => {
      const module = escapeHtml(toDisplayText(item.raw.module, '-'));
      const title = escapeHtml(toDisplayText(item.raw.title, '-'));
      const progress = escapeHtml(formatProgressText(item.raw));
      const dueDate = escapeHtml(formatDueDateText(item.raw.dueDate));
      const questionImageSrc = item.questionImageSrc ? escapeHtml(item.questionImageSrc) : null;
      const questionImageBlock = questionImageSrc
        ? `<img class="question-image" src="${questionImageSrc}" alt="题目图片" />`
        : '<div class="question-placeholder">题目图片暂时无法加载</div>';
      return `
        <section class="card">
          <h2>第 ${questionNumberOffset + index + 1} 题</h2>
          <p>模块：${module}</p>
          <p>标题：${title}</p>
          <p>进度：${progress}</p>
          <p>到期日：${dueDate}</p>
          <div class="question-box">
            <div class="question-label">我的题目：</div>
            <div class="question-image-wrap">
              ${questionImageBlock}
            </div>
          </div>
          <div class="answer-box">我的解答：</div>
        </section>
      `;
    })
    .join('\n');

  return `
    <!DOCTYPE html>
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>今日练习卷</title>
        <style>
          @page { size: A4; margin: 14mm; }
          body { margin: 0; color: #111; font-family: "Microsoft YaHei", Arial, sans-serif; }
          .sheet-title { font-size: 22px; margin: 0 0 8px 0; }
          .sheet-meta { font-size: 13px; margin: 0 0 12px 0; color: #555; }
          .card { border: 1px solid #d8d8d8; border-radius: 8px; padding: 12px; margin-bottom: 10px; page-break-inside: avoid; }
          .card h2 { margin: 0 0 8px 0; font-size: 18px; }
          .card p { margin: 4px 0; font-size: 14px; }
          .question-box { margin-top: 8px; }
          .question-label { margin-bottom: 6px; font-size: 14px; font-weight: 700; color: #333; }
          .question-image-wrap { border: 1px dashed #d0d0d0; border-radius: 6px; padding: 8px; min-height: 80px; }
          .question-image { display: block; width: 100%; max-height: 520px; object-fit: contain; }
          .question-placeholder { color: #888; font-size: 13px; }
          .answer-box { margin-top: 8px; min-height: 120px; border: 1px dashed #b8b8b8; border-radius: 6px; padding: 8px; color: #666; }
        </style>
      </head>
      <body>
        <h1 class="sheet-title">七刷错题本 · 今日复做练习卷</h1>
        <p class="sheet-meta">日期：${escapeHtml(dateString)} · 共 ${totalCount} 道题</p>
        ${cardsHtml}
      </body>
    </html>
  `;
}

function toSafeProgressCounter(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function buildExportProgressMessage(
  stage: ExportTodayReviewPdfStage,
  current: number,
  total: number,
): string {
  if (stage === 'prepare_items') {
    return total > 0 ? `准备题目中（${total} 题）...` : '准备题目中...';
  }
  if (stage === 'process_images') {
    return total > 0
      ? `处理图片 ${Math.max(0, Math.min(current, total))} / ${total}`
      : '正在处理图片...';
  }
  if (stage === 'generate_pdf') {
    return total > 0
      ? `生成 PDF 页面 ${Math.max(0, Math.min(current, total))} / ${total}`
      : '正在生成 PDF 页面...';
  }
  if (stage === 'save_pdf') {
    return '正在保存 PDF...';
  }
  return '正在准备分享...';
}

function reportExportProgress(
  reporter: ExportTodayReviewPdfOptions['onProgress'],
  progress: {
    stage: ExportTodayReviewPdfStage;
    current?: number | null;
    total?: number | null;
    itemCount?: number | null;
    message?: string;
  },
): void {
  if (!reporter) {
    return;
  }
  const safeTotal = toSafeProgressCounter(progress.total ?? progress.itemCount ?? 0);
  const safeCurrent = safeTotal > 0
    ? Math.min(safeTotal, toSafeProgressCounter(progress.current))
    : toSafeProgressCounter(progress.current);
  const safeMessage = normalizeOptionalText(progress.message)
    ?? buildExportProgressMessage(progress.stage, safeCurrent, safeTotal);

  try {
    reporter({
      stage: progress.stage,
      itemCount: safeTotal > 0 ? safeTotal : null,
      current: safeCurrent,
      total: safeTotal,
      message: safeMessage,
    });
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Export progress reporter callback failed.', {
      stage: progress.stage,
      current: safeCurrent,
      total: safeTotal,
      error,
    });
  }
}

function guessImageMimeType(uri: string): string {
  const normalized = uri.toLowerCase();
  if (normalized.endsWith('.png')) {
    return 'image/png';
  }
  if (normalized.endsWith('.webp')) {
    return 'image/webp';
  }
  if (normalized.endsWith('.gif')) {
    return 'image/gif';
  }
  if (normalized.endsWith('.bmp')) {
    return 'image/bmp';
  }
  if (normalized.endsWith('.heic')) {
    return 'image/heic';
  }
  if (normalized.endsWith('.heif')) {
    return 'image/heif';
  }
  return 'image/jpeg';
}

async function toImageDataUri(uri: string): Promise<string | null> {
  try {
    const file = new File(uri);
    if (!file.exists) {
      Logger.warn(SERVICE_SCOPE, 'Question image missing while building export PDF item.', {
        uriPreview: toSafeUriPreview(uri),
      });
      return null;
    }
    const base64 = await file.base64();
    if (!base64) {
      return null;
    }
    const mimeType = guessImageMimeType(uri);
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Failed to convert question image to base64 data uri.', {
      uriPreview: toSafeUriPreview(uri),
      error,
    });
    return null;
  }
}

function normalizePrintImageSize(width: number, height: number): PrintImageSize | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return {
    width: Math.round(width),
    height: Math.round(height),
  };
}

async function getPrintImageSize(uri: string): Promise<PrintImageSize | null> {
  return new Promise((resolve) => {
    Image.getSize(
      uri,
      (width, height) => {
        resolve(normalizePrintImageSize(width, height));
      },
      (error) => {
        Logger.warn(SERVICE_SCOPE, 'Failed to read print image size.', {
          uriPreview: toSafeUriPreview(uri),
          error,
        });
        resolve(null);
      },
    );
  });
}

async function buildQuestionImageSrc(
  uri: string,
  printEnhanceMode: PrintEnhanceMode,
  clearPrintStrength: PrintEnhanceClearPrintStrength,
  performanceProfile: PrintEnhancePerformanceProfile,
): Promise<BuildQuestionImageSrcResult> {
  const normalizedUri = normalizeOptionalText(uri);
  if (!normalizedUri) {
    return {
      imageDataUri: null,
      imageSize: null,
      temporaryEnhancedUri: null,
      trace: null,
      base64ReadDurationMs: 0,
      base64ReadAttemptCount: 0,
    };
  }

  const enhanceResult = await getCachedPrintEnhancedImageForPdf(
    normalizedUri,
    printEnhanceMode,
    clearPrintStrength,
    performanceProfile,
  );
  const enhancedUri = normalizeOptionalText(enhanceResult.outputUri) ?? normalizedUri;
  const temporaryEnhancedUri = (enhanceResult.shouldCleanupOutput && enhancedUri !== normalizedUri)
    ? enhancedUri
    : null;
  const candidateUris = enhancedUri === normalizedUri ? [normalizedUri] : [enhancedUri, normalizedUri];
  let base64ReadDurationMs = 0;
  let base64ReadAttemptCount = 0;

  for (const candidateUri of candidateUris) {
    const base64StartedAt = Date.now();
    const dataUri = await toImageDataUri(candidateUri);
    base64ReadDurationMs += Math.max(0, Date.now() - base64StartedAt);
    base64ReadAttemptCount += 1;
    if (dataUri) {
      const imageSize = await getPrintImageSize(candidateUri);
      const trace: QuestionImageEnhanceTrace = {
        mode: printEnhanceMode,
        clearPrintStrength,
        performanceProfile,
        sourceUri: normalizedUri,
        enhancedUri,
        selectedUri: candidateUri,
        engine: enhanceResult.engine,
        outputFormat: enhanceResult.outputFormat,
        success: enhanceResult.success,
        usedFallback: enhanceResult.usedFallback,
        durationMs: enhanceResult.durationMs,
        cacheStatus: enhanceResult.cacheStatus,
      };
      return {
        imageDataUri: dataUri,
        imageSize,
        temporaryEnhancedUri,
        trace,
        base64ReadDurationMs,
        base64ReadAttemptCount,
      };
    }
  }

  Logger.warn(SERVICE_SCOPE, 'Failed to build embeddable image data uri for export PDF item.', {
    sourceUriPreview: toSafeUriPreview(enhancedUri),
    originalUriPreview: toSafeUriPreview(normalizedUri),
    printEnhanceMode,
    enhanceEngine: enhanceResult.engine,
    enhanceUsedFallback: enhanceResult.usedFallback,
    cacheStatus: enhanceResult.cacheStatus,
    enhanceDurationMs: enhanceResult.durationMs,
  });
  return {
    imageDataUri: null,
    imageSize: null,
    temporaryEnhancedUri,
    trace: {
      mode: printEnhanceMode,
      clearPrintStrength,
      performanceProfile,
      sourceUri: normalizedUri,
      enhancedUri,
      selectedUri: null,
      engine: enhanceResult.engine,
      outputFormat: enhanceResult.outputFormat,
      success: enhanceResult.success,
      usedFallback: enhanceResult.usedFallback,
      durationMs: enhanceResult.durationMs,
      cacheStatus: enhanceResult.cacheStatus,
    },
    base64ReadDurationMs,
    base64ReadAttemptCount,
  };
}

function formatDifficultyText(difficulty: number | null): string {
  if (typeof difficulty !== 'number' || !Number.isFinite(difficulty)) {
    return '-';
  }
  return String(Math.floor(difficulty));
}

function formatProgressText(item: TodayReviewExportItem): string {
  const current = Number.isFinite(item.currentReviewIndex) && item.currentReviewIndex > 0
    ? Math.floor(item.currentReviewIndex)
    : null;
  const total = Number.isFinite(item.totalReviewCount) && item.totalReviewCount > 0
    ? Math.floor(item.totalReviewCount)
    : 7;
  return `第 ${current ? String(current) : '?'} / ${total} 刷`;
}

function formatDueDateText(dueDate: string): string {
  const parsed = parseLocalDateTime(normalizeOptionalText(dueDate));
  if (parsed) {
    return toDateOnlyString(parsed);
  }
  return normalizeOptionalText(dueDate) ?? '-';
}

function buildQuestionCardHtml(item: TodayReviewPdfRenderItem, index: number): string {
  const questionNo = index + 1;
  const title = escapeHtml(toDisplayText(item.raw.title, '未命名题目'));
  const module = escapeHtml(toDisplayText(item.raw.module, '模块未知'));
  const progressText = escapeHtml(formatProgressText(item.raw));
  const difficultyText = escapeHtml(formatDifficultyText(item.raw.difficulty));
  const dueDate = escapeHtml(formatDueDateText(item.raw.dueDate));
  const questionImageSrc = item.questionImageSrc ? escapeHtml(item.questionImageSrc) : null;
  const questionImageBlock = questionImageSrc
    ? `<img class="problem-image" src="${questionImageSrc}" alt="题目图片" />`
    : `<div class="image-fallback">题目图片暂时无法加载</div>`;

  return `
    <section class="problem-card">
      <h2 class="problem-title">第 ${questionNo} 题</h2>
      <div class="problem-meta">
        <span class="problem-meta-item">模块：${module}</span>
        <span class="problem-meta-item">标题：${title}</span>
        <span class="problem-meta-item">进度：${progressText}</span>
        <span class="problem-meta-item">难度：${difficultyText}</span>
        <span class="problem-meta-item">到期日：${dueDate}</span>
      </div>
      <div class="problem-label">我的题目：</div>
      <div class="problem-image-wrap">
        ${questionImageBlock}
      </div>
      <div class="write-block">
        <div class="answer-area">
          <div class="answer-title">我的解答：</div>
          <div class="answer-lines-fill" aria-hidden="true"></div>
        </div>
        <div class="result-area">
          <div class="result-title">本次结果：</div>
          <div class="result-options">
            <span class="result-option"><span class="checkbox"></span>会了</span>
            <span class="result-option"><span class="checkbox"></span>模糊</span>
            <span class="result-option"><span class="checkbox"></span>不会</span>
          </div>
        </div>
      </div>
    </section>
  `;
}

// Keep the previous fixed one-page template around while the print layout change settles.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function buildWorksheetPageHtml(
  item: TodayReviewPdfRenderItem,
  index: number,
  totalCount: number,
  dateString: string,
): string {
  const questionCardHtml = buildQuestionCardHtml(item, index);
  return `
    <section class="worksheet-page">
      <header class="sheet-header">
        <h1 class="sheet-title">七刷错题本 · 今日复做练习卷</h1>
        <p class="sheet-meta">日期：${escapeHtml(dateString)}　　共 ${totalCount} 道题</p>
        <p class="sheet-tip">请先独立完成，完成后由家长在 App 中录入结果。</p>
      </header>
      ${questionCardHtml}
      <footer class="footer">完成后请在 App 中录入：会了 / 模糊 / 不会</footer>
    </section>
  `;
}

function getImageRatio(size: PrintImageSize | null): number {
  if (!size || size.width <= 0 || size.height <= 0) {
    return 0.72;
  }
  return Math.max(0.1, Math.min(8, size.height / size.width));
}

function getSinglePageImageWidthRatio(imageRatio: number): number {
  if (imageRatio < 1.2) {
    return SINGLE_PAGE_IMAGE_WIDTH_RATIO_SHORT;
  }
  return SINGLE_PAGE_IMAGE_WIDTH_RATIO_MEDIUM;
}

function chooseQuestionPrintLayout(item: TodayReviewPdfRenderItem): QuestionPrintLayout {
  const ratio = getImageRatio(item.questionImageSize);
  const singlePageWidthMm = PDF_CONTENT_WIDTH_MM * getSinglePageImageWidthRatio(ratio);
  const singlePageEstimatedHeightMm = singlePageWidthMm * ratio;
  const singlePageMaxImageHeightMm = Math.max(
    80,
    PDF_CONTENT_HEIGHT_MM - SINGLE_PAGE_FIXED_HEIGHT_MM - ANSWER_MIN_HEIGHT_MM,
  );
  const singlePageRemainingAnswerSpaceMm =
    PDF_CONTENT_HEIGHT_MM - SINGLE_PAGE_FIXED_HEIGHT_MM - singlePageEstimatedHeightMm;

  if (!item.questionImageSize || singlePageRemainingAnswerSpaceMm >= ANSWER_MIN_HEIGHT_MM) {
    return {
      kind: 'single_page',
      ratio,
      imageDisplayWidthMm: singlePageWidthMm,
      imageMaxHeightMm: singlePageMaxImageHeightMm,
      estimatedImageHeightMm: singlePageEstimatedHeightMm,
      remainingAnswerSpaceMm: Math.max(0, singlePageRemainingAnswerSpaceMm),
    };
  }

  const twoPageWidthMm = PDF_CONTENT_WIDTH_MM * TWO_PAGE_IMAGE_WIDTH_RATIO;
  const twoPageEstimatedHeightMm = twoPageWidthMm * ratio;
  const twoPageMaxImageHeightMm = Math.max(
    120,
    PDF_CONTENT_HEIGHT_MM - TWO_PAGE_QUESTION_FIXED_HEIGHT_MM - THOUGHT_MIN_HEIGHT_MM,
  );
  const twoPageRemainingAnswerSpaceMm =
    PDF_CONTENT_HEIGHT_MM - TWO_PAGE_QUESTION_FIXED_HEIGHT_MM - twoPageEstimatedHeightMm;

  return {
    kind: 'question_answer_pages',
    ratio,
    imageDisplayWidthMm: twoPageWidthMm,
    imageMaxHeightMm: twoPageMaxImageHeightMm,
    estimatedImageHeightMm: twoPageEstimatedHeightMm,
    remainingAnswerSpaceMm: Math.max(0, twoPageRemainingAnswerSpaceMm),
  };
}

function formatMm(value: number): string {
  if (!Number.isFinite(value)) {
    return '0mm';
  }
  return `${Math.max(0, value).toFixed(1)}mm`;
}

function getFittedImageWidthMm(layout: QuestionPrintLayout): number {
  const widthByMaxHeight = layout.imageMaxHeightMm / Math.max(layout.ratio, 0.1);
  return Math.max(40, Math.min(layout.imageDisplayWidthMm, widthByMaxHeight));
}

function buildAutoQuestionMetaHtml(
  item: TodayReviewPdfRenderItem,
  index: number,
  totalCount: number,
  dateString: string,
  pageLabelHtml?: string,
): string {
  const questionNo = index + 1;
  const title = escapeHtml(toDisplayText(item.raw.title, '\u672A\u547D\u540D\u9898\u76EE'));
  const module = escapeHtml(toDisplayText(item.raw.module, '\u6A21\u5757\u672A\u77E5'));
  const progressText = escapeHtml(formatProgressText(item.raw));
  const difficultyText = escapeHtml(formatDifficultyText(item.raw.difficulty));
  const dueDate = escapeHtml(formatDueDateText(item.raw.dueDate));
  const pageLabel = pageLabelHtml
    ? `<span class="problem-page-label">${pageLabelHtml}</span>`
    : '';

  return `
    <div class="problem-heading">
      <h2 class="problem-title">&#31532; ${questionNo} &#39064;</h2>
      ${pageLabel}
      <span class="sheet-summary">${escapeHtml(dateString)} &#183; ${totalCount} &#39064;</span>
    </div>
    <div class="problem-meta">
      <span class="problem-meta-item">&#27169;&#22359;&#65306;${module}</span>
      <span class="problem-meta-item">&#26631;&#39064;&#65306;${title}</span>
      <span class="problem-meta-item">&#36827;&#24230;&#65306;${progressText}</span>
      <span class="problem-meta-item">&#38590;&#24230;&#65306;${difficultyText}</span>
      <span class="problem-meta-item">&#21040;&#26399;&#26085;&#65306;${dueDate}</span>
    </div>
  `;
}

function buildAutoQuestionImageHtml(item: TodayReviewPdfRenderItem, layout: QuestionPrintLayout): string {
  const questionImageSrc = item.questionImageSrc ? escapeHtml(item.questionImageSrc) : null;
  const imageWidthMm = getFittedImageWidthMm(layout);
  const imageMaxHeightMm = Math.min(layout.imageMaxHeightMm, imageWidthMm * layout.ratio);
  const imageStyle = [
    `width: ${formatMm(imageWidthMm)}`,
    `max-height: ${formatMm(imageMaxHeightMm)}`,
    'height: auto',
  ].join('; ');
  const imageBlock = questionImageSrc
    ? `<img class="problem-image" style="${imageStyle}" src="${questionImageSrc}" alt="question image" />`
    : `<div class="image-fallback">&#39064;&#30446;&#22270;&#29255;&#26242;&#26102;&#26080;&#27861;&#21152;&#36733;</div>`;

  return `
    <div class="problem-label">&#25105;&#30340;&#39064;&#30446;&#65306;</div>
    <div class="problem-image-wrap">
      ${imageBlock}
    </div>
  `;
}

function buildAnswerLinesHtml(minHeightMm: number): string {
  return `<div class="answer-lines-fill" style="min-height: ${formatMm(minHeightMm)}" aria-hidden="true"></div>`;
}

function buildResultAreaHtml(): string {
  return `
    <div class="result-area">
      <div class="result-title">&#26412;&#27425;&#32467;&#26524;&#65306;</div>
      <div class="result-options">
        <span class="result-option"><span class="checkbox"></span>&#20250;&#20102;</span>
        <span class="result-option"><span class="checkbox"></span>&#27169;&#31946;</span>
        <span class="result-option"><span class="checkbox"></span>&#19981;&#20250;</span>
      </div>
    </div>
  `;
}

function buildAutoSingleQuestionPageHtml(
  item: TodayReviewPdfRenderItem,
  index: number,
  totalCount: number,
  dateString: string,
  layout: QuestionPrintLayout,
): string {
  return `
    <section class="worksheet-page worksheet-page-single">
      <section class="problem-card">
        ${buildAutoQuestionMetaHtml(item, index, totalCount, dateString)}
        ${buildAutoQuestionImageHtml(item, layout)}
        <div class="answer-area">
          <div class="answer-title">&#25105;&#30340;&#35299;&#31572;&#65306;</div>
          ${buildAnswerLinesHtml(ANSWER_MIN_HEIGHT_MM)}
        </div>
        ${buildResultAreaHtml()}
      </section>
      <footer class="footer">&#20248;&#20808;&#20445;&#35777;&#39064;&#22270;&#28165;&#26224;</footer>
    </section>
  `;
}

function buildAutoQuestionOnlyPageHtml(
  item: TodayReviewPdfRenderItem,
  index: number,
  totalCount: number,
  dateString: string,
  layout: QuestionPrintLayout,
): string {
  return `
    <section class="worksheet-page worksheet-page-question">
      <section class="problem-card">
        ${buildAutoQuestionMetaHtml(item, index, totalCount, dateString, '&#39064;&#30446;&#39029;')}
        ${buildAutoQuestionImageHtml(item, layout)}
        <div class="answer-area thought-area">
          <div class="answer-title">&#25105;&#30340;&#24605;&#36335;&#65306;</div>
          ${buildAnswerLinesHtml(THOUGHT_MIN_HEIGHT_MM)}
        </div>
      </section>
      <footer class="footer">&#35299;&#31572;&#21306;&#22312;&#19979;&#19968;&#39029;</footer>
    </section>
  `;
}

function buildAutoAnswerPageHtml(
  item: TodayReviewPdfRenderItem,
  index: number,
  totalCount: number,
  dateString: string,
): string {
  const answerLinesHeightMm = Math.max(
    ANSWER_MIN_HEIGHT_MM,
    PDF_CONTENT_HEIGHT_MM - ANSWER_PAGE_FIXED_HEIGHT_MM - RESULT_AREA_HEIGHT_MM,
  );

  return `
    <section class="worksheet-page worksheet-page-answer">
      <section class="problem-card">
        ${buildAutoQuestionMetaHtml(item, index, totalCount, dateString, '&#35299;&#31572;&#39029;')}
        <div class="answer-area">
          <div class="answer-title">&#25105;&#30340;&#35299;&#31572;&#65306;</div>
          ${buildAnswerLinesHtml(answerLinesHeightMm)}
        </div>
        ${buildResultAreaHtml()}
      </section>
    </section>
  `;
}

function buildAutoWorksheetPageHtml(
  item: TodayReviewPdfRenderItem,
  index: number,
  totalCount: number,
  dateString: string,
): string {
  const layout = chooseQuestionPrintLayout(item);
  Logger.info(SERVICE_SCOPE, 'pdf_export_question_layout_selected', {
    mistakeId: item.raw.mistakeId,
    layout: layout.kind,
    imageWidth: item.questionImageSize?.width ?? null,
    imageHeight: item.questionImageSize?.height ?? null,
    ratio: layout.ratio,
    imageDisplayWidthMm: layout.imageDisplayWidthMm,
    imageMaxHeightMm: layout.imageMaxHeightMm,
    estimatedImageHeightMm: layout.estimatedImageHeightMm,
    remainingAnswerSpaceMm: layout.remainingAnswerSpaceMm,
  });

  if (layout.kind === 'single_page') {
    return buildAutoSingleQuestionPageHtml(item, index, totalCount, dateString, layout);
  }

  return [
    buildAutoQuestionOnlyPageHtml(item, index, totalCount, dateString, layout),
    buildAutoAnswerPageHtml(item, index, totalCount, dateString),
  ].join('\n');
}

function buildPdfHtml(
  items: TodayReviewPdfRenderItem[],
  dateString: string,
  imageFilterCss: string | null,
  totalCount = items.length,
  questionNumberOffset = 0,
  onPageProgress?: (progress: BuildItemsProgress) => void,
): string {
  const total = items.length;
  const pageHtmlList: string[] = [];

  for (let index = 0; index < total; index += 1) {
    const item = items[index];
    pageHtmlList.push(buildAutoWorksheetPageHtml(item, questionNumberOffset + index, totalCount, dateString));
    if (onPageProgress) {
      onPageProgress({
        current: index + 1,
        total,
      });
    }
  }

  const pagesHtml = pageHtmlList.join('\n');
  const imageFilterStyle = imageFilterCss ? `filter: ${imageFilterCss};` : '';

  return `
    <!DOCTYPE html>
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>七刷错题本今日复做练习卷</title>
        <style>
          @page {
            size: A4;
            margin: ${PDF_PAGE_MARGIN_MM}mm ${PDF_PAGE_MARGIN_MM}mm;
          }
          * {
            box-sizing: border-box;
          }
          body {
            margin: 0;
            padding: 0;
            color: #111111;
            font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", Arial, sans-serif;
            font-size: 14px;
            line-height: 1.5;
          }
          .sheet {
            width: 100%;
          }
          .worksheet-page {
            min-height: calc(${A4_HEIGHT_MM}mm - ${PDF_PAGE_MARGIN_MM * 2}mm);
            display: flex;
            flex-direction: column;
            page-break-after: always;
            break-after: page;
          }
          .worksheet-page:last-of-type {
            page-break-after: auto;
            break-after: auto;
          }
          .sheet-header {
            border: 1px solid #dddddd;
            border-radius: 10px;
            padding: 14px 18px;
            margin-bottom: 12px;
            page-break-after: avoid;
            break-after: avoid;
            flex-shrink: 0;
          }
          .sheet-title {
            font-size: 22px;
            font-weight: 800;
            margin: 0 0 8px 0;
          }
          .sheet-meta {
            font-size: 14px;
            color: #222222;
            margin: 0;
          }
          .sheet-tip {
            margin: 8px 0 0 0;
            font-size: 13px;
            color: #555555;
          }
          .problem-card {
            border: 1px solid #dddddd;
            border-radius: 10px;
            padding: 14px 16px;
            margin-bottom: 0;
            page-break-inside: avoid;
            break-inside: avoid;
            display: flex;
            flex-direction: column;
            flex: 1 1 auto;
            min-height: 0;
          }
          .problem-title {
            font-size: 18px;
            font-weight: 800;
            margin: 0 0 8px 0;
          }
          .problem-heading {
            display: flex;
            align-items: baseline;
            gap: 8px 12px;
            flex-wrap: wrap;
            margin-bottom: 6px;
          }
          .problem-heading .problem-title {
            margin: 0;
          }
          .problem-page-label {
            border: 1px solid #333333;
            border-radius: 999px;
            padding: 1px 8px;
            font-size: 12px;
            font-weight: 700;
            color: #111111;
          }
          .sheet-summary {
            margin-left: auto;
            font-size: 12px;
            color: #666666;
          }
          .problem-meta {
            display: flex;
            flex-wrap: wrap;
            gap: 4px 16px;
            margin-bottom: 10px;
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .problem-meta-item {
            font-size: 13px;
            color: #333333;
            white-space: nowrap;
          }
          .problem-label {
            font-size: 14px;
            font-weight: 700;
            margin-bottom: 8px;
          }
          .problem-image-wrap {
            text-align: center;
            margin: 10px 0 14px 0;
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .problem-image {
            display: block;
            max-width: 100%;
            max-height: 320px;
            object-fit: contain;
            margin: 0 auto;
            border: 1px solid #dddddd;
            border-radius: 8px;
            ${imageFilterStyle}
          }
          .image-fallback {
            min-height: 140px;
            border: 1px dashed #c8c8c8;
            border-radius: 8px;
            color: #666666;
            font-size: 14px;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 10px;
            text-align: center;
          }
          .write-block {
            page-break-inside: avoid;
            break-inside: avoid;
            display: flex;
            flex-direction: column;
            flex: 1 1 auto;
            min-height: 0;
          }
          .answer-area {
            margin-top: 12px;
            display: flex;
            flex-direction: column;
            flex: 1 1 auto;
            min-height: 0;
          }
          .answer-title {
            font-weight: 700;
            margin-bottom: 8px;
          }
          .answer-lines-fill {
            flex: 1 1 auto;
            min-height: 140px;
            position: relative;
            --answer-rule-color: #666666;
            --answer-row-gap: 9mm;
            --answer-center-gap: 8px;
          }
          .answer-lines-fill::before {
            content: "";
            position: absolute;
            top: 0;
            bottom: 0;
            left: 50%;
            width: 1px;
            background: #333333;
            transform: translateX(-0.5px);
          }
          .answer-lines-fill::after {
            content: "";
            position: absolute;
            inset: 0;
            background-image:
              repeating-linear-gradient(
                to bottom,
                transparent 0,
                transparent calc(var(--answer-row-gap) - 1px),
                var(--answer-rule-color) calc(var(--answer-row-gap) - 1px),
                var(--answer-rule-color) var(--answer-row-gap)
              ),
              repeating-linear-gradient(
                to bottom,
                transparent 0,
                transparent calc(var(--answer-row-gap) - 1px),
                var(--answer-rule-color) calc(var(--answer-row-gap) - 1px),
                var(--answer-rule-color) var(--answer-row-gap)
              );
            background-size:
              calc(50% - var(--answer-center-gap)) 100%,
              calc(50% - var(--answer-center-gap)) 100%;
            background-position: left top, right top;
            background-repeat: no-repeat;
          }
          .result-area {
            margin-top: auto;
            padding-top: 10px;
            font-size: 15px;
            flex-shrink: 0;
          }
          .result-title {
            font-weight: 700;
            margin-bottom: 6px;
          }
          .result-options {
            display: flex;
            gap: 28px;
            align-items: center;
            flex-wrap: wrap;
          }
          .result-option {
            white-space: nowrap;
          }
          .checkbox {
            display: inline-block;
            width: 12px;
            height: 12px;
            border: 1.5px solid #333333;
            margin-right: 6px;
            vertical-align: -1px;
          }
          .footer {
            margin-top: 12px;
            text-align: center;
            font-size: 11px;
            color: #777777;
            page-break-inside: avoid;
            break-inside: avoid;
            flex-shrink: 0;
          }
        </style>
      </head>
      <body>
        <main class="sheet">
          ${pagesHtml}
        </main>
      </body>
    </html>
  `;
}

async function yieldToUiFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function buildSingleRenderItem(
  item: TodayReviewExportItem,
  printEnhanceMode: PrintEnhanceMode,
  clearPrintStrength: PrintEnhanceClearPrintStrength,
  performanceProfile: PrintEnhancePerformanceProfile,
): Promise<RenderItemBuildResult> {
  const questionImageUri = normalizeOptionalText(item.questionImageUri);
  const imageResult = questionImageUri
    ? await buildQuestionImageSrc(
      questionImageUri,
      printEnhanceMode,
      clearPrintStrength,
      performanceProfile,
    )
    : {
      imageDataUri: null,
      imageSize: null,
      temporaryEnhancedUri: null,
      trace: null,
      base64ReadDurationMs: 0,
      base64ReadAttemptCount: 0,
    };

  if (imageResult.trace) {
    Logger.info(SERVICE_SCOPE, 'pdf_export_question_image_enhance_trace', {
      mistakeId: item.mistakeId,
      printEnhanceMode: imageResult.trace.mode,
      clearPrintStrength: imageResult.trace.clearPrintStrength,
      performanceProfile: imageResult.trace.performanceProfile,
      enhanceEngine: imageResult.trace.engine,
      outputFormat: imageResult.trace.outputFormat,
      enhanceSuccess: imageResult.trace.success,
      enhanceUsedFallback: imageResult.trace.usedFallback,
      cacheStatus: imageResult.trace.cacheStatus,
      enhanceDurationMs: imageResult.trace.durationMs,
      base64ReadDurationMs: imageResult.base64ReadDurationMs,
      base64ReadAttemptCount: imageResult.base64ReadAttemptCount,
      sourceUriPreview: toSafeUriPreview(imageResult.trace.sourceUri),
      enhancedUriPreview: toSafeUriPreview(imageResult.trace.enhancedUri),
      selectedUriPreview: toSafeUriPreview(imageResult.trace.selectedUri),
      hasImageData: imageResult.imageDataUri !== null,
    });
  } else {
    Logger.info(SERVICE_SCOPE, 'pdf_export_question_image_missing', {
      mistakeId: item.mistakeId,
    });
  }

  return {
    renderItem: {
      raw: item,
      questionImageSrc: imageResult.imageDataUri,
      questionImageSize: imageResult.imageSize,
    },
    temporaryEnhancedUri: imageResult.temporaryEnhancedUri,
    enhanceDurationMs: imageResult.trace ? Math.max(0, imageResult.trace.durationMs) : 0,
    base64ReadDurationMs: Math.max(0, imageResult.base64ReadDurationMs),
    base64ReadAttemptCount: Math.max(0, imageResult.base64ReadAttemptCount),
    processedImageItemCount: imageResult.trace ? 1 : 0,
  };
}

async function buildRenderItems(
  items: TodayReviewExportItem[],
  printEnhanceMode: PrintEnhanceMode,
  clearPrintStrength: PrintEnhanceClearPrintStrength,
  performanceProfile: PrintEnhancePerformanceProfile,
  enhanceConcurrency: PrintEnhanceConcurrency,
  onItemProcessed?: (progress: BuildItemsProgress) => void,
): Promise<BuildRenderItemsResult> {
  const renderItems: (TodayReviewPdfRenderItem | null)[] = new Array(items.length).fill(null);
  const temporaryEnhancedUris: string[] = [];
  const total = items.length;
  if (total <= 0) {
    return {
      renderItems: [],
      temporaryEnhancedUris,
      processMetrics: {
        processedImageItemCount: 0,
        enhanceDurationTotalMs: 0,
        base64ReadDurationTotalMs: 0,
        base64ReadAttemptTotalCount: 0,
        enhanceDurationMaxMs: 0,
        base64ReadDurationMaxMs: 0,
      },
    };
  }

  const workerCount = Math.min(total, toActivePrintEnhanceConcurrency(enhanceConcurrency));
  let nextIndex = 0;
  let completedCount = 0;
  let processedImageItemCount = 0;
  let enhanceDurationTotalMs = 0;
  let base64ReadDurationTotalMs = 0;
  let base64ReadAttemptTotalCount = 0;
  let enhanceDurationMaxMs = 0;
  let base64ReadDurationMaxMs = 0;

  const runWorker = async () => {
    while (true) {
      const index = nextIndex;
      if (index >= total) {
        break;
      }
      nextIndex += 1;
      const item = items[index];
      const built = await buildSingleRenderItem(
        item,
        printEnhanceMode,
        clearPrintStrength,
        performanceProfile,
      );
      renderItems[index] = built.renderItem;
      if (built.temporaryEnhancedUri) {
        temporaryEnhancedUris.push(built.temporaryEnhancedUri);
      }
      processedImageItemCount += built.processedImageItemCount;
      enhanceDurationTotalMs += built.enhanceDurationMs;
      base64ReadDurationTotalMs += built.base64ReadDurationMs;
      base64ReadAttemptTotalCount += built.base64ReadAttemptCount;
      enhanceDurationMaxMs = Math.max(enhanceDurationMaxMs, built.enhanceDurationMs);
      base64ReadDurationMaxMs = Math.max(base64ReadDurationMaxMs, built.base64ReadDurationMs);
      completedCount += 1;
      if (onItemProcessed) {
        onItemProcessed({
          current: completedCount,
          total,
        });
      }
      await yieldToUiFrame();
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  return {
    renderItems: renderItems.map((item, index) => item ?? {
      raw: items[index],
      questionImageSrc: null,
      questionImageSize: null,
    }),
    temporaryEnhancedUris,
      processMetrics: {
        processedImageItemCount,
        enhanceDurationTotalMs,
        base64ReadDurationTotalMs,
        base64ReadAttemptTotalCount,
        enhanceDurationMaxMs,
        base64ReadDurationMaxMs,
      },
  };
}

async function persistPdfToDocumentDirectory(
  generatedPdfUri: string,
  exportFileName: string,
): Promise<string> {
  const exportDirectory = new Directory(Paths.document, EXPORT_DIR_NAME, EXPORT_SUB_DIR_NAME);
  exportDirectory.create({ intermediates: true, idempotent: true });

  const exportedFile = new File(exportDirectory, exportFileName);
  if (exportedFile.exists) {
    exportedFile.delete();
  }

  const generatedFile = new File(generatedPdfUri);
  generatedFile.copy(exportedFile);

  return exportedFile.uri;
}

export async function exportTodayReviewPdf(
  options?: ExportTodayReviewPdfOptions,
): Promise<ExportTodayReviewPdfResult> {
  const onProgress = options?.onProgress;
  const exportStartedAt = Date.now();
  const stageTiming = {
    prepareItemsMs: 0,
    processImagesMs: 0,
    buildHtmlMs: 0,
    printPdfMs: 0,
    savePdfMs: 0,
  };
  const processImageMetrics: BuildRenderItemsProcessMetrics = {
    processedImageItemCount: 0,
    enhanceDurationTotalMs: 0,
    base64ReadDurationTotalMs: 0,
    base64ReadAttemptTotalCount: 0,
    enhanceDurationMaxMs: 0,
    base64ReadDurationMaxMs: 0,
  };
  let exportOutcome: 'success' | 'empty' | 'generate_failed' | 'busy' | 'unknown' = 'unknown';
  let exportFailureReason: string | null = null;
  let exportItemCount = 0;
  let exportFileUriPreview: string | null = null;

  if (isExportInProgress) {
    Logger.warn(SERVICE_SCOPE, 'Skip export because another export/share flow is in progress.', {
      date: options?.date ?? null,
    });
    exportOutcome = 'busy';
    exportFailureReason = 'busy';
    return {
      success: false,
      reason: 'busy',
      message: EXPORT_BUSY_MESSAGE,
    };
  }

  isExportInProgress = true;
  const baseDate = resolveBaseDate(options?.date);
  const dateString = toDateOnlyString(baseDate);
  const temporaryEnhancedUris: string[] = [];
  const activePrintEnhanceMode = toActivePrintEnhanceMode(
    options?.printEnhanceMode ?? DEFAULT_EXPORT_PRINT_ENHANCE_MODE,
  );
  const activeClearPrintStrength = toActiveClearPrintStrength(
    options?.printEnhanceClearPrintStrength ?? DEFAULT_CLEAR_PRINT_STRENGTH,
  );
  const activePerformanceProfile = toActivePrintEnhancePerformanceProfile(
    options?.printEnhancePerformanceProfile ?? DEFAULT_PRINT_ENHANCE_PERFORMANCE_PROFILE,
  );
  const configuredEnhanceConcurrency = toActivePrintEnhanceConcurrency(
    options?.printEnhanceConcurrency ?? DEFAULT_PRINT_ENHANCE_CONCURRENCY,
  );
  const activeEnhanceConcurrency = activePrintEnhanceMode === 'clear_print'
    ? configuredEnhanceConcurrency
    : 1;
  const imageFilterCss = getPrintEnhanceCssFilter(activePrintEnhanceMode);
  Logger.info(SERVICE_SCOPE, 'export_pdf_start_context', {
    requestedDate: options?.date ?? null,
    resolvedDate: dateString,
    printEnhanceMode: activePrintEnhanceMode,
    clearPrintStrength: activeClearPrintStrength,
    performanceProfile: activePerformanceProfile,
    configuredEnhanceConcurrency,
    activeEnhanceConcurrency,
  });

  try {
    const prepareStartedAt = Date.now();
    reportExportProgress(onProgress, {
      stage: 'prepare_items',
      current: 0,
      total: 0,
    });
    const exportItems = await getTodayReviewExportItems(options?.date);
    exportItemCount = exportItems.length;
    stageTiming.prepareItemsMs = Math.max(0, Date.now() - prepareStartedAt);
    Logger.info(SERVICE_SCOPE, 'export_pdf_items_loaded', {
      itemCount: exportItems.length,
      sampleItems: summarizeExportItems(exportItems),
    });
    if (exportItems.length <= 0) {
      exportOutcome = 'empty';
      exportFailureReason = 'empty';
      return {
        success: false,
        reason: 'empty',
        message: EMPTY_MESSAGE,
        exportedCount: 0,
      };
    }

    reportExportProgress(onProgress, {
      stage: 'prepare_items',
      current: 0,
      total: exportItems.length,
    });
    const itemsPerPdfFile = getExportItemsPerPdfFile();
    const pdfItemChunks = chunkExportItems(exportItems, itemsPerPdfFile);
    const pdfPartCount = pdfItemChunks.length;
    const exportRunStartedAt = new Date();
    const exportedFileUris: string[] = [];
    const exportedPdfSizeBytesList: (number | null)[] = [];
    let processedItemOffset = 0;
    Logger.info(SERVICE_SCOPE, 'export_pdf_batch_plan', {
      itemCount: exportItems.length,
      itemsPerPdfFile,
      pdfPartCount,
    });

    for (let partIndex = 0; partIndex < pdfItemChunks.length; partIndex += 1) {
      const partItems = pdfItemChunks[partIndex];
      const partNumber = partIndex + 1;
      const partProgressLabel = pdfPartCount > 1 ? `（第 ${partNumber}/${pdfPartCount} 个 PDF）` : '';
      const processStartedAt = Date.now();
      const renderResult = await buildRenderItems(
        partItems,
        activePrintEnhanceMode,
        activeClearPrintStrength,
        activePerformanceProfile,
        activeEnhanceConcurrency,
        ({ current }) => {
          const globalCurrent = processedItemOffset + current;
          reportExportProgress(onProgress, {
            stage: 'process_images',
            current: globalCurrent,
            total: exportItems.length,
            itemCount: exportItems.length,
            message: pdfPartCount > 1
              ? `处理图片 ${Math.max(0, Math.min(globalCurrent, exportItems.length))} / ${exportItems.length}${partProgressLabel}`
              : undefined,
          });
        },
      );
      stageTiming.processImagesMs += Math.max(0, Date.now() - processStartedAt);
      processImageMetrics.processedImageItemCount += renderResult.processMetrics.processedImageItemCount;
      processImageMetrics.enhanceDurationTotalMs += renderResult.processMetrics.enhanceDurationTotalMs;
      processImageMetrics.base64ReadDurationTotalMs += renderResult.processMetrics.base64ReadDurationTotalMs;
      processImageMetrics.base64ReadAttemptTotalCount += renderResult.processMetrics.base64ReadAttemptTotalCount;
      processImageMetrics.enhanceDurationMaxMs = Math.max(
        processImageMetrics.enhanceDurationMaxMs,
        renderResult.processMetrics.enhanceDurationMaxMs,
      );
      processImageMetrics.base64ReadDurationMaxMs = Math.max(
        processImageMetrics.base64ReadDurationMaxMs,
        renderResult.processMetrics.base64ReadDurationMaxMs,
      );
      temporaryEnhancedUris.push(...renderResult.temporaryEnhancedUris);
      const renderItemCount = renderResult.renderItems.length;
      const withImageDataCount = renderResult.renderItems.filter((item) => item.questionImageSrc !== null).length;
      const withoutImageDataCount = Math.max(0, renderItemCount - withImageDataCount);
      Logger.info(SERVICE_SCOPE, 'export_pdf_render_items_summary', {
        partNumber,
        pdfPartCount,
        questionNumberStart: processedItemOffset + 1,
        questionNumberEnd: processedItemOffset + partItems.length,
        renderItemCount,
        withImageDataCount,
        withoutImageDataCount,
        temporaryEnhancedCount: renderResult.temporaryEnhancedUris.length,
      });
      const buildHtmlStartedAt = Date.now();
      const html = buildPdfHtml(
        renderResult.renderItems,
        dateString,
        imageFilterCss,
        exportItems.length,
        processedItemOffset,
        ({ current }) => {
          const globalCurrent = processedItemOffset + current;
          reportExportProgress(onProgress, {
            stage: 'generate_pdf',
            current: globalCurrent,
            total: exportItems.length,
            itemCount: exportItems.length,
            message: pdfPartCount > 1
              ? `生成 PDF 页面 ${Math.max(0, Math.min(globalCurrent, exportItems.length))} / ${exportItems.length}${partProgressLabel}`
              : undefined,
          });
        },
      );
      stageTiming.buildHtmlMs += Math.max(0, Date.now() - buildHtmlStartedAt);
      Logger.info(SERVICE_SCOPE, 'export_pdf_html_built', {
        partNumber,
        pdfPartCount,
        htmlLength: html.length,
        pageMarkerCount: countWorksheetPagesInHtml(html),
      });

      let generatedPdfUri = '';
      try {
        reportExportProgress(onProgress, {
          stage: 'generate_pdf',
          current: processedItemOffset + partItems.length,
          total: exportItems.length,
          itemCount: exportItems.length,
          message: pdfPartCount > 1
            ? `正在生成练习卷 PDF${partProgressLabel}...`
            : '正在生成练习卷 PDF...',
        });
        const printStartedAt = Date.now();
        const printResult = await Print.printToFileAsync({
          html,
          width: 595,
          height: 842,
        });
        generatedPdfUri = printResult.uri;
        stageTiming.printPdfMs += Math.max(0, Date.now() - printStartedAt);
        const generatedPdfSizeBytes = getFileSizeBytes(generatedPdfUri);
        Logger.info(SERVICE_SCOPE, 'export_pdf_generated_file', {
          partNumber,
          pdfPartCount,
          generatedPdfUriPreview: toSafeUriPreview(generatedPdfUri),
          generatedPdfSizeBytes,
        });

        if (
          partItems.length > 0
          && generatedPdfSizeBytes !== null
          && generatedPdfSizeBytes > 0
          && generatedPdfSizeBytes < SUSPICIOUS_PDF_SIZE_BYTES
        ) {
          Logger.warn(SERVICE_SCOPE, 'Generated PDF is suspiciously small, retry with fallback html.', {
            partNumber,
            pdfPartCount,
            generatedPdfSizeBytes,
            thresholdBytes: SUSPICIOUS_PDF_SIZE_BYTES,
            itemCount: partItems.length,
          });
          const fallbackHtml = buildFallbackPdfHtml(
            renderResult.renderItems,
            dateString,
            exportItems.length,
            processedItemOffset,
          );
          const fallbackPrintStartedAt = Date.now();
          const fallbackPrintResult = await Print.printToFileAsync({
            html: fallbackHtml,
            width: 595,
            height: 842,
          });
          generatedPdfUri = fallbackPrintResult.uri;
          stageTiming.printPdfMs += Math.max(0, Date.now() - fallbackPrintStartedAt);
          Logger.info(SERVICE_SCOPE, 'export_pdf_fallback_generated_file', {
            partNumber,
            pdfPartCount,
            generatedPdfUriPreview: toSafeUriPreview(generatedPdfUri),
            generatedPdfSizeBytes: getFileSizeBytes(generatedPdfUri),
            fallbackHtmlLength: fallbackHtml.length,
          });
        }
      } catch (error) {
        exportOutcome = 'generate_failed';
        exportFailureReason = 'print_to_file_failed';
        Logger.error(SERVICE_SCOPE, 'Failed to generate export PDF with expo-print.', {
          date: options?.date ?? null,
          partNumber,
          pdfPartCount,
          itemCount: partItems.length,
          stageTiming,
          error,
        });
        return {
          success: false,
          reason: 'generate_failed',
          message: FALLBACK_EXPORT_ERROR_MESSAGE,
          exportedCount: processedItemOffset,
          fileUri: exportedFileUris[0],
          fileUris: exportedFileUris,
          pdfPartCount,
        };
      }

      const exportFileName = buildExportFileName(dateString, exportRunStartedAt, partNumber, pdfPartCount);
      reportExportProgress(onProgress, {
        stage: 'save_pdf',
        current: processedItemOffset + partItems.length,
        total: exportItems.length,
        itemCount: exportItems.length,
        message: pdfPartCount > 1
          ? `正在保存 PDF ${partNumber} / ${pdfPartCount}...`
          : undefined,
      });
      const saveStartedAt = Date.now();
      const exportedFileUri = await persistPdfToDocumentDirectory(generatedPdfUri, exportFileName);
      stageTiming.savePdfMs += Math.max(0, Date.now() - saveStartedAt);
      exportedFileUris.push(exportedFileUri);
      exportFileUriPreview = toSafeUriPreview(exportedFileUri);
      const exportedPdfSizeBytes = getFileSizeBytes(exportedFileUri);
      exportedPdfSizeBytesList.push(exportedPdfSizeBytes);
      Logger.info(SERVICE_SCOPE, 'export_pdf_part_saved', {
        partNumber,
        pdfPartCount,
        questionNumberStart: processedItemOffset + 1,
        questionNumberEnd: processedItemOffset + partItems.length,
        fileUriPreview: exportFileUriPreview,
        exportedPdfSizeBytes,
      });
      processedItemOffset += partItems.length;
      await yieldToUiFrame();
    }

    const exportedFileUri = exportedFileUris[0] ?? '';
    exportOutcome = 'success';
    Logger.info(SERVICE_SCOPE, 'Today review PDF exported successfully.', {
      date: dateString,
      exportedCount: exportItems.length,
      pdfPartCount,
      itemsPerPdfFile,
      fileUriPreview: toSafeUriPreview(exportedFileUri),
      fileUriPreviews: exportedFileUris.map(toSafeUriPreview),
      exportedPdfSizeBytesList,
      printEnhanceMode: activePrintEnhanceMode,
      clearPrintStrength: activeClearPrintStrength,
      performanceProfile: activePerformanceProfile,
      enhanceConcurrency: activeEnhanceConcurrency,
      configuredEnhanceConcurrency,
      enhancedImageCount: temporaryEnhancedUris.length,
    });

    return {
      success: true,
      fileUri: exportedFileUri,
      fileUris: exportedFileUris,
      exportedCount: exportItems.length,
      pdfPartCount,
    };
  } catch (error) {
    exportOutcome = 'unknown';
    exportFailureReason = 'unexpected_error';
    Logger.error(SERVICE_SCOPE, 'Unexpected error in exportTodayReviewPdf.', {
      date: options?.date ?? null,
      stageTiming,
      error,
    });
    return {
      success: false,
      reason: 'unknown',
      message: FALLBACK_EXPORT_ERROR_MESSAGE,
    };
  } finally {
    const totalDurationMs = Math.max(0, Date.now() - exportStartedAt);
    const processImagesKnownAccumulatedMs =
      processImageMetrics.enhanceDurationTotalMs + processImageMetrics.base64ReadDurationTotalMs;
    const processImagesKnownPerItemMs = processImageMetrics.processedImageItemCount > 0
      ? processImagesKnownAccumulatedMs / processImageMetrics.processedImageItemCount
      : 0;
    const enhancePerItemMs = processImageMetrics.processedImageItemCount > 0
      ? processImageMetrics.enhanceDurationTotalMs / processImageMetrics.processedImageItemCount
      : 0;
    const base64PerItemMs = processImageMetrics.processedImageItemCount > 0
      ? processImageMetrics.base64ReadDurationTotalMs / processImageMetrics.processedImageItemCount
      : 0;
    Logger.info(SERVICE_SCOPE, 'export_pdf_stage_timing_summary', {
      date: dateString,
      outcome: exportOutcome,
      failureReason: exportFailureReason,
      itemCount: exportItemCount,
      printEnhanceMode: activePrintEnhanceMode,
      clearPrintStrength: activeClearPrintStrength,
      performanceProfile: activePerformanceProfile,
      enhanceConcurrency: activeEnhanceConcurrency,
      configuredEnhanceConcurrency,
      prepareItemsMs: stageTiming.prepareItemsMs,
      processImagesMs: stageTiming.processImagesMs,
      processImagesProcessedImageItemCount: processImageMetrics.processedImageItemCount,
      processImagesEnhanceDurationAccumulatedMs: processImageMetrics.enhanceDurationTotalMs,
      processImagesBase64ReadDurationAccumulatedMs: processImageMetrics.base64ReadDurationTotalMs,
      processImagesBase64ReadAttemptTotalCount: processImageMetrics.base64ReadAttemptTotalCount,
      processImagesEnhanceDurationMaxMs: processImageMetrics.enhanceDurationMaxMs,
      processImagesBase64ReadDurationMaxMs: processImageMetrics.base64ReadDurationMaxMs,
      processImagesKnownAccumulatedMs,
      processImagesKnownPerItemMs,
      processImagesEnhancePerItemMs: enhancePerItemMs,
      processImagesBase64ReadPerItemMs: base64PerItemMs,
      processImagesAccumulatedMinusWallMs: processImagesKnownAccumulatedMs - stageTiming.processImagesMs,
      buildHtmlMs: stageTiming.buildHtmlMs,
      printPdfMs: stageTiming.printPdfMs,
      savePdfMs: stageTiming.savePdfMs,
      totalDurationMs,
      fileUriPreview: exportFileUriPreview,
    });
    if (temporaryEnhancedUris.length > 0) {
      cleanupPrintEnhancedTempFiles(temporaryEnhancedUris);
    }
    isExportInProgress = false;
  }
}

export async function shareTodayReviewPdf(fileUri: string): Promise<ShareTodayReviewPdfResult> {
  const normalizedUri = normalizeOptionalText(fileUri);
  if (!normalizedUri) {
    return {
      success: false,
      reason: 'invalid_uri',
      message: INVALID_PDF_URI_MESSAGE,
    };
  }

  const file = new File(normalizedUri);
  if (!file.exists) {
    return {
      success: false,
      reason: 'file_missing',
      message: MISSING_PDF_FILE_MESSAGE,
    };
  }

  const isShareAvailable = await Sharing.isAvailableAsync();
  if (!isShareAvailable) {
    return {
      success: false,
      reason: 'share_unavailable',
      message: SHARE_UNAVAILABLE_MESSAGE,
    };
  }

  try {
    await Sharing.shareAsync(normalizedUri, {
      mimeType: PDF_MIME_TYPE,
      dialogTitle: SHARE_DIALOG_TITLE,
    });
    return {
      success: true,
    };
  } catch (error) {
    if (isShareBusyError(error)) {
      return {
        success: false,
        reason: 'busy',
        message: EXPORT_BUSY_MESSAGE,
      };
    }

    if (isUserCancelledShare(error)) {
      return {
        success: false,
        reason: 'cancelled',
        message: '',
      };
    }

    Logger.error(SERVICE_SCOPE, 'Failed to share today review PDF.', {
      fileUriPreview: toSafeUriPreview(normalizedUri),
      error,
    });
    return {
      success: false,
      reason: 'unknown',
      message: FALLBACK_EXPORT_ERROR_MESSAGE,
    };
  }
}

export async function openTodayReviewPdfWithOtherApp(
  fileUri: string,
): Promise<OpenTodayReviewPdfWithOtherAppResult> {
  const normalizedUri = normalizeOptionalText(fileUri);
  if (!normalizedUri) {
    return {
      success: false,
      reason: 'invalid_uri',
      message: INVALID_PDF_URI_MESSAGE,
    };
  }

  const file = new File(normalizedUri);
  if (!file.exists) {
    return {
      success: false,
      reason: 'file_missing',
      message: MISSING_PDF_FILE_MESSAGE,
    };
  }

  try {
    if (Platform.OS === 'android') {
      const filePath = toAndroidFilePath(normalizedUri);
      await ReactNativeBlobUtil.android.actionViewIntent(
        filePath,
        PDF_MIME_TYPE,
        OPEN_WITH_OTHER_APP_DIALOG_TITLE,
      );
      return {
        success: true,
      };
    }

    const isShareAvailable = await Sharing.isAvailableAsync();
    if (!isShareAvailable) {
      return {
        success: false,
        reason: 'open_failed',
        message: OPEN_WITH_OTHER_APP_FAILED_MESSAGE,
      };
    }

    await Sharing.shareAsync(normalizedUri, {
      mimeType: PDF_MIME_TYPE,
      dialogTitle: OPEN_WITH_OTHER_APP_DIALOG_TITLE,
    });
    return {
      success: true,
    };
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Failed to open today review PDF with another app.', {
      fileUriPreview: toSafeUriPreview(normalizedUri),
      platform: Platform.OS,
      error,
    });

    return {
      success: false,
      reason: 'unknown',
      message: OPEN_WITH_OTHER_APP_FAILED_MESSAGE,
    };
  }
}

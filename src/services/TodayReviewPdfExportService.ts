import { Directory, File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';

import type { TodayReviewExportItem } from '@/src/models/TodayReviewExportItem';
import {
  cleanupPrintEnhancedTempFiles,
  enhanceImageForPdfPrint,
  type PrintEnhanceEngine,
  type PrintEnhanceOutputFormat,
} from '@/src/services/export/PrintImageEnhancer';
import { Logger } from '@/src/services/Logger';
import { getTodayReviewExportItems } from '@/src/services/MistakeListService';
import { parseLocalDateTime, toDateOnlyString } from '@/src/utils/date';
import {
  DEFAULT_CLEAR_PRINT_STRENGTH,
  DEFAULT_PRINT_ENHANCE_MODE,
  getPrintEnhanceCssFilter,
  toActiveClearPrintStrength,
  toActivePrintEnhanceMode,
  type PrintEnhanceClearPrintStrength,
  type PrintEnhanceMode,
} from '@/src/utils/image/printEnhanceConfig';

const SERVICE_SCOPE = 'TodayReviewPdfExportService';
const EXPORT_DIR_NAME = 'qishua_wrongbook';
const EXPORT_SUB_DIR_NAME = 'exports';
const PDF_MIME_TYPE = 'application/pdf';
const PDF_FILE_PREFIX = 'qishua_today_review';
const DEFAULT_EXPORT_PRINT_ENHANCE_MODE: PrintEnhanceMode = DEFAULT_PRINT_ENHANCE_MODE;
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
      exportedCount: number;
    }
  | {
      success: false;
      reason: 'empty' | 'generate_failed' | 'share_unavailable' | 'busy' | 'unknown';
      message: string;
      exportedCount?: number;
      fileUri?: string;
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
};

type QuestionImageEnhanceTrace = {
  mode: PrintEnhanceMode;
  clearPrintStrength: PrintEnhanceClearPrintStrength;
  sourceUri: string;
  enhancedUri: string;
  selectedUri: string | null;
  engine: PrintEnhanceEngine;
  outputFormat: PrintEnhanceOutputFormat;
  success: boolean;
  usedFallback: boolean;
  durationMs: number;
};

type BuildQuestionImageSrcResult = {
  imageDataUri: string | null;
  temporaryEnhancedUri: string | null;
  trace: QuestionImageEnhanceTrace | null;
};

type BuildRenderItemsResult = {
  renderItems: TodayReviewPdfRenderItem[];
  temporaryEnhancedUris: string[];
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

function buildExportFileName(dateString: string): string {
  return `${PDF_FILE_PREFIX}_${dateString}.pdf`;
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

async function buildQuestionImageSrc(
  uri: string,
  printEnhanceMode: PrintEnhanceMode,
  clearPrintStrength: PrintEnhanceClearPrintStrength,
): Promise<BuildQuestionImageSrcResult> {
  const normalizedUri = normalizeOptionalText(uri);
  if (!normalizedUri) {
    return {
      imageDataUri: null,
      temporaryEnhancedUri: null,
      trace: null,
    };
  }

  const enhanceResult = await enhanceImageForPdfPrint(normalizedUri, printEnhanceMode, clearPrintStrength);
  const enhancedUri = normalizeOptionalText(enhanceResult.outputUri) ?? normalizedUri;
  const temporaryEnhancedUri = (enhancedUri !== normalizedUri)
    ? enhancedUri
    : null;
  const candidateUris = enhancedUri === normalizedUri ? [normalizedUri] : [enhancedUri, normalizedUri];

  for (const candidateUri of candidateUris) {
    const dataUri = await toImageDataUri(candidateUri);
    if (dataUri) {
      const trace: QuestionImageEnhanceTrace = {
        mode: printEnhanceMode,
        clearPrintStrength,
        sourceUri: normalizedUri,
        enhancedUri,
        selectedUri: candidateUri,
        engine: enhanceResult.engine,
        outputFormat: enhanceResult.outputFormat,
        success: enhanceResult.success,
        usedFallback: enhanceResult.usedFallback,
        durationMs: enhanceResult.durationMs,
      };
      return {
        imageDataUri: dataUri,
        temporaryEnhancedUri,
        trace,
      };
    }
  }

  Logger.warn(SERVICE_SCOPE, 'Failed to build embeddable image data uri for export PDF item.', {
    sourceUriPreview: toSafeUriPreview(enhancedUri),
    originalUriPreview: toSafeUriPreview(normalizedUri),
    printEnhanceMode,
    enhanceEngine: enhanceResult.engine,
    enhanceUsedFallback: enhanceResult.usedFallback,
    enhanceDurationMs: enhanceResult.durationMs,
  });
  return {
    imageDataUri: null,
    temporaryEnhancedUri,
    trace: {
      mode: printEnhanceMode,
      clearPrintStrength,
      sourceUri: normalizedUri,
      enhancedUri,
      selectedUri: null,
      engine: enhanceResult.engine,
      outputFormat: enhanceResult.outputFormat,
      success: enhanceResult.success,
      usedFallback: enhanceResult.usedFallback,
      durationMs: enhanceResult.durationMs,
    },
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
      <div class="problem-label">题目：</div>
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

function buildPdfHtml(
  items: TodayReviewPdfRenderItem[],
  dateString: string,
  imageFilterCss: string | null,
  onPageProgress?: (progress: BuildItemsProgress) => void,
): string {
  const total = items.length;
  const pageHtmlList: string[] = [];

  for (let index = 0; index < total; index += 1) {
    const item = items[index];
    pageHtmlList.push(buildWorksheetPageHtml(item, index, total, dateString));
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
            margin: 14mm 14mm;
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
            min-height: calc(297mm - 28mm);
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
            --answer-row-gap: 30px;
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

async function buildRenderItems(
  items: TodayReviewExportItem[],
  printEnhanceMode: PrintEnhanceMode,
  clearPrintStrength: PrintEnhanceClearPrintStrength,
  onItemProcessed?: (progress: BuildItemsProgress) => void,
): Promise<BuildRenderItemsResult> {
  const renderItems: TodayReviewPdfRenderItem[] = [];
  const temporaryEnhancedUris: string[] = [];
  const total = items.length;

  for (let index = 0; index < total; index += 1) {
    const item = items[index];
    const questionImageUri = normalizeOptionalText(item.questionImageUri);
    const imageResult = questionImageUri
      ? await buildQuestionImageSrc(questionImageUri, printEnhanceMode, clearPrintStrength)
      : {
        imageDataUri: null,
        temporaryEnhancedUri: null,
        trace: null,
      };

    if (imageResult.temporaryEnhancedUri) {
      temporaryEnhancedUris.push(imageResult.temporaryEnhancedUri);
    }

    if (imageResult.trace) {
      Logger.info(SERVICE_SCOPE, 'pdf_export_question_image_enhance_trace', {
        mistakeId: item.mistakeId,
        printEnhanceMode: imageResult.trace.mode,
        clearPrintStrength: imageResult.trace.clearPrintStrength,
        enhanceEngine: imageResult.trace.engine,
        outputFormat: imageResult.trace.outputFormat,
        enhanceSuccess: imageResult.trace.success,
        enhanceUsedFallback: imageResult.trace.usedFallback,
        enhanceDurationMs: imageResult.trace.durationMs,
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

    renderItems.push({
      raw: item,
      questionImageSrc: imageResult.imageDataUri,
    });

    if (onItemProcessed) {
      onItemProcessed({
        current: index + 1,
        total,
      });
    }

    await yieldToUiFrame();
  }

  return {
    renderItems,
    temporaryEnhancedUris,
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

  if (isExportInProgress) {
    Logger.warn(SERVICE_SCOPE, 'Skip export because another export/share flow is in progress.', {
      date: options?.date ?? null,
    });
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
  const imageFilterCss = getPrintEnhanceCssFilter(activePrintEnhanceMode);

  try {
    reportExportProgress(onProgress, {
      stage: 'prepare_items',
      current: 0,
      total: 0,
    });
    const exportItems = await getTodayReviewExportItems(options?.date);
    if (exportItems.length <= 0) {
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
    const renderResult = await buildRenderItems(
      exportItems,
      activePrintEnhanceMode,
      activeClearPrintStrength,
      ({ current, total }) => {
        reportExportProgress(onProgress, {
          stage: 'process_images',
          current,
          total,
        });
      },
    );
    temporaryEnhancedUris.push(...renderResult.temporaryEnhancedUris);
    const html = buildPdfHtml(
      renderResult.renderItems,
      dateString,
      imageFilterCss,
      ({ current, total }) => {
        reportExportProgress(onProgress, {
          stage: 'generate_pdf',
          current,
          total,
        });
      },
    );

    let generatedPdfUri = '';
    try {
      reportExportProgress(onProgress, {
        stage: 'generate_pdf',
        current: exportItems.length,
        total: exportItems.length,
        message: '正在生成练习卷 PDF...',
      });
      const printResult = await Print.printToFileAsync({
        html,
        width: 595,
        height: 842,
      });
      generatedPdfUri = printResult.uri;
    } catch (error) {
      Logger.error(SERVICE_SCOPE, 'Failed to generate export PDF with expo-print.', {
        date: options?.date ?? null,
        itemCount: exportItems.length,
        error,
      });
      return {
        success: false,
        reason: 'generate_failed',
        message: FALLBACK_EXPORT_ERROR_MESSAGE,
        exportedCount: exportItems.length,
      };
    }

    const exportFileName = buildExportFileName(dateString);
    reportExportProgress(onProgress, {
      stage: 'save_pdf',
      current: exportItems.length,
      total: exportItems.length,
    });
    const exportedFileUri = await persistPdfToDocumentDirectory(generatedPdfUri, exportFileName);
    Logger.info(SERVICE_SCOPE, 'Today review PDF exported successfully.', {
      date: dateString,
      exportedCount: exportItems.length,
      fileUriPreview: toSafeUriPreview(exportedFileUri),
      printEnhanceMode: activePrintEnhanceMode,
      clearPrintStrength: activeClearPrintStrength,
      enhancedImageCount: renderResult.temporaryEnhancedUris.length,
    });

    return {
      success: true,
      fileUri: exportedFileUri,
      exportedCount: exportItems.length,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Unexpected error in exportTodayReviewPdf.', {
      date: options?.date ?? null,
      error,
    });
    return {
      success: false,
      reason: 'unknown',
      message: FALLBACK_EXPORT_ERROR_MESSAGE,
    };
  } finally {
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

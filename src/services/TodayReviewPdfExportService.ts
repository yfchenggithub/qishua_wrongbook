import { Directory, File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import type { TodayReviewExportItem } from '@/src/models/TodayReviewExportItem';
import { optimizeImageForStorage } from '@/src/services/ImageOptimizeService';
import { Logger } from '@/src/services/Logger';
import { getTodayReviewExportItems } from '@/src/services/MistakeListService';
import { parseLocalDateTime, toDateOnlyString } from '@/src/utils/date';

const SERVICE_SCOPE = 'TodayReviewPdfExportService';
const EXPORT_DIR_NAME = 'qishua_wrongbook';
const EXPORT_SUB_DIR_NAME = 'exports';
const PDF_MIME_TYPE = 'application/pdf';
const PDF_FILE_PREFIX = 'qishua_today_review';
const EXPORT_IMAGE_MAX_WIDTH = 1200;
const EXPORT_IMAGE_MAX_HEIGHT = 1600;
const EXPORT_IMAGE_QUALITY = 0.55;
const FALLBACK_EXPORT_ERROR_MESSAGE = '导出失败，请稍后重试';
const SHARE_UNAVAILABLE_MESSAGE = '当前设备暂不支持分享，请在文件管理中查看已导出的练习卷';
const EMPTY_MESSAGE = '今天没有待复做题，无需导出练习卷';

export type ExportTodayReviewPdfOptions = {
  date?: string;
};

export type ExportTodayReviewPdfResult =
  | {
      success: true;
      fileUri: string;
      exportedCount: number;
    }
  | {
      success: false;
      reason: 'empty' | 'generate_failed' | 'share_unavailable' | 'unknown';
      message: string;
    };

type TodayReviewPdfRenderItem = {
  raw: TodayReviewExportItem;
  questionImageSrc: string | null;
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

async function buildQuestionImageSrc(uri: string): Promise<string | null> {
  const normalizedUri = normalizeOptionalText(uri);
  if (!normalizedUri) {
    return null;
  }

  const optimized = await optimizeImageForStorage({
    uri: normalizedUri,
    maxWidth: EXPORT_IMAGE_MAX_WIDTH,
    maxHeight: EXPORT_IMAGE_MAX_HEIGHT,
    quality: EXPORT_IMAGE_QUALITY,
  });
  const optimizedUri = normalizeOptionalText(optimized.uri);
  const sourceUri = optimized.ok && optimizedUri ? optimizedUri : normalizedUri;

  if (!optimized.ok) {
    Logger.warn(SERVICE_SCOPE, 'Image optimization failed before PDF export, fallback to original image.', {
      uriPreview: toSafeUriPreview(normalizedUri),
      errorMessage: optimized.errorMessage ?? null,
    });
  }

  const candidateUris = sourceUri === normalizedUri ? [sourceUri] : [sourceUri, normalizedUri];
  for (const candidateUri of candidateUris) {
    const dataUri = await toImageDataUri(candidateUri);
    if (dataUri) {
      return dataUri;
    }
  }

  Logger.warn(SERVICE_SCOPE, 'Failed to build embeddable image data uri for export PDF item.', {
    sourceUriPreview: toSafeUriPreview(sourceUri),
    originalUriPreview: toSafeUriPreview(normalizedUri),
  });
  return null;
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
          <div class="answer-line"></div>
          <div class="answer-line"></div>
          <div class="answer-line"></div>
          <div class="answer-line"></div>
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

function buildPdfHtml(items: TodayReviewPdfRenderItem[], dateString: string): string {
  const cardsHtml = items.map((item, index) => buildQuestionCardHtml(item, index)).join('\n');
  const compactClass = items.length <= 3 ? 'compact-sheet' : '';

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
          .sheet-header {
            border: 1px solid #dddddd;
            border-radius: 10px;
            padding: 14px 18px;
            margin-bottom: 16px;
            page-break-after: avoid;
            break-after: avoid;
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
            margin-bottom: 16px;
            page-break-inside: avoid;
            break-inside: avoid;
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
          }
          .answer-area {
            margin-top: 12px;
          }
          .answer-title {
            font-weight: 700;
            margin-bottom: 8px;
          }
          .answer-line {
            height: 34px;
            border-bottom: 1px solid #333333;
          }
          .result-area {
            margin-top: 12px;
            font-size: 15px;
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
          }
          .compact-sheet .sheet-header {
            margin-bottom: 12px;
            padding-top: 12px;
            padding-bottom: 12px;
          }
          .compact-sheet .problem-card {
            margin-bottom: 12px;
          }
        </style>
      </head>
      <body>
        <main class="sheet ${compactClass}">
          <header class="sheet-header">
            <h1 class="sheet-title">七刷错题本 · 今日复做练习卷</h1>
            <p class="sheet-meta">日期：${escapeHtml(dateString)}　　共 ${items.length} 道题</p>
            <p class="sheet-tip">请先独立完成，完成后由家长在 App 中录入结果。</p>
          </header>
          ${cardsHtml}
          <footer class="footer">完成后请在 App 中录入：会了 / 模糊 / 不会</footer>
        </main>
      </body>
    </html>
  `;
}

async function buildRenderItems(items: TodayReviewExportItem[]): Promise<TodayReviewPdfRenderItem[]> {
  const renderItems: TodayReviewPdfRenderItem[] = [];

  for (const item of items) {
    const questionImageUri = normalizeOptionalText(item.questionImageUri);
    const questionImageSrc = questionImageUri
      ? await buildQuestionImageSrc(questionImageUri)
      : null;

    renderItems.push({
      raw: item,
      questionImageSrc,
    });
  }

  return renderItems;
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
  const baseDate = resolveBaseDate(options?.date);
  const dateString = toDateOnlyString(baseDate);

  try {
    const exportItems = await getTodayReviewExportItems(options?.date);
    if (exportItems.length <= 0) {
      return {
        success: false,
        reason: 'empty',
        message: EMPTY_MESSAGE,
      };
    }

    const renderItems = await buildRenderItems(exportItems);
    const html = buildPdfHtml(renderItems, dateString);

    let generatedPdfUri = '';
    try {
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
      };
    }

    const exportFileName = buildExportFileName(dateString);
    const exportedFileUri = await persistPdfToDocumentDirectory(generatedPdfUri, exportFileName);

    const isShareAvailable = await Sharing.isAvailableAsync();
    if (!isShareAvailable) {
      Logger.warn(SERVICE_SCOPE, 'Sharing is unavailable after PDF export.', {
        fileUriPreview: toSafeUriPreview(exportedFileUri),
      });
      return {
        success: false,
        reason: 'share_unavailable',
        message: SHARE_UNAVAILABLE_MESSAGE,
      };
    }

    await Sharing.shareAsync(exportedFileUri, {
      mimeType: PDF_MIME_TYPE,
      dialogTitle: '分享今日练习卷',
    });

    Logger.info(SERVICE_SCOPE, 'Today review PDF exported and shared successfully.', {
      date: dateString,
      exportedCount: exportItems.length,
      fileUriPreview: toSafeUriPreview(exportedFileUri),
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
  }
}

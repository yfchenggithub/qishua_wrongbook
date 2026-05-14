import { Directory, File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import type { TodayReviewExportItem } from '@/src/models/TodayReviewExportItem';
import { Logger } from '@/src/services/Logger';
import { getTodayReviewExportItems } from '@/src/services/MistakeListService';
import { parseLocalDateTime, toDateOnlyString } from '@/src/utils/date';

const SERVICE_SCOPE = 'TodayReviewPdfExportService';
const EXPORT_DIR_NAME = 'qishua_wrongbook';
const EXPORT_SUB_DIR_NAME = 'exports';
const PDF_MIME_TYPE = 'application/pdf';
const PDF_FILE_PREFIX = 'qishua_today_review';
const FALLBACK_EXPORT_ERROR_MESSAGE = '导出失败，请稍后重试';
const SHARE_UNAVAILABLE_MESSAGE = '当前设备暂不支持分享，请在文件管理中查看导出的 PDF';
const EMPTY_MESSAGE = '今天暂无可导出的复做题';

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
  questionImageDataUri: string | null;
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
        uri,
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
      uri,
      error,
    });
    return null;
  }
}

function formatDifficultyText(difficulty: number | null): string {
  if (typeof difficulty !== 'number' || !Number.isFinite(difficulty)) {
    return '-';
  }
  return String(Math.floor(difficulty));
}

function buildQuestionCardHtml(item: TodayReviewPdfRenderItem, index: number): string {
  const questionNo = index + 1;
  const title = escapeHtml(item.raw.title);
  const module = escapeHtml(item.raw.module);
  const dueDate = escapeHtml(item.raw.dueDate);
  const difficultyText = escapeHtml(formatDifficultyText(item.raw.difficulty));
  const progressText = `第 ${item.raw.currentReviewIndex} / ${item.raw.totalReviewCount} 刷`;
  const questionImageBlock = item.questionImageDataUri
    ? `<img class="question-image" src="${item.questionImageDataUri}" alt="题目图片" />`
    : `<div class="image-fallback">题目图片暂时无法加载</div>`;

  return `
    <section class="question-page">
      <div class="question-head">第 ${questionNo} 题</div>
      <div class="question-meta">模块：${module}</div>
      <div class="question-meta">题目：${title}</div>
      <div class="question-meta">进度：${escapeHtml(progressText)}</div>
      <div class="question-meta">难度：${difficultyText}</div>
      <div class="question-meta">到期日：${dueDate}</div>
      <div class="question-image-wrap">${questionImageBlock}</div>
      <div class="answer-title">我的解答：</div>
      <div class="answer-lines">
        <div class="answer-line"></div>
        <div class="answer-line"></div>
        <div class="answer-line"></div>
        <div class="answer-line"></div>
        <div class="answer-line"></div>
      </div>
      <div class="result-title">本次结果：</div>
      <div class="result-options">□ 会了　　□ 模糊　　□ 不会</div>
    </section>
  `;
}

function buildPdfHtml(items: TodayReviewPdfRenderItem[], dateString: string): string {
  const pagesHtml = items.map((item, index) => buildQuestionCardHtml(item, index)).join('\n');

  return `
    <!DOCTYPE html>
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>七刷错题本今日练习卷</title>
        <style>
          @page {
            margin: 18mm 14mm 16mm 14mm;
            size: A4 portrait;
          }
          * {
            box-sizing: border-box;
          }
          body {
            margin: 0;
            color: #111111;
            font-family: Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
            font-size: 14px;
            line-height: 1.5;
          }
          .cover {
            margin-bottom: 12mm;
            border: 1px solid #d9d9d9;
            border-radius: 8px;
            padding: 14px 16px;
          }
          .cover-title {
            font-size: 24px;
            font-weight: 700;
            margin: 0 0 8px 0;
            letter-spacing: 0.2px;
          }
          .cover-meta {
            font-size: 14px;
            margin: 0;
          }
          .cover-tip {
            margin-top: 8px;
            font-size: 13px;
            color: #444444;
          }
          .question-page {
            page-break-inside: avoid;
            break-inside: avoid;
            page-break-after: always;
            border: 1px solid #d9d9d9;
            border-radius: 8px;
            padding: 12px 14px 14px 14px;
            margin-bottom: 10mm;
          }
          .question-page:last-of-type {
            page-break-after: auto;
          }
          .question-head {
            font-size: 20px;
            font-weight: 700;
            margin-bottom: 8px;
          }
          .question-meta {
            margin-bottom: 4px;
            font-size: 14px;
          }
          .question-image-wrap {
            margin-top: 8px;
            min-height: 180px;
            border: 1px solid #cfcfcf;
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 8px;
            overflow: hidden;
            background: #ffffff;
          }
          .question-image {
            width: 100%;
            max-height: 430px;
            object-fit: contain;
          }
          .image-fallback {
            font-size: 14px;
            color: #666666;
          }
          .answer-title {
            margin-top: 10px;
            font-size: 14px;
            font-weight: 700;
          }
          .answer-lines {
            margin-top: 6px;
          }
          .answer-line {
            border-bottom: 1px solid #444444;
            height: 32px;
            margin-bottom: 6px;
          }
          .result-title {
            margin-top: 6px;
            font-size: 14px;
            font-weight: 700;
          }
          .result-options {
            margin-top: 4px;
            font-size: 16px;
            letter-spacing: 0.5px;
          }
        </style>
      </head>
      <body>
        <header class="cover">
          <h1 class="cover-title">七刷错题本 · 今日复做练习卷</h1>
          <p class="cover-meta">日期：${escapeHtml(dateString)}　|　共 ${items.length} 道题</p>
          <p class="cover-tip">请先独立完成，完成后由家长在 App 中录入结果。</p>
        </header>
        ${pagesHtml}
      </body>
    </html>
  `;
}

async function buildRenderItems(items: TodayReviewExportItem[]): Promise<TodayReviewPdfRenderItem[]> {
  return Promise.all(
    items.map(async (item) => {
      const questionImageUri = normalizeOptionalText(item.questionImageUri);
      const questionImageDataUri = questionImageUri
        ? await toImageDataUri(questionImageUri)
        : null;

      return {
        raw: item,
        questionImageDataUri,
      };
    }),
  );
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
        exportedFileUri,
      });
      return {
        success: false,
        reason: 'share_unavailable',
        message: SHARE_UNAVAILABLE_MESSAGE,
      };
    }

    await Sharing.shareAsync(exportedFileUri, {
      mimeType: PDF_MIME_TYPE,
      dialogTitle: '分享今日练习卷 PDF',
    });

    Logger.info(SERVICE_SCOPE, 'Today review PDF exported and shared successfully.', {
      date: dateString,
      exportedCount: exportItems.length,
      fileUri: exportedFileUri,
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

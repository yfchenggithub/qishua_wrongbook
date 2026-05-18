import { Logger } from '@/src/services/Logger';
import * as MistakeListService from '@/src/services/MistakeListService';
import * as TodayReviewPdfExportService from '@/src/services/TodayReviewPdfExportService';

const SERVICE_SCOPE = 'TodayWorksheetExportService';

const MESSAGE_SUCCESS = '今日练习卷已生成';
const MESSAGE_EMPTY = '今天没有待复做错题';
const MESSAGE_SHARE_UNAVAILABLE = '当前设备暂不支持分享，请在文件管理中查看已导出的练习卷';
const MESSAGE_BUSY = '正在处理上一次导出/分享，请稍后再试。';
const MESSAGE_FAILED = '导出失败，请稍后重试';

export type TodayWorksheetExportOutcome =
  | 'success'
  | 'empty'
  | 'share_unavailable'
  | 'busy'
  | 'failed';

export type TodayWorksheetExportResult = {
  outcome: TodayWorksheetExportOutcome;
  message: string;
};

export async function getTodayWorksheetPendingCount(): Promise<number> {
  try {
    const count = await MistakeListService.getTodayReviewQueueCount();
    return Math.max(0, Math.floor(count));
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Failed to load pending count for today worksheet export.', {
      error,
    });
    return 0;
  }
}

export async function exportTodayWorksheet(): Promise<TodayWorksheetExportResult> {
  try {
    const result = await TodayReviewPdfExportService.exportTodayReviewPdf();
    if (result.success) {
      return {
        outcome: 'success',
        message: MESSAGE_SUCCESS,
      };
    }

    if (result.reason === 'empty') {
      return {
        outcome: 'empty',
        message: MESSAGE_EMPTY,
      };
    }

    if (result.reason === 'share_unavailable') {
      Logger.warn(SERVICE_SCOPE, 'Sharing unavailable while exporting today worksheet.', {
        message: result.message,
      });
      return {
        outcome: 'share_unavailable',
        message: MESSAGE_SHARE_UNAVAILABLE,
      };
    }

    if (result.reason === 'busy') {
      Logger.info(SERVICE_SCOPE, 'Skip worksheet export because another export/share flow is in progress.', {
        message: result.message,
      });
      return {
        outcome: 'busy',
        message: MESSAGE_BUSY,
      };
    }

    Logger.warn(SERVICE_SCOPE, 'Today worksheet export finished without success.', {
      reason: result.reason,
      message: result.message,
    });
    return {
      outcome: 'failed',
      message: MESSAGE_FAILED,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Failed to export today worksheet.', { error });
    return {
      outcome: 'failed',
      message: MESSAGE_FAILED,
    };
  }
}

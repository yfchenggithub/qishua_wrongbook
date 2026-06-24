import * as ExportImageModeService from '@/src/services/ExportImageModeService';
import { getTodayReviewExportItems } from '@/src/services/MistakeListService';
import { getCachedPrintEnhancedImageForPdf, type PrintEnhanceCacheStatus } from '@/src/services/export/PrintEnhanceCacheService';
import { Logger } from '@/src/services/Logger';

const SERVICE_SCOPE = 'PrintEnhancePrewarmService';

export type PrintEnhancePrewarmResult =
  | {
    started: true;
    total: number;
    processed: number;
    statusCounts: Partial<Record<PrintEnhanceCacheStatus, number>>;
  }
  | {
    started: false;
    reason: 'busy' | 'not_clear_print' | 'empty';
  };

export type PrewarmTodayReviewPrintEnhanceCacheOptions = {
  date?: string;
  reason?: string;
};

let isPrewarmInProgress = false;

function incrementStatusCount(
  counts: Partial<Record<PrintEnhanceCacheStatus, number>>,
  status: PrintEnhanceCacheStatus,
) {
  counts[status] = (counts[status] ?? 0) + 1;
}

async function yieldToUiFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

export async function prewarmTodayReviewPrintEnhanceCache(
  options?: PrewarmTodayReviewPrintEnhanceCacheOptions,
): Promise<PrintEnhancePrewarmResult> {
  if (isPrewarmInProgress) {
    Logger.info(SERVICE_SCOPE, 'Skip print enhance prewarm because another run is active.', {
      reason: options?.reason ?? null,
    });
    return {
      started: false,
      reason: 'busy',
    };
  }

  isPrewarmInProgress = true;
  const startedAt = Date.now();
  try {
    const settings = await ExportImageModeService.loadExportImageSettings();
    if (settings.mode !== 'clear_print') {
      Logger.info(SERVICE_SCOPE, 'Skip print enhance prewarm because export mode is not clear_print.', {
        mode: settings.mode,
        reason: options?.reason ?? null,
      });
      return {
        started: false,
        reason: 'not_clear_print',
      };
    }

    const items = await getTodayReviewExportItems(options?.date);
    const imageUris = items
      .map((item) => (typeof item.questionImageUri === 'string' ? item.questionImageUri.trim() : ''))
      .filter((uri) => uri.length > 0);

    if (imageUris.length <= 0) {
      return {
        started: false,
        reason: 'empty',
      };
    }

    Logger.info(SERVICE_SCOPE, 'Start prewarming today review print enhance cache.', {
      reason: options?.reason ?? null,
      total: imageUris.length,
      clearPrintStrength: settings.clearPrintStrength,
      performanceProfile: settings.performanceProfile,
    });

    let processed = 0;
    const statusCounts: Partial<Record<PrintEnhanceCacheStatus, number>> = {};
    for (const uri of imageUris) {
      try {
        const result = await getCachedPrintEnhancedImageForPdf(
          uri,
          settings.mode,
          settings.clearPrintStrength,
          settings.performanceProfile,
        );
        incrementStatusCount(statusCounts, result.cacheStatus);
        processed += 1;
      } catch (error) {
        Logger.warn(SERVICE_SCOPE, 'Failed to prewarm one print enhance cache item.', {
          reason: options?.reason ?? null,
          error,
        });
      }
      await yieldToUiFrame();
    }

    Logger.info(SERVICE_SCOPE, 'Finished prewarming today review print enhance cache.', {
      reason: options?.reason ?? null,
      total: imageUris.length,
      processed,
      statusCounts,
      durationMs: Math.max(0, Date.now() - startedAt),
    });

    return {
      started: true,
      total: imageUris.length,
      processed,
      statusCounts,
    };
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Failed to prewarm today review print enhance cache.', {
      reason: options?.reason ?? null,
      error,
      durationMs: Math.max(0, Date.now() - startedAt),
    });
    return {
      started: false,
      reason: 'empty',
    };
  } finally {
    isPrewarmInProgress = false;
  }
}

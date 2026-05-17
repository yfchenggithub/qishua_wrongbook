import { MistakeImageRepository, ReviewRecordRepository } from '@/src/repositories';
import { getImageInfo } from '@/src/services/ImageStorageService';
import { Logger } from '@/src/services/Logger';
import * as MistakeListService from '@/src/services/MistakeListService';

const SERVICE_SCOPE = 'SettingsStatsService';

export type SettingsStats = {
  totalMistakes: number;
  dueToday: number;
  mastered: number;
  totalReviews: number;
  imageCount: number;
  storageBytes?: number | null;
  updatedAt: number;
};

async function resolveStorageBytes(): Promise<number | null> {
  try {
    const imageUris = await MistakeImageRepository.listAllImageUris();
    if (imageUris.length <= 0) {
      return 0;
    }

    let totalBytes = 0;
    for (const uri of imageUris) {
      const info = await getImageInfo(uri);
      if (!info.exists) {
        continue;
      }
      if (typeof info.size === 'number' && Number.isFinite(info.size) && info.size > 0) {
        totalBytes += info.size;
      }
    }
    return totalBytes;
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Resolve storage bytes failed, fallback to null.', { error });
    return null;
  }
}

export async function loadSettingsStats(): Promise<SettingsStats> {
  const startedAt = Date.now();
  Logger.info(SERVICE_SCOPE, 'Start loading settings stats.');

  try {
    const [mistakeStats, dueToday, totalReviews, imageCount, storageBytes] = await Promise.all([
      MistakeListService.getMistakeListStats(),
      MistakeListService.getTodayReviewQueueCount(),
      ReviewRecordRepository.countReviewRecords(),
      MistakeImageRepository.countMistakeImages(),
      resolveStorageBytes(),
    ]);

    const stats: SettingsStats = {
      totalMistakes: mistakeStats.total,
      dueToday,
      mastered: mistakeStats.mastered,
      totalReviews,
      imageCount,
      storageBytes,
      updatedAt: Date.now(),
    };

    Logger.info(SERVICE_SCOPE, 'Loaded settings stats successfully.', {
      elapsedMs: Date.now() - startedAt,
      totalMistakes: stats.totalMistakes,
      dueToday: stats.dueToday,
      mastered: stats.mastered,
      totalReviews: stats.totalReviews,
      imageCount: stats.imageCount,
      hasStorageBytes: stats.storageBytes !== null && stats.storageBytes !== undefined,
    });

    return stats;
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Failed to load settings stats.', {
      elapsedMs: Date.now() - startedAt,
      error,
    });
    throw error;
  }
}

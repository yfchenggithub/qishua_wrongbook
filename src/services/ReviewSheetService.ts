import type { Mistake, ReviewResult } from '@/src/models/Mistake';
import type { ReviewSheetWithItems } from '@/src/models/ReviewSheet';
import { MistakeRepository, ReviewSheetRepository } from '@/src/repositories';
import { completeReview } from '@/src/services/CompleteReviewService';
import { Logger } from '@/src/services/Logger';
import { mapMistakeToListItem } from '@/src/services/MistakeListService';
import {
  canStartReview,
  getNextReviewIndex,
} from '@/src/services/ReviewScheduleService';

const SERVICE_SCOPE = 'ReviewSheetService';
const NOT_FOUND_MESSAGE = '未找到这份练习卷';
const SUBMITTED_MESSAGE = '这份练习卷已回填';
const MISSING_RESULT_MESSAGE = '还有题目未选择结果';
const GENERIC_FAILED_MESSAGE = '保存结果失败，请稍后重试';

const REVIEW_RESULT_VALUES: ReviewResult[] = ['wrong', 'unsure', 'mastered'];

export interface ReviewSheetQuestion {
  mistakeId: string;
  title: string;
  module: string;
  sortOrder: number;
  reviewCount: number;
  nextReviewIndex: number;
}

export interface ReviewSheetFillData {
  sheetId: string;
  createdAt: string;
  submittedAt: string | null;
  isSubmitted: boolean;
  items: ReviewSheetQuestion[];
}

export type ReviewSheetFillDataResult =
  | {
      ok: true;
      data: ReviewSheetFillData;
    }
  | {
      ok: false;
      errorMessage: string;
      notFound?: boolean;
      alreadySubmitted?: boolean;
    };

export type ReviewSheetSubmitResult =
  | {
      ok: true;
      submittedCount: number;
    }
  | {
      ok: false;
      errorMessage: string;
      notFound?: boolean;
      alreadySubmitted?: boolean;
      missingResult?: boolean;
    };

export type ReviewSheetResultsByMistakeId = Record<string, ReviewResult | undefined>;

function normalizeSheetId(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeReviewResult(value: ReviewResult | undefined): ReviewResult | null {
  if (value && REVIEW_RESULT_VALUES.includes(value)) {
    return value;
  }
  return null;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message.length > 0 ? message : GENERIC_FAILED_MESSAGE;
  }
  const message = String(error ?? '').trim();
  return message.length > 0 ? message : GENERIC_FAILED_MESSAGE;
}

function buildCannotReviewMessage(mistake: Mistake, reason?: string): string {
  const listItem = mapMistakeToListItem(mistake);
  const suffix = reason && reason.trim().length > 0 ? reason.trim() : '当前状态不能复做';
  return `${listItem.title}：${suffix}`;
}

async function loadMistakeMap(sheet: ReviewSheetWithItems): Promise<Map<string, Mistake>> {
  const entries = await Promise.all(
    sheet.items.map(async (item) => {
      const mistake = await MistakeRepository.getMistakeById(item.mistake_id);
      return [item.mistake_id, mistake] as const;
    }),
  );

  const map = new Map<string, Mistake>();
  for (const [mistakeId, mistake] of entries) {
    if (mistake) {
      map.set(mistakeId, mistake);
    }
  }
  return map;
}

function mapFillData(
  sheet: ReviewSheetWithItems,
  mistakeMap: Map<string, Mistake>,
): ReviewSheetFillData {
  return {
    sheetId: sheet.id,
    createdAt: sheet.created_at,
    submittedAt: sheet.submitted_at ?? null,
    isSubmitted: sheet.is_submitted === 1,
    items: sheet.items
      .map((item): ReviewSheetQuestion | null => {
        const mistake = mistakeMap.get(item.mistake_id);
        if (!mistake) {
          return null;
        }

        const listItem = mapMistakeToListItem(mistake);
        return {
          mistakeId: item.mistake_id,
          title: listItem.title,
          module: listItem.module,
          sortOrder: item.sort_order,
          reviewCount: listItem.reviewCount,
          nextReviewIndex: getNextReviewIndex(listItem.reviewCount),
        };
      })
      .filter((item): item is ReviewSheetQuestion => item !== null),
  };
}

export function parseReviewSheetQrPayload(data: string | null | undefined): string | null {
  const normalized = normalizeSheetId(data);
  return normalized.length > 0 ? normalized : null;
}

export async function createReviewSheetForMistakeIds(
  mistakeIds: string[],
): Promise<ReviewSheetWithItems> {
  try {
    return await ReviewSheetRepository.createReviewSheet(mistakeIds);
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'createReviewSheetForMistakeIds failed.', { mistakeIds, error });
    throw error;
  }
}

export async function getReviewSheetFillData(
  sheetIdInput: string,
): Promise<ReviewSheetFillDataResult> {
  const sheetId = normalizeSheetId(sheetIdInput);
  if (!sheetId) {
    return {
      ok: false,
      notFound: true,
      errorMessage: NOT_FOUND_MESSAGE,
    };
  }

  try {
    const sheet = await ReviewSheetRepository.getReviewSheetWithItems(sheetId);
    if (!sheet) {
      return {
        ok: false,
        notFound: true,
        errorMessage: NOT_FOUND_MESSAGE,
      };
    }

    if (sheet.is_submitted === 1) {
      return {
        ok: false,
        alreadySubmitted: true,
        errorMessage: SUBMITTED_MESSAGE,
      };
    }

    if (sheet.items.length <= 0) {
      return {
        ok: false,
        notFound: true,
        errorMessage: NOT_FOUND_MESSAGE,
      };
    }

    const mistakeMap = await loadMistakeMap(sheet);
    return {
      ok: true,
      data: mapFillData(sheet, mistakeMap),
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'getReviewSheetFillData failed.', { sheetId, error });
    return {
      ok: false,
      errorMessage: GENERIC_FAILED_MESSAGE,
    };
  }
}

export async function submitReviewSheetResults(
  sheetIdInput: string,
  resultsByMistakeId: ReviewSheetResultsByMistakeId,
): Promise<ReviewSheetSubmitResult> {
  const sheetId = normalizeSheetId(sheetIdInput);
  if (!sheetId) {
    return {
      ok: false,
      notFound: true,
      errorMessage: NOT_FOUND_MESSAGE,
    };
  }

  try {
    const sheet = await ReviewSheetRepository.getReviewSheetWithItems(sheetId);
    if (!sheet) {
      return {
        ok: false,
        notFound: true,
        errorMessage: NOT_FOUND_MESSAGE,
      };
    }

    if (sheet.is_submitted === 1) {
      return {
        ok: false,
        alreadySubmitted: true,
        errorMessage: SUBMITTED_MESSAGE,
      };
    }

    if (sheet.items.length <= 0) {
      return {
        ok: false,
        notFound: true,
        errorMessage: NOT_FOUND_MESSAGE,
      };
    }

    const normalizedResults = new Map<string, ReviewResult>();
    for (const item of sheet.items) {
      const result = normalizeReviewResult(resultsByMistakeId[item.mistake_id]);
      if (!result) {
        return {
          ok: false,
          missingResult: true,
          errorMessage: MISSING_RESULT_MESSAGE,
        };
      }
      normalizedResults.set(item.mistake_id, result);
    }

    const mistakeMap = await loadMistakeMap(sheet);
    for (const item of sheet.items) {
      const mistake = mistakeMap.get(item.mistake_id);
      if (!mistake) {
        return {
          ok: false,
          notFound: true,
          errorMessage: NOT_FOUND_MESSAGE,
        };
      }

      const reviewPermission = canStartReview({
        status: mistake.status,
        reviewCount: mistake.review_count,
      });
      if (!reviewPermission.canReview) {
        return {
          ok: false,
          errorMessage: buildCannotReviewMessage(mistake, reviewPermission.reason),
        };
      }
    }

    let submittedCount = 0;
    for (const item of sheet.items) {
      const mistake = mistakeMap.get(item.mistake_id);
      const result = normalizedResults.get(item.mistake_id);
      if (!mistake || !result) {
        return {
          ok: false,
          errorMessage: GENERIC_FAILED_MESSAGE,
        };
      }

      const reviewIndex = getNextReviewIndex(mistake.review_count);
      const completeResult = await completeReview({
        mistakeId: item.mistake_id,
        reviewIndex,
        result,
        solutionImageUri: null,
        note: null,
        cleanupImageOnFailure: false,
      });

      if (!completeResult.ok) {
        return {
          ok: false,
          errorMessage: completeResult.errorMessage ?? GENERIC_FAILED_MESSAGE,
        };
      }
      submittedCount += 1;
    }

    const marked = await ReviewSheetRepository.markReviewSheetSubmitted(sheetId);
    if (!marked) {
      return {
        ok: false,
        alreadySubmitted: true,
        errorMessage: SUBMITTED_MESSAGE,
      };
    }

    Logger.info(SERVICE_SCOPE, 'submitReviewSheetResults succeeded.', {
      sheetId,
      submittedCount,
    });
    return {
      ok: true,
      submittedCount,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'submitReviewSheetResults failed.', { sheetId, error });
    return {
      ok: false,
      errorMessage: toErrorMessage(error),
    };
  }
}

import { MAX_REVIEW_COUNT, REVIEW_STATUS } from '@/src/constants/review';
import { MISTAKE_NOTE_MAX_LENGTH } from '@/src/constants/mistakeOptions';
import type {
  DetailImageSlot,
  DetailPreviewImageItem,
  DetailReviewRecordItem,
  DetailReviewResult,
  MistakeDetailViewModel,
} from '@/src/models/MistakeDetailViewModel';
import type { Mistake, MistakeStatus } from '@/src/models/Mistake';
import type { MistakeImage } from '@/src/models/MistakeImage';
import type { TextHighlightRange } from '@/src/models/TextHighlight';
import {
  MistakeImageRepository,
  MistakeRelationRepository,
  MistakeRepository,
  MistakeTagRepository,
  ReviewRecordRepository,
} from '@/src/repositories';
import { Logger } from '@/src/services/Logger';
import { deleteMistakeImageFolder, getImageInfo } from '@/src/services/ImageStorageService';
import * as MistakeListService from '@/src/services/MistakeListService';
import * as ReviewReminderService from '@/src/services/ReviewReminderService';
import * as VoiceNoteService from '@/src/services/VoiceNoteService';
import { formatDateShort } from '@/src/utils/date';
import { parseStoredTextHighlights, serializeTextHighlights } from '@/src/utils/textHighlights';

const SERVICE_SCOPE = 'MistakeDetailService';
const FALLBACK_ERROR_MESSAGE = '读取错题详情失败，请稍后重试。';
const DELETE_MISTAKE_ERROR_MESSAGE = '删除错题失败，请稍后重试。';
const MODULE_NAVIGATION_LIMIT = 500;

export const MISTAKE_DETAIL_NOTE_MAX_LENGTH = MISTAKE_NOTE_MAX_LENGTH;

export type ManagedDetailImageType = Exclude<DetailImageSlot['type'], 'review_solution'>;
export type DetailBrowseMode = 'today_due' | 'same_module' | 'none';

export type DetailBrowseContext = {
  mode: DetailBrowseMode;
  ids: string[];
  currentIndex: number;
};

export type GetDetailBrowseContextParams = {
  mistakeId: string;
  module: string;
};

type GetMistakeDetailResult = {
  ok: boolean;
  detail?: MistakeDetailViewModel;
  errorMessage?: string;
  notFound?: boolean;
};

export type SaveOptionalDetailImageParams = {
  mistakeId: string;
  imageType: 'my_solution' | 'answer';
  imageUri: string;
};

type SaveOptionalDetailImageResult = {
  ok: boolean;
  errorMessage?: string;
};

export type UpsertDetailImageParams = {
  mistakeId: string;
  imageType: ManagedDetailImageType;
  imageUri: string;
};

export type UpsertDetailImageResult = {
  ok: boolean;
  imageId?: string;
  errorMessage?: string;
};

export type DeleteDetailImageResult = {
  ok: boolean;
  deletedCount?: number;
  errorMessage?: string;
};

export type UpdateDetailImageUriParams = {
  imageId: string;
  newUri: string;
};

export type UpdateDetailImageUriResult = {
  ok: boolean;
  errorMessage?: string;
};

export type UpdateMistakeTitleParams = {
  mistakeId: string;
  title: string;
};

export type UpdateMistakeTitleResult = {
  ok: boolean;
  detail?: MistakeDetailViewModel;
  errorMessage?: string;
};

export type UpdateMistakeModuleParams = {
  mistakeId: string;
  module: string;
};

export type UpdateMistakeModuleResult = {
  ok: boolean;
  detail?: MistakeDetailViewModel;
  errorMessage?: string;
};

export type UpdateMistakeMetadataParams = {
  mistakeId: string;
  errorReason?: string | null;
  difficulty: number;
};

export type UpdateMistakeMetadataResult = {
  ok: boolean;
  detail?: MistakeDetailViewModel;
  errorMessage?: string;
};

export type UpdateMistakeNoteParams = {
  mistakeId: string;
  note?: string | null;
  noteHighlights?: TextHighlightRange[] | null;
};

export type UpdateMistakeNoteResult = {
  ok: boolean;
  detail?: MistakeDetailViewModel;
  errorMessage?: string;
};

export type DeleteMistakeResult = {
  ok: boolean;
  deleted?: boolean;
  imageFolderDeleted?: boolean;
  deletedVoiceNoteCount?: number;
  failedVoiceNoteCount?: number;
  errorMessage?: string;
};

export type ArchiveMistakeResult = {
  ok: boolean;
  detail?: MistakeDetailViewModel;
  errorMessage?: string;
};

export type JoinMistakeReviewPlanResult = {
  ok: boolean;
  detail?: MistakeDetailViewModel;
  errorMessage?: string;
};

type SlotSeed = {
  type: DetailImageSlot['type'];
  title: string;
  emptyText: string;
};

function toErrorMessage(error: unknown, fallback = FALLBACK_ERROR_MESSAGE): string {
  if (error instanceof Error) {
    const trimmed = error.message.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }
  const text = String(error ?? '').trim();
  return text.length > 0 ? text : fallback;
}

function normalizeMistakeId(id: string): string {
  return typeof id === 'string' ? id.trim() : '';
}

function normalizeMistakeIdList(ids: string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const id of ids) {
    const normalizedId = normalizeMistakeId(id);
    if (!normalizedId || seen.has(normalizedId)) {
      continue;
    }
    normalized.push(normalizedId);
    seen.add(normalizedId);
  }

  return normalized;
}

function buildBrowseContext(
  mode: DetailBrowseMode,
  ids: string[],
  currentMistakeId: string,
): DetailBrowseContext {
  const normalizedIds = normalizeMistakeIdList(ids);
  if (normalizedIds.length <= 0) {
    return {
      mode: 'none',
      ids: [currentMistakeId],
      currentIndex: 0,
    };
  }

  const currentIndex = normalizedIds.indexOf(currentMistakeId);
  if (currentIndex >= 0) {
    return {
      mode,
      ids: normalizedIds,
      currentIndex,
    };
  }

  return {
    mode,
    ids: [currentMistakeId, ...normalizedIds],
    currentIndex: 0,
  };
}

function normalizeOptionalText(value?: string | null): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toShortUri(uri: string | null | undefined): string | null {
  const normalized = normalizeOptionalText(uri);
  if (!normalized) {
    return null;
  }
  if (normalized.length <= 64) {
    return normalized;
  }
  return `${normalized.slice(0, 28)}...${normalized.slice(-20)}`;
}

function isManagedDetailImageType(value: string): value is ManagedDetailImageType {
  return value === 'question' || value === 'my_solution' || value === 'answer';
}

function normalizeDetailReviewResult(result: string | null | undefined): DetailReviewResult {
  if (result === 'mastered' || result === 'unsure' || result === 'wrong') {
    return result;
  }
  if (result === 'known' || result === 'vague' || result === 'unknown') {
    return result;
  }
  return null;
}

function findImagesByType(images: MistakeImage[], type: DetailImageSlot['type']): MistakeImage[] {
  return images.filter((image) => image.type === type);
}

function buildStatusLabel(status: MistakeStatus, reviewCount: number): string {
  if (status === REVIEW_STATUS.COLLECTED) {
    return '待整理';
  }
  if (status === REVIEW_STATUS.MASTERED) {
    return '已七刷';
  }
  if (status === REVIEW_STATUS.ARCHIVED) {
    return '已归档';
  }

  const nextIndex = Math.floor(reviewCount) + 1;
  const clampedIndex = Math.max(1, Math.min(MAX_REVIEW_COUNT, nextIndex));
  return `第 ${clampedIndex} 刷`;
}

function buildDetailTitle(moduleName: string, title?: string | null): string {
  const normalizedTitle = normalizeOptionalText(title);
  if (normalizedTitle) {
    return normalizedTitle;
  }
  return `${moduleName}错题`;
}

function buildTitleAfterModuleUpdate(
  currentTitle: string | null | undefined,
  currentModule: string,
  nextModule: string,
): string | null | undefined {
  const normalizedTitle = normalizeOptionalText(currentTitle);
  const normalizedCurrentModule = normalizeOptionalText(currentModule);
  if (!normalizedTitle || !normalizedCurrentModule || normalizedCurrentModule === nextModule) {
    return currentTitle;
  }

  const canonicalPrefix = `${normalizedCurrentModule} · `;
  if (normalizedTitle.startsWith(canonicalPrefix)) {
    const suffix = normalizedTitle.slice(canonicalPrefix.length);
    if (/^第\s*\d+\s*题$/u.test(suffix)) {
      return `${nextModule} · ${suffix}`;
    }
  }

  if (normalizedTitle === `${normalizedCurrentModule}错题`) {
    return `${nextModule}错题`;
  }

  return currentTitle;
}

function normalizeDetailDifficulty(value: number): number | null {
  const normalized = Math.floor(value);
  if (!Number.isFinite(normalized) || normalized < 1 || normalized > 5) {
    return null;
  }
  return normalized;
}

function buildSubtitle(mistake: Mistake): string {
  const subtitleParts: string[] = [];
  const reason = normalizeOptionalText(mistake.error_reason);

  if (reason) {
    subtitleParts.push(reason);
  }

  subtitleParts.push(`难度 ${mistake.difficulty}`);
  subtitleParts.push(formatDateShort(mistake.created_at));

  return subtitleParts.join(' · ');
}

async function buildPreviewImages(images: MistakeImage[]): Promise<DetailPreviewImageItem[]> {
  const mapped = await Promise.all(
    images.map(async (image) => {
      const normalizedUri = normalizeOptionalText(image.uri);
      if (!normalizedUri) {
        return null;
      }

      try {
        const info = await getImageInfo(normalizedUri);
        return {
          id: image.id,
          uri: normalizedUri,
          exists: info.exists,
          fileSize: info.size ?? null,
        };
      } catch (error) {
        Logger.error(SERVICE_SCOPE, 'Image file check failed in preview image mapping.', {
          imageId: image.id,
          imageType: image.type,
          uriShort: toShortUri(normalizedUri),
          error,
        });
        return {
          id: image.id,
          uri: normalizedUri,
          exists: false,
          fileSize: null,
        };
      }
    }),
  );

  return mapped.filter((item): item is NonNullable<typeof item> => item !== null);
}

async function buildImageSlots(_mistake: Mistake, images: MistakeImage[]): Promise<DetailImageSlot[]> {
  const slotSeeds: SlotSeed[] = [
    {
      type: 'question',
      title: '题目',
      emptyText: '还没有题目图片',
    },
    {
      type: 'my_solution',
      title: '我的做法',
      emptyText: '还没有添加做法图片',
    },
    {
      type: 'answer',
      title: '答案解析',
      emptyText: '还没有添加答案解析图片',
    },
  ];

  const slots = await Promise.all(
    slotSeeds.map(async (seed) => {
      const slotImages = findImagesByType(images, seed.type);
      const previewImages = await buildPreviewImages(slotImages);
      const primaryImage =
        previewImages.find((item) => item.exists !== false) ?? previewImages[0] ?? null;

      return {
        ...seed,
        uri: primaryImage?.uri ?? null,
        exists: primaryImage?.exists ?? false,
        fileSize: primaryImage?.fileSize ?? null,
        previewImages,
      };
    }),
  );

  return slots;
}

async function mapMistakeToDetailViewModel(
  mistake: Mistake,
  imageSlots: DetailImageSlot[],
): Promise<MistakeDetailViewModel> {
  const relatedSummary = await MistakeRelationRepository.getRelationSummaryByMistakeId(mistake.id);
  const tags = await MistakeTagRepository.listTagsByMistakeId(mistake.id);
  return {
    id: mistake.id,
    module: mistake.module,
    title: buildDetailTitle(mistake.module, mistake.title),
    subtitle: buildSubtitle(mistake),
    errorReason: mistake.error_reason ?? null,
    difficulty: mistake.difficulty,
    note: mistake.note ?? null,
    noteHighlights: parseStoredTextHighlights(mistake.note_highlights, mistake.note ?? ''),
    reviewCount: mistake.review_count,
    maxReviewCount: MAX_REVIEW_COUNT,
    status: mistake.status,
    statusLabel: buildStatusLabel(mistake.status, mistake.review_count),
    nextReviewAt: mistake.next_review_at ?? null,
    createdAt: mistake.created_at,
    updatedAt: mistake.updated_at,
    tags,
    imageSlots,
    reviewRecords: [],
    relatedSummary,
  };
}

async function mapReviewRecords(
  mistakeReviewRecords: Awaited<ReturnType<typeof ReviewRecordRepository.listReviewRecordsByMistakeId>>,
): Promise<DetailReviewRecordItem[]> {
  const mapped = await Promise.all(
    mistakeReviewRecords.map(async (record) => {
      const reviewSolutionImages = await MistakeImageRepository.getReviewSolutionImages(record.id);
      const solutionImages = await buildPreviewImages(reviewSolutionImages);
      const primaryImage =
        solutionImages.find((item) => item.exists !== false) ?? solutionImages[0] ?? null;
      const solutionImageId = normalizeOptionalText(primaryImage?.id ?? null);
      const solutionImageUri = normalizeOptionalText(primaryImage?.uri ?? null);
      const solutionImageExists = primaryImage?.exists === true;

      return {
        id: record.id,
        reviewIndex: record.review_index,
        createdAt: record.created_at,
        result: normalizeDetailReviewResult(record.result),
        note: normalizeOptionalText(record.note),
        noteHighlights: parseStoredTextHighlights(record.note_highlights, record.note ?? ''),
        voiceNote: record.voice_note ?? null,
        solutionImageId,
        solutionImageUri,
        solutionImageExists,
        solutionImages,
      };
    }),
  );

  return mapped;
}

async function mapMistakeToDetailViewModelWithRecords(
  mistake: Mistake,
  imageSlots: DetailImageSlot[],
  reviewRecords: DetailReviewRecordItem[],
): Promise<MistakeDetailViewModel> {
  const base = await mapMistakeToDetailViewModel(mistake, imageSlots);
  return {
    ...base,
    reviewRecords,
  };
}

export async function getMistakeDetail(id: string): Promise<GetMistakeDetailResult> {
  const mistakeId = normalizeMistakeId(id);
  if (!mistakeId) {
    Logger.warn(SERVICE_SCOPE, 'Skip loading mistake detail because mistake id is empty.');
    return {
      ok: false,
      errorMessage: '错题 id 不能为空。',
    };
  }

  try {
    Logger.info(SERVICE_SCOPE, 'Start loading mistake detail.', {
      mistakeId,
    });

    const mistake = await MistakeRepository.getMistakeById(mistakeId);
    if (!mistake) {
      Logger.warn(SERVICE_SCOPE, 'Mistake detail not found.', {
        mistakeId,
      });
      return {
        ok: false,
        notFound: true,
        errorMessage: '未找到对应错题。',
      };
    }

    const mistakeImages = await MistakeImageRepository.getImagesByMistakeId(mistakeId);
    const imageSlots = await buildImageSlots(mistake, mistakeImages);
    const mistakeReviewRecords = await ReviewRecordRepository.listReviewRecordsByMistakeId(mistakeId);
    const reviewRecords = await mapReviewRecords(mistakeReviewRecords);
    const detail = await mapMistakeToDetailViewModelWithRecords(mistake, imageSlots, reviewRecords);

    Logger.info(SERVICE_SCOPE, 'Loaded mistake detail successfully.', {
      mistakeId,
      reviewCount: detail.reviewCount,
      status: detail.status,
      imageSlotCount: detail.imageSlots.length,
      reviewRecordCount: detail.reviewRecords.length,
      relatedCount: detail.relatedSummary.total,
    });

    return {
      ok: true,
      detail,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'getMistakeDetail failed.', { id: mistakeId, error });
    return {
      ok: false,
      errorMessage: toErrorMessage(error),
    };
  }
}

export async function getDetailBrowseContext(
  params: GetDetailBrowseContextParams,
): Promise<DetailBrowseContext> {
  const mistakeId = normalizeMistakeId(params.mistakeId);
  if (!mistakeId) {
    return {
      mode: 'none',
      ids: [],
      currentIndex: -1,
    };
  }

  try {
    const dueIds = normalizeMistakeIdList(await MistakeListService.getTodayReviewQueueIds());
    if (dueIds.includes(mistakeId)) {
      const context = buildBrowseContext('today_due', dueIds, mistakeId);
      Logger.info(SERVICE_SCOPE, 'Resolved detail browse context from today due queue.', {
        mistakeId,
        mode: context.mode,
        totalIds: context.ids.length,
        currentIndex: context.currentIndex,
      });
      return context;
    }

    const moduleName = normalizeOptionalText(params.module);
    if (!moduleName) {
      const context = buildBrowseContext('none', [mistakeId], mistakeId);
      Logger.info(SERVICE_SCOPE, 'Resolved detail browse context fallback because module is empty.', {
        mistakeId,
        mode: context.mode,
        totalIds: context.ids.length,
      });
      return context;
    }

    const sameModuleMistakes = await MistakeRepository.listMistakes({
      status: 'all',
      module: moduleName,
      sortBy: 'created_at',
      sortOrder: 'asc',
      limit: MODULE_NAVIGATION_LIMIT,
    });
    const sameModuleIds = normalizeMistakeIdList(sameModuleMistakes.map((mistake) => mistake.id));
    if (sameModuleIds.length > 0) {
      const context = buildBrowseContext('same_module', sameModuleIds, mistakeId);
      Logger.info(SERVICE_SCOPE, 'Resolved detail browse context from same module.', {
        mistakeId,
        module: moduleName,
        mode: context.mode,
        totalIds: context.ids.length,
        currentIndex: context.currentIndex,
      });
      return context;
    }

    const context = buildBrowseContext('none', [mistakeId], mistakeId);
    Logger.info(SERVICE_SCOPE, 'Resolved detail browse context fallback because no candidates found.', {
      mistakeId,
      module: moduleName,
      mode: context.mode,
      totalIds: context.ids.length,
    });
    return context;
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'getDetailBrowseContext failed.', {
      mistakeId,
      module: params.module,
      error,
    });
    return buildBrowseContext('none', [mistakeId], mistakeId);
  }
}

export async function saveOptionalDetailImage(
  params: SaveOptionalDetailImageParams,
): Promise<SaveOptionalDetailImageResult> {
  const upsertResult = await upsertMistakeDetailImage({
    mistakeId: params.mistakeId,
    imageType: params.imageType,
    imageUri: params.imageUri,
  });

  return {
    ok: upsertResult.ok,
    errorMessage: upsertResult.errorMessage,
  };
}

export async function upsertMistakeDetailImage(
  params: UpsertDetailImageParams,
): Promise<UpsertDetailImageResult> {
  const mistakeId = normalizeMistakeId(params.mistakeId);
  const imageUri = normalizeOptionalText(params.imageUri);

  if (!mistakeId) {
    return {
      ok: false,
      errorMessage: '错题 id 不能为空。',
    };
  }

  if (!imageUri) {
    return {
      ok: false,
      errorMessage: '图片地址不能为空。',
    };
  }

  if (!isManagedDetailImageType(params.imageType)) {
    return {
      ok: false,
      errorMessage: 'Unsupported image type.',
    };
  }

  try {
    const upsertedImage = await MistakeImageRepository.upsertMistakeImage(
      mistakeId,
      params.imageType,
      imageUri,
    );

    Logger.info(SERVICE_SCOPE, 'Upserted detail image successfully.', {
      mistakeId,
      imageType: params.imageType,
      imageId: upsertedImage.id,
      imageUriShort: toShortUri(upsertedImage.uri),
    });

    return {
      ok: true,
      imageId: upsertedImage.id,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'upsertMistakeDetailImage failed.', {
      mistakeId,
      imageType: params.imageType,
      imageUriShort: toShortUri(imageUri),
      error,
    });
    return {
      ok: false,
      errorMessage: toErrorMessage(error),
    };
  }
}

export async function deleteMistakeDetailImage(
  mistakeIdInput: string,
  imageType: ManagedDetailImageType,
): Promise<DeleteDetailImageResult> {
  const mistakeId = normalizeMistakeId(mistakeIdInput);
  if (!mistakeId) {
    return {
      ok: false,
      errorMessage: '错题 id 不能为空。',
    };
  }

  if (!isManagedDetailImageType(imageType)) {
    return {
      ok: false,
      errorMessage: 'Unsupported image type.',
    };
  }

  try {
    const deletedCount = await MistakeImageRepository.deleteMistakeImagesByType(mistakeId, imageType);
    Logger.info(SERVICE_SCOPE, 'Deleted detail image by type successfully.', {
      mistakeId,
      imageType,
      deletedCount,
    });
    return {
      ok: true,
      deletedCount,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'deleteMistakeDetailImage failed.', {
      mistakeId,
      imageType,
      error,
    });
    return {
      ok: false,
      errorMessage: toErrorMessage(error),
    };
  }
}

export async function deleteMistake(mistakeIdInput: string): Promise<DeleteMistakeResult> {
  const mistakeId = normalizeMistakeId(mistakeIdInput);
  if (!mistakeId) {
    return {
      ok: false,
      errorMessage: '错题 id 不能为空。',
    };
  }

  try {
    const reviewRecords = await ReviewRecordRepository.listReviewRecordsByMistakeId(mistakeId);
    const voiceNoteUris = Array.from(
      new Set(
        reviewRecords
          .map((record) => normalizeOptionalText(record.voice_note?.fileUri))
          .filter((uri): uri is string => typeof uri === 'string'),
      ),
    );

    const deleted = await MistakeRepository.deleteMistake(mistakeId);
    if (!deleted) {
      return {
        ok: false,
        deleted: false,
        errorMessage: '未找到对应错题。',
      };
    }

    const imageFolderDeleted = await deleteMistakeImageFolder(mistakeId);
    let deletedVoiceNoteCount = 0;
    let failedVoiceNoteCount = 0;

    for (const voiceNoteUri of voiceNoteUris) {
      const deleteVoiceResult = await VoiceNoteService.deleteVoiceNote(voiceNoteUri);
      if (deleteVoiceResult.ok) {
        if (deleteVoiceResult.deleted) {
          deletedVoiceNoteCount += 1;
        }
        continue;
      }

      failedVoiceNoteCount += 1;
      Logger.warn(SERVICE_SCOPE, 'Failed to delete voice note while deleting mistake.', {
        mistakeId,
        voiceNoteUriShort: toShortUri(voiceNoteUri),
        errorMessage: deleteVoiceResult.errorMessage ?? null,
      });
    }

    Logger.info(SERVICE_SCOPE, 'Deleted mistake successfully.', {
      mistakeId,
      imageFolderDeleted,
      deletedVoiceNoteCount,
      failedVoiceNoteCount,
    });

    return {
      ok: true,
      deleted: true,
      imageFolderDeleted,
      deletedVoiceNoteCount,
      failedVoiceNoteCount,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'deleteMistake failed.', {
      mistakeId,
      error,
    });
    return {
      ok: false,
      errorMessage: toErrorMessage(error, DELETE_MISTAKE_ERROR_MESSAGE),
    };
  }
}

export async function archiveMistake(mistakeIdInput: string): Promise<ArchiveMistakeResult> {
  const mistakeId = normalizeMistakeId(mistakeIdInput);
  if (!mistakeId) {
    return {
      ok: false,
      errorMessage: '错题 id 不能为空。',
    };
  }

  try {
    const current = await MistakeRepository.getMistakeById(mistakeId);
    if (!current) {
      return {
        ok: false,
        errorMessage: '未找到对应错题。',
      };
    }

    if (current.status !== REVIEW_STATUS.ARCHIVED) {
      const updated = await MistakeRepository.updateMistake(mistakeId, {
        status: REVIEW_STATUS.ARCHIVED,
        next_review_at: null,
      });
      if (!updated) {
        return {
          ok: false,
          errorMessage: '归档错题失败，请刷新后重试。',
        };
      }

      void ReviewReminderService.refreshReminderSchedule({ reason: 'archive_mistake' }).catch((error) => {
        Logger.warn(SERVICE_SCOPE, 'Reminder schedule refresh failed after archiving mistake.', {
          mistakeId,
          error,
        });
      });
    }

    const detailResult = await getMistakeDetail(mistakeId);
    if (!detailResult.ok || !detailResult.detail) {
      return {
        ok: false,
        errorMessage: detailResult.errorMessage ?? '错题已归档，但刷新详情失败。',
      };
    }

    Logger.info(SERVICE_SCOPE, 'Archived mistake successfully.', { mistakeId });
    return {
      ok: true,
      detail: detailResult.detail,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'archiveMistake failed.', { mistakeId, error });
    return {
      ok: false,
      errorMessage: toErrorMessage(error, '归档错题失败，请稍后重试。'),
    };
  }
}

export async function joinMistakeReviewPlan(
  mistakeIdInput: string,
): Promise<JoinMistakeReviewPlanResult> {
  const mistakeId = normalizeMistakeId(mistakeIdInput);
  if (!mistakeId) {
    return {
      ok: false,
      errorMessage: '错题 id 不能为空。',
    };
  }

  try {
    const current = await MistakeRepository.getMistakeById(mistakeId);
    if (!current) {
      return {
        ok: false,
        errorMessage: '未找到对应错题。',
      };
    }

    if (current.status === REVIEW_STATUS.ACTIVE) {
      const detailResult = await getMistakeDetail(mistakeId);
      return {
        ok: detailResult.ok,
        detail: detailResult.detail,
        errorMessage: detailResult.ok ? undefined : detailResult.errorMessage,
      };
    }

    if (current.status === REVIEW_STATUS.MASTERED) {
      return {
        ok: false,
        errorMessage: '这道题已完成七刷，不能重新加入七刷。',
      };
    }

    if (current.status === REVIEW_STATUS.ARCHIVED) {
      return {
        ok: false,
        errorMessage: '这道题已归档，不能加入七刷。',
      };
    }

    const updated = await MistakeRepository.joinMistakeReviewPlan(mistakeId, new Date().toISOString());
    if (!updated) {
      return {
        ok: false,
        errorMessage: '错题状态已变化，请刷新后重试。',
      };
    }

    void ReviewReminderService.refreshReminderSchedule({ reason: 'join_review_plan' }).catch((error) => {
      Logger.warn(SERVICE_SCOPE, 'Reminder schedule refresh failed after joining review plan.', {
        mistakeId,
        error,
      });
    });

    const detailResult = await getMistakeDetail(mistakeId);
    if (!detailResult.ok || !detailResult.detail) {
      return {
        ok: false,
        errorMessage: detailResult.errorMessage ?? '已加入七刷，但刷新详情失败。',
      };
    }

    Logger.info(SERVICE_SCOPE, 'Joined mistake review plan successfully.', {
      mistakeId,
      nextReviewAt: updated.next_review_at ?? null,
    });

    return {
      ok: true,
      detail: detailResult.detail,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'joinMistakeReviewPlan failed.', {
      mistakeId,
      error,
    });
    return {
      ok: false,
      errorMessage: toErrorMessage(error),
    };
  }
}

export async function updateMistakeDetailImageUri(
  params: UpdateDetailImageUriParams,
): Promise<UpdateDetailImageUriResult> {
  const imageId = normalizeOptionalText(params.imageId);
  const newUri = normalizeOptionalText(params.newUri);

  if (!imageId) {
    return {
      ok: false,
      errorMessage: 'Image id cannot be empty.',
    };
  }

  if (!newUri) {
    return {
      ok: false,
      errorMessage: 'Image uri cannot be empty.',
    };
  }

  try {
    const updatedImage = await MistakeImageRepository.updateMistakeImageUri(imageId, newUri);
    if (!updatedImage) {
      return {
        ok: false,
        errorMessage: 'Image not found.',
      };
    }

    Logger.info(SERVICE_SCOPE, 'Updated detail image uri successfully.', {
      imageId: updatedImage.id,
      imageType: updatedImage.type,
      imageUriShort: toShortUri(updatedImage.uri),
    });

    return {
      ok: true,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'updateMistakeDetailImageUri failed.', {
      imageId,
      imageUriShort: toShortUri(newUri),
      error,
    });
    return {
      ok: false,
      errorMessage: toErrorMessage(error),
    };
  }
}

export async function updateMistakeTitle(
  params: UpdateMistakeTitleParams,
): Promise<UpdateMistakeTitleResult> {
  const mistakeId = normalizeMistakeId(params.mistakeId);
  if (!mistakeId) {
    return {
      ok: false,
      errorMessage: '错题 id 不能为空。',
    };
  }

  const nextTitle = normalizeOptionalText(params.title);
  if (!nextTitle) {
    return {
      ok: false,
      errorMessage: '题目名字不能为空。',
    };
  }

  try {
    const updated = await MistakeRepository.updateMistake(mistakeId, {
      title: nextTitle,
    });
    if (!updated) {
      return {
        ok: false,
        errorMessage: '未找到对应错题。',
      };
    }

    Logger.info(SERVICE_SCOPE, 'Updated mistake title successfully.', {
      mistakeId,
      titleLength: nextTitle.length,
    });

    const detailResult = await getMistakeDetail(mistakeId);
    if (!detailResult.ok || !detailResult.detail) {
      return {
        ok: false,
        errorMessage: detailResult.errorMessage ?? '标题已更新，但刷新详情失败。',
      };
    }

    return {
      ok: true,
      detail: detailResult.detail,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'updateMistakeTitle failed.', {
      mistakeId,
      error,
    });
    return {
      ok: false,
      errorMessage: toErrorMessage(error),
    };
  }
}

export async function updateMistakeModule(
  params: UpdateMistakeModuleParams,
): Promise<UpdateMistakeModuleResult> {
  const mistakeId = normalizeMistakeId(params.mistakeId);
  if (!mistakeId) {
    return {
      ok: false,
      errorMessage: '错题 id 不能为空。',
    };
  }

  const nextModule = normalizeOptionalText(params.module);
  if (!nextModule) {
    return {
      ok: false,
      errorMessage: '模块不能为空。',
    };
  }

  try {
    const currentMistake = await MistakeRepository.getMistakeById(mistakeId);
    if (!currentMistake) {
      return {
        ok: false,
        errorMessage: '未找到对应错题。',
      };
    }

    const nextTitle = buildTitleAfterModuleUpdate(
      currentMistake.title,
      currentMistake.module,
      nextModule,
    );
    const updated = await MistakeRepository.updateMistake(mistakeId, {
      module: nextModule,
      title: nextTitle ?? null,
    });
    if (!updated) {
      return {
        ok: false,
        errorMessage: '未找到对应错题。',
      };
    }

    Logger.info(SERVICE_SCOPE, 'Updated mistake module successfully.', {
      mistakeId,
      module: nextModule,
    });

    const detailResult = await getMistakeDetail(mistakeId);
    if (!detailResult.ok || !detailResult.detail) {
      return {
        ok: false,
        errorMessage: detailResult.errorMessage ?? '模块已更新，但刷新详情失败。',
      };
    }

    return {
      ok: true,
      detail: detailResult.detail,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'updateMistakeModule failed.', {
      mistakeId,
      module: nextModule,
      error,
    });
    return {
      ok: false,
      errorMessage: toErrorMessage(error),
    };
  }
}

export async function updateMistakeMetadata(
  params: UpdateMistakeMetadataParams,
): Promise<UpdateMistakeMetadataResult> {
  const mistakeId = normalizeMistakeId(params.mistakeId);
  if (!mistakeId) {
    return {
      ok: false,
      errorMessage: '错题 id 不能为空。',
    };
  }

  const nextDifficulty = normalizeDetailDifficulty(params.difficulty);
  if (!nextDifficulty) {
    return {
      ok: false,
      errorMessage: '难度必须是 1 到 5。',
    };
  }

  const nextErrorReason = normalizeOptionalText(params.errorReason ?? null);

  try {
    const updated = await MistakeRepository.updateMistake(mistakeId, {
      error_reason: nextErrorReason,
      difficulty: nextDifficulty,
    });
    if (!updated) {
      return {
        ok: false,
        errorMessage: '未找到对应错题。',
      };
    }

    Logger.info(SERVICE_SCOPE, 'Updated mistake metadata successfully.', {
      mistakeId,
      hasErrorReason: nextErrorReason !== null,
      difficulty: nextDifficulty,
    });

    const detailResult = await getMistakeDetail(mistakeId);
    if (!detailResult.ok || !detailResult.detail) {
      return {
        ok: false,
        errorMessage: detailResult.errorMessage ?? '错因和难度已更新，但刷新详情失败。',
      };
    }

    return {
      ok: true,
      detail: detailResult.detail,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'updateMistakeMetadata failed.', {
      mistakeId,
      hasErrorReason: nextErrorReason !== null,
      difficulty: nextDifficulty,
      error,
    });
    return {
      ok: false,
      errorMessage: toErrorMessage(error),
    };
  }
}

export async function updateMistakeNote(
  params: UpdateMistakeNoteParams,
): Promise<UpdateMistakeNoteResult> {
  const mistakeId = normalizeMistakeId(params.mistakeId);
  if (!mistakeId) {
    return {
      ok: false,
      errorMessage: '错题 id 不能为空。',
    };
  }

  const nextNote = normalizeOptionalText(params.note ?? null);
  const shouldUpdateHighlights = Object.prototype.hasOwnProperty.call(params, 'noteHighlights');
  const nextNoteHighlights = shouldUpdateHighlights
    ? serializeTextHighlights(params.noteHighlights ?? [], nextNote ?? '')
    : undefined;
  if (nextNote && nextNote.length > MISTAKE_DETAIL_NOTE_MAX_LENGTH) {
    return {
      ok: false,
      errorMessage: `备注不能超过 ${MISTAKE_DETAIL_NOTE_MAX_LENGTH} 字。`,
    };
  }

  try {
    const updated = await MistakeRepository.updateMistake(mistakeId, {
      note: nextNote,
      ...(shouldUpdateHighlights ? { note_highlights: nextNoteHighlights } : {}),
    });
    if (!updated) {
      return {
        ok: false,
        errorMessage: '未找到对应错题。',
      };
    }

    Logger.info(SERVICE_SCOPE, 'Updated mistake note successfully.', {
      mistakeId,
      noteLength: nextNote?.length ?? 0,
    });

    const detailResult = await getMistakeDetail(mistakeId);
    if (!detailResult.ok || !detailResult.detail) {
      return {
        ok: false,
        errorMessage: detailResult.errorMessage ?? '备注已更新，但刷新详情失败。',
      };
    }

    return {
      ok: true,
      detail: detailResult.detail,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'updateMistakeNote failed.', {
      mistakeId,
      error,
    });
    return {
      ok: false,
      errorMessage: toErrorMessage(error),
    };
  }
}

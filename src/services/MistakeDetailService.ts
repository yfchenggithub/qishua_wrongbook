import { MAX_REVIEW_COUNT, REVIEW_STATUS } from '@/src/constants/review';
import type {
  DetailImageSlot,
  DetailReviewRecordItem,
  DetailReviewResult,
  MistakeDetailViewModel,
} from '@/src/models/MistakeDetailViewModel';
import type { Mistake, MistakeStatus } from '@/src/models/Mistake';
import type { MistakeImage } from '@/src/models/MistakeImage';
import { MistakeImageRepository, MistakeRepository, ReviewRecordRepository } from '@/src/repositories';
import { Logger } from '@/src/services/Logger';
import { getImageInfo } from '@/src/services/ImageStorageService';
import { formatDateShort } from '@/src/utils/date';

const SERVICE_SCOPE = 'MistakeDetailService';
const FALLBACK_ERROR_MESSAGE = '读取错题详情失败，请稍后重试。';

export type ManagedDetailImageType = Exclude<DetailImageSlot['type'], 'review_solution'>;

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

type SlotSeed = {
  type: DetailImageSlot['type'];
  title: string;
  uri?: string | null;
  emptyText: string;
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const trimmed = error.message.trim();
    return trimmed.length > 0 ? trimmed : FALLBACK_ERROR_MESSAGE;
  }
  const text = String(error ?? '').trim();
  return text.length > 0 ? text : FALLBACK_ERROR_MESSAGE;
}

function normalizeMistakeId(id: string): string {
  return typeof id === 'string' ? id.trim() : '';
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

function findFirstUriByType(images: MistakeImage[], type: DetailImageSlot['type']): string | null {
  for (const image of images) {
    if (image.type !== type) {
      continue;
    }

    const uri = normalizeOptionalText(image.uri);
    if (uri) {
      return uri;
    }
  }

  return null;
}

function buildStatusLabel(status: MistakeStatus, reviewCount: number): string {
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

async function enrichSlotWithLocalFileInfo(slot: DetailImageSlot): Promise<DetailImageSlot> {
  const uri = normalizeOptionalText(slot.uri);
  if (!uri) {
    return {
      ...slot,
      uri: null,
      exists: false,
      fileSize: null,
    };
  }

  try {
    const info = await getImageInfo(uri);
    return {
      ...slot,
      uri,
      exists: info.exists,
      fileSize: info.size ?? null,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Image file check failed, fallback to exists=false.', {
      uriShort: toShortUri(uri),
      error,
    });
    return {
      ...slot,
      uri,
      exists: false,
      fileSize: null,
    };
  }
}

async function buildImageSlots(_mistake: Mistake, images: MistakeImage[]): Promise<DetailImageSlot[]> {
  const questionUri = findFirstUriByType(images, 'question');
  const mySolutionUri = findFirstUriByType(images, 'my_solution');
  const answerUri = findFirstUriByType(images, 'answer');

  const slotSeeds: SlotSeed[] = [
    {
      type: 'question',
      title: '题目',
      uri: questionUri,
      emptyText: '还没有题目图片',
    },
    {
      type: 'my_solution',
      title: '我的做法',
      uri: mySolutionUri,
      emptyText: '还没有添加做法图片',
    },
    {
      type: 'answer',
      title: '答案解析',
      uri: answerUri,
      emptyText: '还没有添加答案解析图片',
    },
  ];

  return Promise.all(slotSeeds.map((seed) => enrichSlotWithLocalFileInfo({ ...seed })));
}

function mapMistakeToDetailViewModel(mistake: Mistake, imageSlots: DetailImageSlot[]): MistakeDetailViewModel {
  return {
    id: mistake.id,
    module: mistake.module,
    title: buildDetailTitle(mistake.module, mistake.title),
    subtitle: buildSubtitle(mistake),
    errorReason: mistake.error_reason ?? null,
    difficulty: mistake.difficulty,
    note: mistake.note ?? null,
    reviewCount: mistake.review_count,
    maxReviewCount: MAX_REVIEW_COUNT,
    status: mistake.status,
    statusLabel: buildStatusLabel(mistake.status, mistake.review_count),
    nextReviewAt: mistake.next_review_at ?? null,
    createdAt: mistake.created_at,
    updatedAt: mistake.updated_at,
    imageSlots,
    reviewRecords: [],
  };
}

async function mapReviewRecords(
  mistakeReviewRecords: Awaited<ReturnType<typeof ReviewRecordRepository.listReviewRecordsByMistakeId>>,
): Promise<DetailReviewRecordItem[]> {
  const mapped = await Promise.all(
    mistakeReviewRecords.map(async (record) => {
      const reviewSolutionImages = await MistakeImageRepository.getReviewSolutionImages(record.id);
      const solutionImageUri = normalizeOptionalText(reviewSolutionImages[0]?.uri ?? null);

      return {
        id: record.id,
        reviewIndex: record.review_index,
        createdAt: record.created_at,
        result: normalizeDetailReviewResult(record.result),
        solutionImageUri,
      };
    }),
  );

  return mapped;
}

function mapMistakeToDetailViewModelWithRecords(
  mistake: Mistake,
  imageSlots: DetailImageSlot[],
  reviewRecords: DetailReviewRecordItem[],
): MistakeDetailViewModel {
  const base = mapMistakeToDetailViewModel(mistake, imageSlots);
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
    const detail = mapMistakeToDetailViewModelWithRecords(mistake, imageSlots, reviewRecords);

    Logger.info(SERVICE_SCOPE, 'Loaded mistake detail successfully.', {
      mistakeId,
      reviewCount: detail.reviewCount,
      status: detail.status,
      imageSlotCount: detail.imageSlots.length,
      reviewRecordCount: detail.reviewRecords.length,
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

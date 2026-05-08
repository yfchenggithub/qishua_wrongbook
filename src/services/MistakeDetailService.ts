import { MAX_REVIEW_COUNT, REVIEW_STATUS } from '@/src/constants/review';
import type {
  DetailImageSlot,
  DetailReviewRecordItem,
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

type GetMistakeDetailResult = {
  ok: boolean;
  detail?: MistakeDetailViewModel;
  errorMessage?: string;
  notFound?: boolean;
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
      uri,
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

async function buildImageSlots(mistake: Mistake, images: MistakeImage[]): Promise<DetailImageSlot[]> {
  const questionUri =
    normalizeOptionalText(mistake.question_image_uri) ?? findFirstUriByType(images, 'question');
  const mySolutionUri = findFirstUriByType(images, 'my_solution');
  const answerUri =
    normalizeOptionalText(mistake.answer_image_uri) ?? findFirstUriByType(images, 'answer');

  const slotSeeds: SlotSeed[] = [
    {
      type: 'question',
      title: '题目',
      uri: questionUri,
      emptyText: '暂无题目图片',
    },
    {
      type: 'my_solution',
      title: '我的做法',
      uri: mySolutionUri,
      emptyText: '暂无我的做法图片',
    },
    {
      type: 'answer',
      title: '答案',
      uri: answerUri,
      emptyText: '暂无答案图片',
    },
  ];

  return Promise.all(
    slotSeeds.map((seed) =>
      enrichSlotWithLocalFileInfo({
        ...seed,
      }),
    ),
  );
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

function mapReviewRecords(mistakeReviewRecords: Awaited<ReturnType<typeof ReviewRecordRepository.listReviewRecordsByMistakeId>>): DetailReviewRecordItem[] {
  return mistakeReviewRecords.map((record) => ({
    id: record.id,
    reviewIndex: record.review_index,
    createdAt: record.created_at,
    result: record.result,
    solutionImageUri: normalizeOptionalText(record.solution_image_uri),
  }));
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
    return {
      ok: false,
      errorMessage: '错题 id 不能为空。',
    };
  }

  try {
    const mistake = await MistakeRepository.getMistakeById(mistakeId);
    if (!mistake) {
      return {
        ok: false,
        notFound: true,
        errorMessage: '未找到对应错题。',
      };
    }

    const mistakeImages = await MistakeImageRepository.listImagesByMistakeId(mistakeId);
    const imageSlots = await buildImageSlots(mistake, mistakeImages);
    const mistakeReviewRecords = await ReviewRecordRepository.listReviewRecordsByMistakeId(mistakeId);
    const reviewRecords = mapReviewRecords(mistakeReviewRecords);
    const detail = mapMistakeToDetailViewModelWithRecords(mistake, imageSlots, reviewRecords);

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

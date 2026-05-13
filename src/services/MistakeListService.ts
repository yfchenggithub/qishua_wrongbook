import { MAX_REVIEW_COUNT, REVIEW_STATUS } from '@/src/constants/review';
import type { Mistake, MistakeStatus } from '@/src/models/Mistake';
import type {
  MistakeListFilter,
  MistakeListItem,
  MistakeListStatus,
} from '@/src/models/MistakeListItem';
import { MistakeImageRepository, MistakeRepository, type ListMistakesOptions } from '@/src/repositories';
import { Logger } from '@/src/services/Logger';
import { formatDateShort, isDueTodayOrBefore } from '@/src/utils/date';

const SERVICE_SCOPE = 'MistakeListService';

function toKeywordPreview(keyword: string): string {
  const trimmed = keyword.trim();
  if (trimmed.length <= 32) {
    return trimmed;
  }
  return `${trimmed.slice(0, 20)}...${trimmed.slice(-8)}`;
}

function normalizeKeyword(keyword: string): string | null {
  const trimmed = keyword.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeModule(module: string | null | undefined): string | null {
  if (typeof module !== 'string') {
    return null;
  }
  const trimmed = module.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildListQueryOptions(filter: MistakeListFilter): ListMistakesOptions {
  const keyword = normalizeKeyword(filter.keyword);
  const module = normalizeModule(filter.module);

  const baseOptions: ListMistakesOptions = {
    keyword,
    module,
  };

  if (filter.segment === 'due') {
    return {
      ...baseOptions,
      dueOnly: true,
      sortBy: 'next_review_at',
      sortOrder: 'asc',
    };
  }

  if (filter.segment === 'mastered') {
    return {
      ...baseOptions,
      status: REVIEW_STATUS.MASTERED,
      sortBy: 'updated_at',
      sortOrder: 'desc',
    };
  }

  return {
    ...baseOptions,
    status: 'all',
    sortBy: 'updated_at',
    sortOrder: 'desc',
  };
}

function buildDisplayStatus(
  status: MistakeStatus,
  nextReviewAt?: string | null,
): MistakeListStatus {
  if (status === REVIEW_STATUS.MASTERED) {
    return 'mastered';
  }
  if (status === REVIEW_STATUS.ARCHIVED) {
    return 'archived';
  }
  if (isDueTodayOrBefore(nextReviewAt)) {
    return 'due_today';
  }
  return 'upcoming';
}

function buildReviewIndexLabel(reviewCount: number): string {
  const nextIndex = Math.floor(reviewCount) + 1;
  const clampedIndex = Math.min(MAX_REVIEW_COUNT, Math.max(1, nextIndex));
  return String(clampedIndex);
}

function buildStatusLabel(mistake: Mistake): string {
  if (mistake.status === REVIEW_STATUS.MASTERED) {
    return '已七刷';
  }
  if (mistake.status === REVIEW_STATUS.ARCHIVED) {
    return '已归档';
  }

  if (isDueTodayOrBefore(mistake.next_review_at)) {
    return `今天第 ${buildReviewIndexLabel(mistake.review_count)} 刷`;
  }
  return '待复做';
}

function buildTitle(module: string, title?: string | null): string {
  const normalizedTitle = typeof title === 'string' ? title.trim() : '';
  if (normalizedTitle.length > 0) {
    return normalizedTitle;
  }
  return `${module}错题`;
}

function buildSubtitle(mistake: Mistake): string {
  const subtitleParts: string[] = [];
  const reason = typeof mistake.error_reason === 'string' ? mistake.error_reason.trim() : '';

  if (reason.length > 0) {
    subtitleParts.push(reason);
  }
  subtitleParts.push(`难度 ${mistake.difficulty}`);
  subtitleParts.push(formatDateShort(mistake.created_at));

  return subtitleParts.join(' · ');
}

export function mapMistakeToListItem(mistake: Mistake, thumbnailUri?: string | null): MistakeListItem {
  return {
    id: mistake.id,
    module: mistake.module,
    title: buildTitle(mistake.module, mistake.title),
    subtitle: buildSubtitle(mistake),
    errorReason: mistake.error_reason ?? null,
    difficulty: mistake.difficulty,
    thumbnailUri: thumbnailUri ?? null,
    reviewCount: mistake.review_count,
    maxReviewCount: MAX_REVIEW_COUNT,
    status: mistake.status,
    displayStatus: buildDisplayStatus(mistake.status, mistake.next_review_at),
    statusLabel: buildStatusLabel(mistake),
    nextReviewAt: mistake.next_review_at ?? null,
    createdAt: mistake.created_at,
    updatedAt: mistake.updated_at,
  };
}

export async function getMistakeListItems(filter: MistakeListFilter): Promise<MistakeListItem[]> {
  try {
    Logger.info(SERVICE_SCOPE, 'Start loading mistake list items.', {
      segment: filter.segment,
      keywordPreview: toKeywordPreview(filter.keyword),
      module: filter.module ?? null,
    });
    const options = buildListQueryOptions(filter);
    const mistakes = await MistakeRepository.listMistakes(options);
    const listItems = await Promise.all(
      mistakes.map(async (mistake) => {
        const coverImage = await MistakeImageRepository.getCoverImageForMistake(mistake.id);
        return mapMistakeToListItem(mistake, coverImage?.uri ?? null);
      }),
    );
    Logger.info(SERVICE_SCOPE, 'Loaded mistake list items successfully.', {
      segment: filter.segment,
      keywordPreview: toKeywordPreview(filter.keyword),
      module: filter.module ?? null,
      count: listItems.length,
    });
    return listItems;
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'getMistakeListItems failed.', { filter, error });
    throw error;
  }
}

export async function getMistakeListStats(): Promise<{
  total: number;
  due: number;
  mastered: number;
}> {
  try {
    Logger.info(SERVICE_SCOPE, 'Start loading mistake list stats.');
    const stats = await MistakeRepository.getMistakeStats();
    const mappedStats = {
      total: stats.total,
      due: stats.dueToday,
      mastered: stats.mastered,
    };
    Logger.info(SERVICE_SCOPE, 'Loaded mistake list stats successfully.', mappedStats);
    return mappedStats;
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'getMistakeListStats failed.', error);
    throw error;
  }
}

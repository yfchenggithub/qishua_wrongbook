import { MAX_REVIEW_COUNT, REVIEW_STATUS } from '@/src/constants/review';
import type { Mistake, MistakeStatus } from '@/src/models/Mistake';
import type { MistakeTag } from '@/src/models/MistakeTag';
import type {
  MistakeListFilter,
  MistakeListItem,
  MistakeListStatus,
} from '@/src/models/MistakeListItem';
import type { TodayReviewExportItem } from '@/src/models/TodayReviewExportItem';
import {
  MistakeImageRepository,
  MistakeRepository,
  MistakeTagRepository,
  ReviewRecordRepository,
  type ListMistakesOptions,
  type MistakeTagCount,
} from '@/src/repositories';
import { Logger } from '@/src/services/Logger';
import {
  formatDateShort,
  getLocalDayRange,
  isDueTodayOrBefore,
  parseLocalDateTime,
  toDateOnlyString,
} from '@/src/utils/date';

const SERVICE_SCOPE = 'MistakeListService';
const UPCOMING_MAX_PER_DAY = 3;

export type HomeStatus = 'empty' | 'dueToday' | 'noDueToday' | 'completedToday';

export interface TodayCompletedStats {
  total: number;
  mastered: number;
  unsure: number;
  wrong: number;
}

export interface UpcomingReviewPlanItem {
  mistakeId: string;
  title: string;
  module: string;
  reviewCount: number;
  nextReviewIndex: number;
}

export interface UpcomingReviewPlanDay {
  dayOffset: number;
  dayLabel: string;
  date: string;
  totalCount: number;
  remainingCount: number;
  items: UpcomingReviewPlanItem[];
}

export interface MistakeModuleCount {
  module: string;
  count: number;
}

export interface MistakeTagFilterCount {
  name: string;
  normalizedName: string;
  count: number;
}

export interface HomeTaskSummary {
  hasAnyMistake: boolean;
  todayDueCount: number;
  todayQueue: MistakeListItem[];
  todayCompletedStats: TodayCompletedStats;
  homeStatus: HomeStatus;
  upcomingPlan: UpcomingReviewPlanDay[];
}

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

function normalizeTagKeys(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const tagKey = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLocaleLowerCase() : '';
    if (!tagKey || seen.has(tagKey)) {
      continue;
    }
    normalized.push(tagKey);
    seen.add(tagKey);
  }
  return normalized;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildListQueryOptions(filter: MistakeListFilter): ListMistakesOptions {
  const keyword = normalizeKeyword(filter.keyword);
  const module = normalizeModule(filter.module);
  const tagKeys = normalizeTagKeys(filter.tagKeys);

  const baseOptions: ListMistakesOptions = {
    keyword,
    module,
    tagKeys,
    limit: filter.limit,
  };

  if (filter.segment === 'due') {
    return {
      ...baseOptions,
      dueOnly: true,
      sortBy: 'next_review_at',
      sortOrder: 'asc',
    };
  }

  if (filter.segment === 'collected') {
    return {
      ...baseOptions,
      status: REVIEW_STATUS.COLLECTED,
      sortBy: 'updated_at',
      sortOrder: 'desc',
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
  if (status === REVIEW_STATUS.COLLECTED) {
    return 'collected';
  }
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
  if (mistake.status === REVIEW_STATUS.COLLECTED) {
    return '待整理';
  }
  if (mistake.status === REVIEW_STATUS.MASTERED) {
    return '已掌握';
  }
  if (mistake.status === REVIEW_STATUS.ARCHIVED) {
    return '已归档';
  }

  if (isDueTodayOrBefore(mistake.next_review_at)) {
    return `待复做 第${buildReviewIndexLabel(mistake.review_count)}刷`;
  }
  return '待安排';
}

function buildTitle(module: string, title?: string | null): string {
  const normalizedTitle = normalizeOptionalText(title);
  if (normalizedTitle) {
    return normalizedTitle;
  }
  const normalizedModule = normalizeOptionalText(module) ?? '未分类';
  return `${normalizedModule} · 第 1 题`;
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

function clampNextReviewIndex(reviewCount: number): number {
  return Math.max(1, Math.min(MAX_REVIEW_COUNT, Math.floor(reviewCount) + 1));
}

function resolveExportBaseDate(date?: string): Date {
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

function buildTodayReviewQueueQuery(baseDate = new Date()): {
  todayStartIso: string;
  todayEndIso: string;
} {
  const { start: todayStart, end: todayEnd } = getLocalDayRange(baseDate, 0);
  return {
    todayStartIso: todayStart.toISOString(),
    todayEndIso: todayEnd.toISOString(),
  };
}

async function listTodayReviewQueueMistakes(baseDate = new Date()): Promise<Mistake[]> {
  return MistakeRepository.listTodayReviewQueue(buildTodayReviewQueueQuery(baseDate));
}

function resolveDueDateForExport(nextReviewAt: string | null | undefined, fallbackDate: Date): string {
  const parsedDueDate = parseLocalDateTime(nextReviewAt ?? null);
  if (parsedDueDate) {
    return toDateOnlyString(parsedDueDate);
  }
  return toDateOnlyString(fallbackDate);
}

function buildUpcomingDayLabel(dayOffset: number): string {
  if (dayOffset === 1) {
    return '明天';
  }
  if (dayOffset === 2) {
    return '后天';
  }
  if (dayOffset === 3) {
    return '大后天';
  }
  return `+${dayOffset}天`;
}

async function mapMistakeWithCoverToListItem(mistake: Mistake): Promise<MistakeListItem> {
  const coverImage = await MistakeImageRepository.getCoverImageForMistake(mistake.id);
  const tags = await MistakeTagRepository.listTagsByMistakeId(mistake.id);
  return {
    id: mistake.id,
    module: mistake.module,
    title: buildTitle(mistake.module, mistake.title),
    subtitle: buildSubtitle(mistake),
    errorReason: mistake.error_reason ?? null,
    tags,
    difficulty: mistake.difficulty,
    thumbnailUri: coverImage?.uri ?? null,
    reviewCount: mistake.review_count,
    maxReviewCount: MAX_REVIEW_COUNT,
    status: mistake.status,
    displayStatus: buildDisplayStatus(mistake.status, mistake.next_review_at),
    statusLabel: buildStatusLabel(mistake),
    nextReviewAt: mistake.next_review_at ?? null,
    lastReviewAt: mistake.last_review_at ?? null,
    createdAt: mistake.created_at,
    updatedAt: mistake.updated_at,
    isPinned: mistake.is_pinned,
    lastViewedAt: mistake.last_viewed_at ?? null,
  };
}

export function mapMistakeToListItem(
  mistake: Mistake,
  thumbnailUri?: string | null,
  tags: MistakeTag[] = [],
): MistakeListItem {
  return {
    id: mistake.id,
    module: mistake.module,
    title: buildTitle(mistake.module, mistake.title),
    subtitle: buildSubtitle(mistake),
    errorReason: mistake.error_reason ?? null,
    tags,
    difficulty: mistake.difficulty,
    thumbnailUri: thumbnailUri ?? null,
    reviewCount: mistake.review_count,
    maxReviewCount: MAX_REVIEW_COUNT,
    status: mistake.status,
    displayStatus: buildDisplayStatus(mistake.status, mistake.next_review_at),
    statusLabel: buildStatusLabel(mistake),
    nextReviewAt: mistake.next_review_at ?? null,
    lastReviewAt: mistake.last_review_at ?? null,
    createdAt: mistake.created_at,
    updatedAt: mistake.updated_at,
    isPinned: mistake.is_pinned,
    lastViewedAt: mistake.last_viewed_at ?? null,
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
    const coverMap = await MistakeImageRepository.getCoverImagesForMistakes(
      mistakes.map((mistake) => mistake.id),
    );
    const tagsMap = await MistakeTagRepository.listTagsByMistakeIds(
      mistakes.map((mistake) => mistake.id),
    );
    const listItems = mistakes.map((mistake) =>
      mapMistakeToListItem(
        mistake,
        coverMap.get(mistake.id)?.uri ?? null,
        tagsMap.get(mistake.id) ?? [],
      ),
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
  collected: number;
  due: number;
  mastered: number;
}> {
  try {
    Logger.info(SERVICE_SCOPE, 'Start loading mistake list stats.');
    const stats = await MistakeRepository.getMistakeStats();
    const mappedStats = {
      total: stats.total,
      collected: stats.collected,
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

export async function setMistakePinned(
  mistakeId: string,
  isPinned: boolean,
): Promise<MistakeListItem | null> {
  try {
    const updated = await MistakeRepository.setMistakePinned(mistakeId, isPinned);
    if (!updated) {
      return null;
    }
    return mapMistakeWithCoverToListItem(updated);
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'setMistakePinned failed.', { mistakeId, isPinned, error });
    throw error;
  }
}

export async function markMistakeViewed(mistakeId: string): Promise<void> {
  try {
    await MistakeRepository.updateLastViewedAt(mistakeId);
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'markMistakeViewed failed.', { mistakeId, error });
  }
}

export async function getMistakeModuleCounts(filter: MistakeListFilter): Promise<MistakeModuleCount[]> {
  try {
    Logger.info(SERVICE_SCOPE, 'Start loading mistake module counts.', {
      segment: filter.segment,
      keywordPreview: toKeywordPreview(filter.keyword),
    });
    const options = buildListQueryOptions({
      ...filter,
      module: null,
    });
    const moduleCounts = await MistakeRepository.countMistakesByModule(options);
    Logger.info(SERVICE_SCOPE, 'Loaded mistake module counts successfully.', {
      segment: filter.segment,
      keywordPreview: toKeywordPreview(filter.keyword),
      count: moduleCounts.length,
    });
    return moduleCounts;
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'getMistakeModuleCounts failed.', { filter, error });
    throw error;
  }
}

function mapTagCount(row: MistakeTagCount): MistakeTagFilterCount {
  return {
    name: row.name,
    normalizedName: row.normalizedName,
    count: row.count,
  };
}

export async function getMistakeTagFilterCounts(
  filter: MistakeListFilter,
): Promise<MistakeTagFilterCount[]> {
  try {
    Logger.info(SERVICE_SCOPE, 'Start loading mistake tag filter counts.', {
      segment: filter.segment,
      keywordPreview: toKeywordPreview(filter.keyword),
      module: filter.module ?? null,
      tagCount: filter.tagKeys?.length ?? 0,
    });
    const options = buildListQueryOptions({
      ...filter,
      tagKeys: [],
    });
    const tagCounts = await MistakeRepository.countMistakeTags(options);
    const mapped = tagCounts.map(mapTagCount);
    Logger.info(SERVICE_SCOPE, 'Loaded mistake tag filter counts successfully.', {
      segment: filter.segment,
      keywordPreview: toKeywordPreview(filter.keyword),
      module: filter.module ?? null,
      count: mapped.length,
    });
    return mapped;
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'getMistakeTagFilterCounts failed.', { filter, error });
    throw error;
  }
}

export async function getTodayReviewQueue(): Promise<MistakeListItem[]> {
  try {
    const dueMistakes = await listTodayReviewQueueMistakes(new Date());
    return Promise.all(dueMistakes.map(mapMistakeWithCoverToListItem));
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'getTodayReviewQueue failed.', error);
    throw error;
  }
}

export async function getTodayReviewQueueIds(): Promise<string[]> {
  try {
    const dueMistakes = await listTodayReviewQueueMistakes(new Date());
    return dueMistakes.map((mistake) => mistake.id);
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'getTodayReviewQueueIds failed.', error);
    throw error;
  }
}

export async function getPendingReviewCountByDate(date: Date): Promise<number> {
  try {
    const baseDate = date instanceof Date ? date : new Date();
    const dueMistakes = await listTodayReviewQueueMistakes(baseDate);
    return dueMistakes.length;
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'getPendingReviewCountByDate failed.', {
      date: date instanceof Date ? date.toISOString() : null,
      error,
    });
    throw error;
  }
}

export async function getTodayReviewQueueCount(): Promise<number> {
  return getPendingReviewCountByDate(new Date());
}

export async function getTodayReviewExportItems(date?: string): Promise<TodayReviewExportItem[]> {
  try {
    const baseDate = resolveExportBaseDate(date);
    const { start: todayStart } = getLocalDayRange(baseDate, 0);
    const dueMistakes = await listTodayReviewQueueMistakes(baseDate);

    if (dueMistakes.length <= 0) {
      return [];
    }

    const items = await Promise.all(
      dueMistakes.map(async (mistake): Promise<TodayReviewExportItem> => {
        const questionImages = await MistakeImageRepository.getImagesByMistakeIdAndType(
          mistake.id,
          'question',
        );
        const questionImageUri = normalizeOptionalText(questionImages[0]?.uri ?? null);

        return {
          mistakeId: mistake.id,
          title: buildTitle(mistake.module, mistake.title),
          module: mistake.module,
          difficulty: Number.isFinite(mistake.difficulty) ? mistake.difficulty : null,
          currentReviewIndex: clampNextReviewIndex(mistake.review_count),
          totalReviewCount: MAX_REVIEW_COUNT,
          questionImageUri,
          dueDate: resolveDueDateForExport(mistake.next_review_at ?? null, todayStart),
        };
      }),
    );

    return items;
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'getTodayReviewExportItems failed.', { date, error });
    return [];
  }
}

export async function getUpcomingReviewPlan(days = 3): Promise<UpcomingReviewPlanDay[]> {
  try {
    const now = new Date();
    const normalizedDays = Number.isFinite(days) ? Math.max(1, Math.floor(days)) : 3;
    const firstDayRange = getLocalDayRange(now, 1);
    const lastDayRange = getLocalDayRange(now, normalizedDays);
    const upcomingMistakes = await MistakeRepository.listActiveMistakesByNextReviewRange({
      startInclusiveIso: firstDayRange.start.toISOString(),
      endInclusiveIso: lastDayRange.end.toISOString(),
    });

    const dayRanges = Array.from({ length: normalizedDays }, (_, index) => {
      const dayOffset = index + 1;
      const range = getLocalDayRange(now, dayOffset);
      return {
        dayOffset,
        start: range.start,
        end: range.end,
        items: [] as Mistake[],
      };
    });

    for (const mistake of upcomingMistakes) {
      const nextReviewDate = parseLocalDateTime(mistake.next_review_at ?? null);
      if (!nextReviewDate) {
        continue;
      }
      const nextReviewTime = nextReviewDate.getTime();
      const targetDay = dayRanges.find(
        (day) => nextReviewTime >= day.start.getTime() && nextReviewTime <= day.end.getTime(),
      );
      if (targetDay) {
        targetDay.items.push(mistake);
      }
    }

    return dayRanges.map((day) => ({
      dayOffset: day.dayOffset,
      dayLabel: buildUpcomingDayLabel(day.dayOffset),
      date: toDateOnlyString(day.start),
      totalCount: day.items.length,
      remainingCount: Math.max(0, day.items.length - UPCOMING_MAX_PER_DAY),
      items: day.items.slice(0, UPCOMING_MAX_PER_DAY).map((mistake) => ({
        mistakeId: mistake.id,
        title: buildTitle(mistake.module, mistake.title),
        module: mistake.module,
        reviewCount: mistake.review_count,
        nextReviewIndex: clampNextReviewIndex(mistake.review_count),
      })),
    }));
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'getUpcomingReviewPlan failed.', { days, error });
    throw error;
  }
}

export async function getTodayCompletedStats(): Promise<TodayCompletedStats> {
  try {
    const now = new Date();
    const { start, end } = getLocalDayRange(now, 0);
    return ReviewRecordRepository.getReviewResultStatsByCreatedAtRange(
      start.toISOString(),
      end.toISOString(),
    );
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'getTodayCompletedStats failed.', error);
    throw error;
  }
}

export async function getHomeTaskSummary(): Promise<HomeTaskSummary> {
  try {
    const [mistakeCount, todayQueue, todayCompletedStats, upcomingPlan] = await Promise.all([
      MistakeRepository.countMistakes(),
      getTodayReviewQueue(),
      getTodayCompletedStats(),
      getUpcomingReviewPlan(3),
    ]);

    const hasAnyMistake = mistakeCount > 0;
    const todayDueCount = todayQueue.length;
    let homeStatus: HomeStatus = 'noDueToday';

    if (!hasAnyMistake) {
      homeStatus = 'empty';
    } else if (todayDueCount > 0) {
      homeStatus = 'dueToday';
    } else if (todayCompletedStats.total > 0) {
      homeStatus = 'completedToday';
    } else {
      homeStatus = 'noDueToday';
    }

    return {
      hasAnyMistake,
      todayDueCount,
      todayQueue,
      todayCompletedStats,
      homeStatus,
      upcomingPlan,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'getHomeTaskSummary failed.', error);
    throw error;
  }
}

import { MAX_REVIEW_COUNT, REVIEW_STATUS } from '@/src/constants/review';
import type { Mistake } from '@/src/models/Mistake';
import type { MistakeRelation, MistakeRelationSource } from '@/src/models/MistakeRelation';
import type { MistakeTag } from '@/src/models/MistakeTag';
import type {
  RelatedMistakeItem,
  RelatedMistakeSourceInfo,
  RelatedMistakeSummary,
} from '@/src/models/RelatedMistake';
import {
  MistakeImageRepository,
  MistakeRelationRepository,
  MistakeRepository,
  MistakeTagRepository,
} from '@/src/repositories';
import { Logger } from '@/src/services/Logger';

const SERVICE_SCOPE = 'MistakeRelationService';
const DEFAULT_SUGGESTION_LIMIT = 20;
const DEFAULT_SEARCH_LIMIT = 30;
const CANDIDATE_SCAN_LIMIT = 300;

export type RelatedMistakeFilter = 'all' | MistakeRelationSource;

export interface RelatedMistakeListResult {
  ok: boolean;
  sourceMistake?: RelatedMistakeSourceInfo;
  items?: RelatedMistakeItem[];
  summary?: RelatedMistakeSummary;
  errorMessage?: string;
  notFound?: boolean;
}

export interface RelatedMistakeCandidateResult {
  ok: boolean;
  sourceMistake?: RelatedMistakeSourceInfo;
  items?: RelatedMistakeItem[];
  errorMessage?: string;
  notFound?: boolean;
}

export interface AddRelationResult {
  ok: boolean;
  relation?: MistakeRelation;
  errorMessage?: string;
  notFound?: boolean;
}

export interface RemoveRelationResult {
  ok: boolean;
  deleted?: boolean;
  errorMessage?: string;
}

function normalizeRequiredId(value: string | null | undefined): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.length > 0 ? normalized : '';
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const normalized = Math.floor(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return fallback;
  }
  return normalized;
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const normalized = error.message.trim();
    return normalized.length > 0 ? normalized : fallback;
  }
  const normalized = String(error ?? '').trim();
  return normalized.length > 0 ? normalized : fallback;
}

function buildTitle(mistake: Mistake): string {
  const title = normalizeOptionalText(mistake.title);
  if (title) {
    return title;
  }
  const moduleName = normalizeOptionalText(mistake.module) ?? '未分类';
  return `${moduleName}错题`;
}

function mapMistakeToSourceInfo(mistake: Mistake): RelatedMistakeSourceInfo {
  return {
    id: mistake.id,
    title: buildTitle(mistake),
    module: mistake.module,
  };
}

function buildSharedTagNames(baseTags: MistakeTag[] = [], candidateTags: MistakeTag[] = []): string[] {
  if (baseTags.length <= 0 || candidateTags.length <= 0) {
    return [];
  }

  const candidateByKey = new Map<string, MistakeTag>();
  for (const tag of candidateTags) {
    candidateByKey.set(tag.normalized_name, tag);
  }

  const shared: string[] = [];
  const seenKeys = new Set<string>();
  for (const baseTag of baseTags) {
    if (seenKeys.has(baseTag.normalized_name)) {
      continue;
    }
    const matched = candidateByKey.get(baseTag.normalized_name);
    if (!matched) {
      continue;
    }
    shared.push(baseTag.name || matched.name);
    seenKeys.add(baseTag.normalized_name);
  }

  return shared;
}

function buildMatchReasons(
  base: Mistake,
  candidate: Mistake,
  baseTags: MistakeTag[] = [],
  candidateTags: MistakeTag[] = [],
): string[] {
  const reasons: string[] = [];
  const sharedTags = buildSharedTagNames(baseTags, candidateTags);
  const baseModule = normalizeOptionalText(base.module);
  const candidateModule = normalizeOptionalText(candidate.module);
  const baseReason = normalizeOptionalText(base.error_reason ?? null);
  const candidateReason = normalizeOptionalText(candidate.error_reason ?? null);
  const baseDifficulty = Number.isFinite(base.difficulty) ? Math.floor(base.difficulty) : null;
  const candidateDifficulty = Number.isFinite(candidate.difficulty)
    ? Math.floor(candidate.difficulty)
    : null;

  for (const tagName of sharedTags.slice(0, 3)) {
    reasons.push(`同标签：${tagName}`);
  }
  if (baseModule && candidateModule && baseModule === candidateModule) {
    reasons.push('同模块');
  }
  if (baseReason && candidateReason && baseReason === candidateReason) {
    reasons.push('同错因');
  }
  if (
    baseDifficulty !== null
    && candidateDifficulty !== null
    && Math.abs(baseDifficulty - candidateDifficulty) <= 1
  ) {
    reasons.push('难度接近');
  }

  return reasons;
}

function scoreCandidate(
  base: Mistake,
  candidate: Mistake,
  baseTags: MistakeTag[] = [],
  candidateTags: MistakeTag[] = [],
): number {
  let score = 0;
  const sharedTagCount = buildSharedTagNames(baseTags, candidateTags).length;
  const reasons = buildMatchReasons(base, candidate, baseTags, candidateTags);
  if (sharedTagCount > 0) {
    score += 60 + Math.max(0, sharedTagCount - 1) * 25;
  }
  if (reasons.includes('同模块')) {
    score += 40;
  }
  if (reasons.includes('同错因')) {
    score += 30;
  }
  if (reasons.includes('难度接近')) {
    score += 20;
  }
  if (candidate.status === REVIEW_STATUS.ACTIVE) {
    score += 8;
  }
  score += Math.max(0, MAX_REVIEW_COUNT - Math.floor(candidate.review_count));
  return score;
}

async function mapMistakesToItems(params: {
  baseMistake: Mistake;
  mistakes: Mistake[];
  tagsByMistakeId?: Map<string, MistakeTag[]>;
  relationsByTargetId?: Map<string, MistakeRelation>;
  fallbackReasons?: string[];
  includeScore?: boolean;
}): Promise<RelatedMistakeItem[]> {
  const coverMap = await MistakeImageRepository.getCoverImagesForMistakes(
    params.mistakes.map((mistake) => mistake.id),
  );

  return params.mistakes.map((mistake) => {
    const relation = params.relationsByTargetId?.get(mistake.id) ?? null;
    const baseTags = params.tagsByMistakeId?.get(params.baseMistake.id) ?? [];
    const candidateTags = params.tagsByMistakeId?.get(mistake.id) ?? [];
    const matchReasons = buildMatchReasons(params.baseMistake, mistake, baseTags, candidateTags);
    const resolvedReasons =
      matchReasons.length > 0 ? matchReasons : (params.fallbackReasons ?? []);
    return {
      id: mistake.id,
      title: buildTitle(mistake),
      module: mistake.module,
      errorReason: mistake.error_reason ?? null,
      difficulty: mistake.difficulty,
      thumbnailUri: coverMap.get(mistake.id)?.uri ?? null,
      reviewCount: mistake.review_count,
      maxReviewCount: MAX_REVIEW_COUNT,
      status: mistake.status,
      createdAt: mistake.created_at,
      updatedAt: mistake.updated_at,
      relationId: relation?.id ?? null,
      relationSource: relation?.source ?? null,
      relationCreatedAt: relation?.created_at ?? null,
      matchReasons: resolvedReasons,
      score: params.includeScore
        ? scoreCandidate(params.baseMistake, mistake, baseTags, candidateTags)
        : null,
    };
  });
}

function relationTargetIdForCurrent(relation: MistakeRelation, currentMistakeId: string): string {
  return relation.source_mistake_id === currentMistakeId
    ? relation.target_mistake_id
    : relation.source_mistake_id;
}

async function getBaseMistake(mistakeIdInput: string): Promise<Mistake | null> {
  const mistakeId = normalizeRequiredId(mistakeIdInput);
  if (!mistakeId) {
    return null;
  }
  return MistakeRepository.getMistakeById(mistakeId);
}

export async function getRelatedMistakes(
  mistakeIdInput: string,
  filter: RelatedMistakeFilter = 'all',
): Promise<RelatedMistakeListResult> {
  const mistakeId = normalizeRequiredId(mistakeIdInput);
  if (!mistakeId) {
    return { ok: false, errorMessage: '错题 id 不能为空。' };
  }

  try {
    const baseMistake = await getBaseMistake(mistakeId);
    if (!baseMistake) {
      return {
        ok: false,
        notFound: true,
        errorMessage: '未找到来源错题。',
      };
    }

    const relations = await MistakeRelationRepository.listRelationsByMistakeId(mistakeId);
    const filteredRelations =
      filter === 'all' ? relations : relations.filter((relation) => relation.source === filter);
    const targetIds = filteredRelations.map((relation) =>
      relationTargetIdForCurrent(relation, mistakeId),
    );
    const targetIdSet = new Set(targetIds);
    const uniqueTargetIds = Array.from(targetIdSet);
    const targetMistakesRaw = await Promise.all(
      uniqueTargetIds.map((targetId) => MistakeRepository.getMistakeById(targetId)),
    );
    const targetMistakes = targetMistakesRaw.filter((item): item is Mistake => item !== null);
    const relationByTargetId = new Map<string, MistakeRelation>();
    for (const relation of filteredRelations) {
      relationByTargetId.set(relationTargetIdForCurrent(relation, mistakeId), relation);
    }
    const tagsByMistakeId = await MistakeTagRepository.listTagsByMistakeIds([
      mistakeId,
      ...targetMistakes.map((mistake) => mistake.id),
    ]);

    const items = await mapMistakesToItems({
      baseMistake,
      mistakes: targetMistakes,
      tagsByMistakeId,
      relationsByTargetId: relationByTargetId,
      fallbackReasons: ['已关联'],
      includeScore: false,
    });
    items.sort((left, right) => {
      const leftTime = left.relationCreatedAt ?? left.updatedAt;
      const rightTime = right.relationCreatedAt ?? right.updatedAt;
      return rightTime.localeCompare(leftTime);
    });

    const summary = {
      total: relations.length,
      system: relations.filter((relation) => relation.source === 'system').length,
      manual: relations.filter((relation) => relation.source === 'manual').length,
    };

    return {
      ok: true,
      sourceMistake: mapMistakeToSourceInfo(baseMistake),
      items,
      summary,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'getRelatedMistakes failed.', { mistakeId, filter, error });
    return {
      ok: false,
      errorMessage: toErrorMessage(error, '读取相关错题失败，请稍后重试。'),
    };
  }
}

export async function getSuggestedRelatedMistakes(
  mistakeIdInput: string,
  limitInput?: number,
): Promise<RelatedMistakeCandidateResult> {
  const mistakeId = normalizeRequiredId(mistakeIdInput);
  if (!mistakeId) {
    return { ok: false, errorMessage: '错题 id 不能为空。' };
  }

  try {
    const baseMistake = await getBaseMistake(mistakeId);
    if (!baseMistake) {
      return {
        ok: false,
        notFound: true,
        errorMessage: '未找到来源错题。',
      };
    }

    const relations = await MistakeRelationRepository.listRelationsByMistakeId(mistakeId);
    const relatedIds = new Set(
      relations.map((relation) => relationTargetIdForCurrent(relation, mistakeId)),
    );
    const candidates = await MistakeRepository.listMistakes({
      status: 'all',
      sortBy: 'updated_at',
      sortOrder: 'desc',
      limit: CANDIDATE_SCAN_LIMIT,
    });
    const candidatePool = candidates.filter(
      (candidate) => candidate.id !== mistakeId && !relatedIds.has(candidate.id),
    );
    const tagsByMistakeId = await MistakeTagRepository.listTagsByMistakeIds([
      mistakeId,
      ...candidatePool.map((candidate) => candidate.id),
    ]);
    const baseTags = tagsByMistakeId.get(mistakeId) ?? [];
    const scored = candidatePool
      .map((candidate) => ({
        mistake: candidate,
        score: scoreCandidate(
          baseMistake,
          candidate,
          baseTags,
          tagsByMistakeId.get(candidate.id) ?? [],
        ),
        reasons: buildMatchReasons(
          baseMistake,
          candidate,
          baseTags,
          tagsByMistakeId.get(candidate.id) ?? [],
        ),
      }))
      .filter((item) => item.score > 0 && item.reasons.length > 0)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        if (left.mistake.status !== right.mistake.status) {
          return left.mistake.status === REVIEW_STATUS.ACTIVE ? -1 : 1;
        }
        return right.mistake.updated_at.localeCompare(left.mistake.updated_at);
      })
      .slice(0, normalizeLimit(limitInput, DEFAULT_SUGGESTION_LIMIT));

    const items = await mapMistakesToItems({
      baseMistake,
      mistakes: scored.map((item) => item.mistake),
      tagsByMistakeId,
      includeScore: true,
    });

    return {
      ok: true,
      sourceMistake: mapMistakeToSourceInfo(baseMistake),
      items,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'getSuggestedRelatedMistakes failed.', { mistakeId, error });
    return {
      ok: false,
      errorMessage: toErrorMessage(error, '读取系统推荐失败，请稍后重试。'),
    };
  }
}

export async function searchMistakesForManualRelation(params: {
  mistakeId: string;
  keyword: string;
  limit?: number;
}): Promise<RelatedMistakeCandidateResult> {
  const mistakeId = normalizeRequiredId(params.mistakeId);
  if (!mistakeId) {
    return { ok: false, errorMessage: '错题 id 不能为空。' };
  }

  try {
    const baseMistake = await getBaseMistake(mistakeId);
    if (!baseMistake) {
      return {
        ok: false,
        notFound: true,
        errorMessage: '未找到来源错题。',
      };
    }

    const keyword = normalizeOptionalText(params.keyword) ?? '';
    const relations = await MistakeRelationRepository.listRelationsByMistakeId(mistakeId);
    const relatedIds = new Set(
      relations.map((relation) => relationTargetIdForCurrent(relation, mistakeId)),
    );
    const mistakes = await MistakeRepository.listMistakes({
      status: 'all',
      keyword,
      sortBy: 'updated_at',
      sortOrder: 'desc',
      limit: normalizeLimit(params.limit, DEFAULT_SEARCH_LIMIT),
    });
    const candidates = mistakes.filter(
      (mistake) => mistake.id !== mistakeId && !relatedIds.has(mistake.id),
    );
    const tagsByMistakeId = await MistakeTagRepository.listTagsByMistakeIds([
      mistakeId,
      ...candidates.map((mistake) => mistake.id),
    ]);
    const items = await mapMistakesToItems({
      baseMistake,
      mistakes: candidates,
      tagsByMistakeId,
      fallbackReasons: ['手动选择'],
      includeScore: false,
    });

    return {
      ok: true,
      sourceMistake: mapMistakeToSourceInfo(baseMistake),
      items,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'searchMistakesForManualRelation failed.', {
      mistakeId,
      keyword: params.keyword,
      error,
    });
    return {
      ok: false,
      errorMessage: toErrorMessage(error, '搜索错题失败，请稍后重试。'),
    };
  }
}

export async function addRelatedMistake(params: {
  sourceMistakeId: string;
  targetMistakeId: string;
  source: MistakeRelationSource;
}): Promise<AddRelationResult> {
  const sourceMistakeId = normalizeRequiredId(params.sourceMistakeId);
  const targetMistakeId = normalizeRequiredId(params.targetMistakeId);
  if (!sourceMistakeId || !targetMistakeId) {
    return { ok: false, errorMessage: '错题 id 不能为空。' };
  }
  if (sourceMistakeId === targetMistakeId) {
    return { ok: false, errorMessage: '不能把当前错题添加为相关错题。' };
  }

  try {
    const [sourceMistake, targetMistake] = await Promise.all([
      MistakeRepository.getMistakeById(sourceMistakeId),
      MistakeRepository.getMistakeById(targetMistakeId),
    ]);

    if (!sourceMistake || !targetMistake) {
      return {
        ok: false,
        notFound: true,
        errorMessage: '未找到要关联的错题。',
      };
    }

    const relation = await MistakeRelationRepository.createRelation({
      sourceMistakeId,
      targetMistakeId,
      source: params.source,
    });

    Logger.info(SERVICE_SCOPE, 'Added related mistake successfully.', {
      relationId: relation.id,
      sourceMistakeId,
      targetMistakeId,
      source: params.source,
    });

    return {
      ok: true,
      relation,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'addRelatedMistake failed.', { params, error });
    return {
      ok: false,
      errorMessage: toErrorMessage(error, '添加相关错题失败，请稍后重试。'),
    };
  }
}

export async function removeRelatedMistake(relationIdInput: string): Promise<RemoveRelationResult> {
  const relationId = normalizeRequiredId(relationIdInput);
  if (!relationId) {
    return { ok: false, errorMessage: '关系 id 不能为空。' };
  }

  try {
    const deleted = await MistakeRelationRepository.deleteRelation(relationId);
    return {
      ok: true,
      deleted,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'removeRelatedMistake failed.', { relationId, error });
    return {
      ok: false,
      errorMessage: toErrorMessage(error, '移除相关错题失败，请稍后重试。'),
    };
  }
}

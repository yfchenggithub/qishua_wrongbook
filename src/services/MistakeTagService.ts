import type { MistakeTag } from '@/src/models/MistakeTag';
import { MistakeRepository, MistakeTagRepository } from '@/src/repositories';
import { Logger } from '@/src/services/Logger';

const SERVICE_SCOPE = 'MistakeTagService';

export const MAX_MISTAKE_TAG_COUNT = 12;
export const MAX_MISTAKE_TAG_NAME_LENGTH = 20;
export const TAG_SUGGESTION_LIMIT = 24;

export interface MistakeTagActionResult {
  ok: boolean;
  tags?: MistakeTag[];
  tag?: MistakeTag;
  deleted?: boolean;
  errorMessage?: string;
  notFound?: boolean;
}

export interface MistakeTagSuggestionResult {
  ok: boolean;
  suggestions?: string[];
  errorMessage?: string;
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message.length > 0 ? message : fallback;
  }
  const message = String(error ?? '').trim();
  return message.length > 0 ? message : fallback;
}

function normalizeMistakeId(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeMistakeTagName(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().replace(/\s+/g, ' ');
}

export function normalizeMistakeTagKey(value: string | null | undefined): string {
  return normalizeMistakeTagName(value).toLocaleLowerCase();
}

function hasTagWithKey(tags: MistakeTag[], normalizedName: string): boolean {
  return tags.some((tag) => tag.normalized_name === normalizedName);
}

export async function getMistakeTags(mistakeIdInput: string): Promise<MistakeTagActionResult> {
  const mistakeId = normalizeMistakeId(mistakeIdInput);
  if (!mistakeId) {
    return {
      ok: false,
      errorMessage: '错题 id 不能为空。',
    };
  }

  try {
    const tags = await MistakeTagRepository.listTagsByMistakeId(mistakeId);
    return {
      ok: true,
      tags,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'getMistakeTags failed.', { mistakeId, error });
    return {
      ok: false,
      errorMessage: toErrorMessage(error, '读取标签失败，请稍后重试。'),
    };
  }
}

export async function addMistakeTag(params: {
  mistakeId: string;
  name: string;
}): Promise<MistakeTagActionResult> {
  const mistakeId = normalizeMistakeId(params.mistakeId);
  if (!mistakeId) {
    return {
      ok: false,
      errorMessage: '错题 id 不能为空。',
    };
  }

  const name = normalizeMistakeTagName(params.name);
  if (!name) {
    return {
      ok: false,
      errorMessage: '标签不能为空。',
    };
  }
  if (name.length > MAX_MISTAKE_TAG_NAME_LENGTH) {
    return {
      ok: false,
      errorMessage: `标签不能超过 ${MAX_MISTAKE_TAG_NAME_LENGTH} 个字。`,
    };
  }

  const normalizedName = normalizeMistakeTagKey(name);
  try {
    const mistake = await MistakeRepository.getMistakeById(mistakeId);
    if (!mistake) {
      return {
        ok: false,
        notFound: true,
        errorMessage: '未找到对应错题。',
      };
    }

    const existingTags = await MistakeTagRepository.listTagsByMistakeId(mistakeId);
    if (hasTagWithKey(existingTags, normalizedName)) {
      return {
        ok: true,
        tags: existingTags,
        tag: existingTags.find((tag) => tag.normalized_name === normalizedName),
      };
    }

    if (existingTags.length >= MAX_MISTAKE_TAG_COUNT) {
      return {
        ok: false,
        tags: existingTags,
        errorMessage: `每道错题最多添加 ${MAX_MISTAKE_TAG_COUNT} 个标签。`,
      };
    }

    const tag = await MistakeTagRepository.createTag({
      mistakeId,
      name,
      normalizedName,
    });
    const tags = await MistakeTagRepository.listTagsByMistakeId(mistakeId);

    Logger.info(SERVICE_SCOPE, 'Added mistake tag successfully.', {
      mistakeId,
      tagId: tag.id,
      tagNameLength: tag.name.length,
    });

    return {
      ok: true,
      tags,
      tag,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'addMistakeTag failed.', {
      mistakeId,
      tagNameLength: name.length,
      error,
    });
    return {
      ok: false,
      errorMessage: toErrorMessage(error, '添加标签失败，请稍后重试。'),
    };
  }
}

export async function deleteMistakeTag(params: {
  mistakeId: string;
  tagId: string;
}): Promise<MistakeTagActionResult> {
  const mistakeId = normalizeMistakeId(params.mistakeId);
  const tagId = normalizeMistakeId(params.tagId);
  if (!mistakeId || !tagId) {
    return {
      ok: false,
      errorMessage: '标签信息不完整。',
    };
  }

  try {
    const deleted = await MistakeTagRepository.deleteTagForMistake(mistakeId, tagId);
    const tags = await MistakeTagRepository.listTagsByMistakeId(mistakeId);
    Logger.info(SERVICE_SCOPE, 'Deleted mistake tag.', {
      mistakeId,
      tagId,
      deleted,
    });
    return {
      ok: true,
      deleted,
      tags,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'deleteMistakeTag failed.', { mistakeId, tagId, error });
    return {
      ok: false,
      errorMessage: toErrorMessage(error, '删除标签失败，请稍后重试。'),
    };
  }
}

export async function getTagSuggestionsForMistake(
  mistakeIdInput: string,
): Promise<MistakeTagSuggestionResult> {
  const mistakeId = normalizeMistakeId(mistakeIdInput);
  if (!mistakeId) {
    return {
      ok: false,
      errorMessage: '错题 id 不能为空。',
    };
  }

  try {
    const [currentTags, recentTags] = await Promise.all([
      MistakeTagRepository.listTagsByMistakeId(mistakeId),
      MistakeTagRepository.listRecentTagNames(TAG_SUGGESTION_LIMIT),
    ]);
    const currentKeys = new Set(currentTags.map((tag) => tag.normalized_name));
    const suggestions = recentTags
      .filter((tag) => !currentKeys.has(tag.normalized_name))
      .map((tag) => tag.name);

    return {
      ok: true,
      suggestions,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'getTagSuggestionsForMistake failed.', { mistakeId, error });
    return {
      ok: false,
      errorMessage: toErrorMessage(error, '读取标签建议失败，请稍后重试。'),
    };
  }
}

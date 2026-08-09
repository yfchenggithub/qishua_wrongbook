import Constants from 'expo-constants';

import { ERROR_REASON_OPTIONS } from '@/src/constants/mistakeOptions';
import type { CustomErrorReason } from '@/src/models/CustomErrorReason';
import type { Mistake } from '@/src/models/Mistake';
import type { MistakeImage } from '@/src/models/MistakeImage';
import type {
  ModulePackageErrorReason,
  ModulePackageImage,
  ModulePackageImageType,
  ModulePackagePayload,
  ModulePackageQuestion,
  ModulePackageRelation,
} from '@/src/models/ModulePackage';
import {
  MODULE_PACKAGE_CONTENT_VERSION,
  MODULE_PACKAGE_FORMAT,
  MODULE_PACKAGE_FORMAT_VERSION,
} from '@/src/models/ModulePackage';
import type { MistakeRelation } from '@/src/models/MistakeRelation';
import type { ModuleRecord } from '@/src/models/Module';
import {
  CustomErrorReasonRepository,
  MistakeImageRepository,
  MistakeRelationRepository,
  MistakeRepository,
  MistakeTagRepository,
  ModuleRepository,
} from '@/src/repositories';
import { Logger } from '@/src/services/Logger';
import {
  MODULE_PACKAGE_LIMITS,
  validateModulePackagePayload,
} from '@/src/services/moduleTransfer/ModulePackageValidator';
import type {
  ListModuleExportCandidatesResult,
  ModuleExportCandidate,
  ModuleExportFailureCode,
  ModuleExportSourceAsset,
  ModuleExportWarning,
  ModuleExportWarningCode,
  PrepareModuleExportInput,
  PrepareModuleExportResult,
  PreparedModuleExport,
} from '@/src/services/moduleTransfer/ModuleTransferTypes';
import { createRecordId } from '@/src/utils/id';
import { parseStoredTextHighlights } from '@/src/utils/textHighlights';

const SERVICE_SCOPE = 'ModuleExportService';
const DEFAULT_APP_NAME = '七刷错题本';
const DEFAULT_APP_VERSION = 'unknown';
const EXPORTED_IMAGE_TYPES: readonly ModulePackageImageType[] = [
  'question',
  'my_solution',
  'answer',
];
const IMAGE_TYPE_ORDER = new Map<ModulePackageImageType, number>(
  EXPORTED_IMAGE_TYPES.map((type, index) => [type, index]),
);
const BUILTIN_REASON_BY_ID = new Map<string, (typeof ERROR_REASON_OPTIONS)[number]>(
  ERROR_REASON_OPTIONS.map((item) => [item.id, item]),
);
const BUILTIN_REASON_BY_NAME = new Map(
  ERROR_REASON_OPTIONS.map((item) => [normalizeComparableText(item.label), item]),
);

type WarningCounts = Map<ModuleExportWarningCode, number>;

type ImageMapState = {
  nextAssetNumber: number;
  assets: ModuleExportSourceAsset[];
  warningCounts: WarningCounts;
};

class ModuleExportBuildError extends Error {
  constructor(
    readonly code: ModuleExportFailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'ModuleExportBuildError';
  }
}

function normalizeComparableText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

function incrementWarning(warnings: WarningCounts, code: ModuleExportWarningCode): void {
  warnings.set(code, (warnings.get(code) ?? 0) + 1);
}

function buildWarnings(counts: WarningCounts): ModuleExportWarning[] {
  const definitions: Record<ModuleExportWarningCode, (count: number) => string> = {
    invalid_error_reason_ids: (count) => `有 ${count} 道题的错因 ID 数据损坏，已使用展示文本回退。`,
    unresolved_error_reason: (count) => `有 ${count} 个错因无法解析，未写入题包。`,
    ignored_invalid_question_image_uri: (count) => `有 ${count} 条无效题目图记录已忽略，相关题目仍保留有效题目图。`,
    ignored_optional_image_uri: (count) => `有 ${count} 张做法图或答案图缺少有效 URI，已忽略。`,
    ignored_stale_relation: (count) => `有 ${count} 条失效的题目关联未写入题包。`,
  };
  return (Object.keys(definitions) as ModuleExportWarningCode[])
    .flatMap((code) => {
      const count = counts.get(code) ?? 0;
      return count > 0
        ? [{ code, count, message: definitions[code](count) }]
        : [];
    });
}

function failure(
  code: ModuleExportFailureCode,
  message: string,
): PrepareModuleExportResult {
  return {
    ok: false,
    code,
    message,
  };
}

function parseErrorReasonIds(value: string | null | undefined): {
  ids: string[];
  malformed: boolean;
} {
  if (!value?.trim()) {
    return { ids: [], malformed: false };
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return { ids: [], malformed: true };
    }
    const ids: string[] = [];
    let malformed = false;
    for (const item of parsed) {
      if (typeof item !== 'string' || !item.trim()) {
        malformed = true;
        continue;
      }
      ids.push(item.trim());
    }
    return { ids: Array.from(new Set(ids)), malformed };
  } catch {
    return { ids: [], malformed: true };
  }
}

function splitErrorReasonLabels(value: string | null | undefined): string[] {
  if (!value?.trim()) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .split('、')
        .map((item) => item.trim().replace(/\s+/g, ' '))
        .filter(Boolean),
    ),
  );
}

function buildCustomReasonLookup(reasons: CustomErrorReason[]): Map<string, CustomErrorReason> {
  const lookup = new Map<string, CustomErrorReason>();
  for (const reason of reasons) {
    lookup.set(reason.id, reason);
    lookup.set(`custom:${reason.id}`, reason);
  }
  return lookup;
}

function mapErrorReasons(
  mistake: Mistake,
  customReasonLookup: ReadonlyMap<string, CustomErrorReason>,
  warningCounts: WarningCounts,
): ModulePackageErrorReason[] {
  const parsedIds = parseErrorReasonIds(mistake.error_reason_ids);
  if (parsedIds.malformed) {
    incrementWarning(warningCounts, 'invalid_error_reason_ids');
  }

  const mapped: ModulePackageErrorReason[] = [];
  const seenNames = new Set<string>();
  const appendByName = (nameInput: string): boolean => {
    const name = nameInput.trim().replace(/\s+/g, ' ');
    const comparableName = normalizeComparableText(name);
    if (!name || seenNames.has(comparableName)) {
      return true;
    }
    const builtIn = BUILTIN_REASON_BY_NAME.get(comparableName);
    if (builtIn) {
      mapped.push({ kind: 'builtin', key: builtIn.id, name: builtIn.label });
      seenNames.add(comparableName);
      return true;
    }
    if (name.length > MODULE_PACKAGE_LIMITS.maxErrorReasonNameLength) {
      return false;
    }
    mapped.push({ kind: 'custom', name });
    seenNames.add(comparableName);
    return true;
  };

  for (const id of parsedIds.ids) {
    const builtIn = BUILTIN_REASON_BY_ID.get(id);
    if (builtIn) {
      appendByName(builtIn.label);
      continue;
    }
    const custom = customReasonLookup.get(id);
    if (custom) {
      appendByName(custom.name);
      continue;
    }
    incrementWarning(warningCounts, 'unresolved_error_reason');
  }

  for (const label of splitErrorReasonLabels(mistake.error_reason)) {
    if (!appendByName(label)) {
      incrementWarning(warningCounts, 'unresolved_error_reason');
    }
  }
  return mapped;
}

function sortMistakes(mistakes: Mistake[]): Mistake[] {
  return [...mistakes].sort((left, right) => (
    left.question_no - right.question_no
    || left.created_at.localeCompare(right.created_at)
    || left.id.localeCompare(right.id)
  ));
}

function isExportedImageType(type: MistakeImage['type']): type is ModulePackageImageType {
  return EXPORTED_IMAGE_TYPES.includes(type as ModulePackageImageType);
}

function sortImages(images: MistakeImage[]): MistakeImage[] {
  return [...images].sort((left, right) => {
    const leftOrder = isExportedImageType(left.type) ? IMAGE_TYPE_ORDER.get(left.type) ?? 99 : 99;
    const rightOrder = isExportedImageType(right.type) ? IMAGE_TYPE_ORDER.get(right.type) ?? 99 : 99;
    return leftOrder - rightOrder
      || left.sort_order - right.sort_order
      || left.created_at.localeCompare(right.created_at)
      || left.id.localeCompare(right.id);
  });
}

function mapQuestionImages(
  sourceMistakeId: string,
  itemId: string,
  sourceImages: MistakeImage[],
  state: ImageMapState,
): ModulePackageImage[] {
  const mapped: ModulePackageImage[] = [];
  const nextIndexByType = new Map<ModulePackageImageType, number>();

  for (const image of sortImages(sourceImages)) {
    if (!isExportedImageType(image.type)) {
      continue;
    }
    const sourceUri = image.uri.trim();
    if (!sourceUri) {
      if (image.type === 'question') {
        incrementWarning(state.warningCounts, 'ignored_invalid_question_image_uri');
      } else {
        incrementWarning(state.warningCounts, 'ignored_optional_image_uri');
      }
      continue;
    }

    const typeIndex = nextIndexByType.get(image.type) ?? 0;
    const fileNumber = typeIndex + 1;
    nextIndexByType.set(image.type, fileNumber);
    const relativePath = `images/${itemId}/${image.type}_${String(fileNumber).padStart(3, '0')}.jpg`;
    const assetId = `ASSET${String(state.nextAssetNumber).padStart(4, '0')}`;
    state.nextAssetNumber += 1;

    mapped.push({
      assetId,
      type: image.type,
      sortOrder: typeIndex,
      relativePath,
    });
    state.assets.push({
      assetId,
      sourceImageId: image.id,
      sourceMistakeId,
      sourceUri,
      type: image.type,
      relativePath,
    });
  }

  if (!mapped.some((image) => image.type === 'question')) {
    throw new ModuleExportBuildError(
      'missing_question_image',
      `错题 ${itemId} 没有可导出的题目图片。`,
    );
  }
  return mapped;
}

function mapRelations(
  relations: MistakeRelation[],
  itemIdByMistakeId: ReadonlyMap<string, string>,
  positionByMistakeId: ReadonlyMap<string, number>,
  warningCounts: WarningCounts,
): ModulePackageRelation[] {
  const mapped: ModulePackageRelation[] = [];
  const seen = new Set<string>();

  for (const relation of relations) {
    const sourceItemId = itemIdByMistakeId.get(relation.source_mistake_id);
    const targetItemId = itemIdByMistakeId.get(relation.target_mistake_id);
    const sourcePosition = positionByMistakeId.get(relation.source_mistake_id);
    const targetPosition = positionByMistakeId.get(relation.target_mistake_id);
    if (!sourceItemId || !targetItemId || sourcePosition === undefined || targetPosition === undefined) {
      incrementWarning(warningCounts, 'ignored_stale_relation');
      continue;
    }
    const ordered = sourcePosition <= targetPosition
      ? { sourceItemId, targetItemId }
      : { sourceItemId: targetItemId, targetItemId: sourceItemId };
    const key = `${ordered.sourceItemId}\0${ordered.targetItemId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    mapped.push(ordered);
  }
  return mapped.sort((left, right) => (
    left.sourceItemId.localeCompare(right.sourceItemId)
    || left.targetItemId.localeCompare(right.targetItemId)
  ));
}

function resolveAppMeta(input: PrepareModuleExportInput): { appName: string; appVersion: string } {
  return {
    appName: normalizeOptionalText(input.appName)
      ?? normalizeOptionalText(Constants.expoConfig?.name)
      ?? DEFAULT_APP_NAME,
    appVersion: normalizeOptionalText(input.appVersion)
      ?? normalizeOptionalText(Constants.expoConfig?.version)
      ?? DEFAULT_APP_VERSION,
  };
}

export async function listModuleExportCandidates(): Promise<ListModuleExportCandidatesResult> {
  try {
    const [modules, counts] = await Promise.all([
      ModuleRepository.listAllModules(),
      MistakeRepository.countMistakesByModuleId(),
    ]);
    const countByModuleId = new Map(counts.map((item) => [item.moduleId, item.count]));
    const candidates: ModuleExportCandidate[] = modules
      .filter((moduleItem) => (
        moduleItem.is_active
        && (moduleItem.type === 'system' || moduleItem.type === 'custom')
      ))
      .sort((left, right) => (
        (left.type === right.type ? 0 : left.type === 'system' ? -1 : 1)
        || left.sort_order - right.sort_order
        || left.id - right.id
      ))
      .map((moduleItem) => ({
        moduleId: moduleItem.id,
        name: moduleItem.name,
        displayCode: moduleItem.display_code,
        type: moduleItem.type as 'system' | 'custom',
        icon: moduleItem.icon,
        color: moduleItem.color,
        questionCount: countByModuleId.get(moduleItem.id) ?? 0,
      }));
    return { ok: true, value: candidates };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Failed to list module export candidates.', error);
    return { ok: false, message: '读取可导出模块失败，请稍后重试。' };
  }
}

function mapQuestions(options: {
  mistakes: Mistake[];
  imagesByMistakeId: ReadonlyMap<string, MistakeImage[]>;
  tagNamesByMistakeId: ReadonlyMap<string, string[]>;
  customReasonLookup: ReadonlyMap<string, CustomErrorReason>;
  imageState: ImageMapState;
}): {
  questions: ModulePackageQuestion[];
  itemIdByMistakeId: Map<string, string>;
  positionByMistakeId: Map<string, number>;
} {
  const questions: ModulePackageQuestion[] = [];
  const itemIdByMistakeId = new Map<string, string>();
  const positionByMistakeId = new Map<string, number>();

  options.mistakes.forEach((mistake, index) => {
    const position = index + 1;
    const itemId = `Q${String(position).padStart(3, '0')}`;
    itemIdByMistakeId.set(mistake.id, itemId);
    positionByMistakeId.set(mistake.id, position);
    questions.push({
      itemId,
      position,
      subject: 'math',
      title: normalizeOptionalText(mistake.title),
      difficulty: mistake.difficulty,
      errorReasons: mapErrorReasons(
        mistake,
        options.customReasonLookup,
        options.imageState.warningCounts,
      ),
      note: mistake.note ?? null,
      noteHighlights: parseStoredTextHighlights(mistake.note_highlights, mistake.note),
      mySolutionText: mistake.my_solution_text ?? null,
      answerText: mistake.answer_text ?? null,
      tags: options.tagNamesByMistakeId.get(mistake.id) ?? [],
      images: mapQuestionImages(
        mistake.id,
        itemId,
        options.imagesByMistakeId.get(mistake.id) ?? [],
        options.imageState,
      ),
    });
  });
  return { questions, itemIdByMistakeId, positionByMistakeId };
}

async function collectModuleData(moduleId: number): Promise<{
  module: ModuleRecord;
  mistakes: Mistake[];
  imagesByMistakeId: Map<string, MistakeImage[]>;
  tagNamesByMistakeId: Map<string, string[]>;
  relations: MistakeRelation[];
  customReasons: CustomErrorReason[];
}> {
  const moduleItem = await ModuleRepository.getModuleById(moduleId);
  if (!moduleItem) {
    throw new ModuleExportBuildError('module_not_found', '未找到要导出的模块。');
  }
  if (moduleItem.type === 'unclassified') {
    throw new ModuleExportBuildError('module_not_exportable', '未分类模块不能导出为题包。');
  }

  const mistakes = sortMistakes(await MistakeRepository.listMistakes({
    status: 'all',
    moduleId,
    limit: null,
  }));
  if (mistakes.length === 0) {
    throw new ModuleExportBuildError('empty_module', '空模块不能导出为题包。');
  }
  if (mistakes.length > MODULE_PACKAGE_LIMITS.maxQuestions) {
    throw new ModuleExportBuildError(
      'payload_invalid',
      `单个题包最多包含 ${MODULE_PACKAGE_LIMITS.maxQuestions} 道题。`,
    );
  }

  const mistakeIds = mistakes.map((mistake) => mistake.id);
  const [imagesByMistakeId, tagsByMistakeId, relations, customReasons] = await Promise.all([
    MistakeImageRepository.getImagesByMistakeIds(mistakeIds),
    MistakeTagRepository.listTagsByMistakeIds(mistakeIds),
    MistakeRelationRepository.listRelationsWithinModule(moduleId),
    CustomErrorReasonRepository.listCustomErrorReasons(),
  ]);
  const tagNamesByMistakeId = new Map<string, string[]>();
  for (const mistakeId of mistakeIds) {
    tagNamesByMistakeId.set(
      mistakeId,
      (tagsByMistakeId.get(mistakeId) ?? []).map((tag) => tag.name),
    );
  }
  return {
    module: moduleItem,
    mistakes,
    imagesByMistakeId,
    tagNamesByMistakeId,
    relations,
    customReasons,
  };
}

export async function prepareModuleExportPayload(
  input: PrepareModuleExportInput,
): Promise<PrepareModuleExportResult> {
  if (!Number.isInteger(input.moduleId) || input.moduleId <= 0) {
    return failure('invalid_input', 'moduleId 必须是正整数。');
  }

  try {
    const collected = await collectModuleData(input.moduleId);
    const warningCounts: WarningCounts = new Map();
    const imageState: ImageMapState = {
      nextAssetNumber: 1,
      assets: [],
      warningCounts,
    };
    const mappedQuestions = mapQuestions({
      mistakes: collected.mistakes,
      imagesByMistakeId: collected.imagesByMistakeId,
      tagNamesByMistakeId: collected.tagNamesByMistakeId,
      customReasonLookup: buildCustomReasonLookup(collected.customReasons),
      imageState,
    });
    const relations = mapRelations(
      collected.relations,
      mappedQuestions.itemIdByMistakeId,
      mappedQuestions.positionByMistakeId,
      warningCounts,
    );
    const warnings = buildWarnings(warningCounts);
    const appMeta = resolveAppMeta(input);
    const payload: ModulePackagePayload = {
      manifest: {
        format: MODULE_PACKAGE_FORMAT,
        formatVersion: MODULE_PACKAGE_FORMAT_VERSION,
        packageId: normalizeOptionalText(input.packageId) ?? createRecordId('PKG'),
        contentVersion: MODULE_PACKAGE_CONTENT_VERSION,
        appName: appMeta.appName,
        appVersion: appMeta.appVersion,
        createdAt: normalizeOptionalText(input.createdAt) ?? new Date().toISOString(),
        creator: {
          displayName: normalizeOptionalText(input.creatorName),
        },
        module: {
          name: collected.module.name,
          description: normalizeOptionalText(input.description),
          subject: 'math',
          icon: collected.module.icon,
          color: collected.module.color,
        },
        counts: {
          questions: mappedQuestions.questions.length,
          images: imageState.assets.length,
          relations: relations.length,
        },
        warnings: warnings.map((warning) => warning.message),
      },
      data: {
        questions: mappedQuestions.questions,
        relations,
      },
    };

    const validated = validateModulePackagePayload(payload);
    if (!validated.ok) {
      Logger.warn(SERVICE_SCOPE, 'Mapped module export payload failed validation.', {
        moduleId: input.moduleId,
        questionCount: mappedQuestions.questions.length,
        imageCount: imageState.assets.length,
        relationCount: relations.length,
        issueCount: validated.errors.length,
      });
      return {
        ok: false,
        code: 'payload_invalid',
        message: '模块数据不符合题包协议，暂时无法导出。',
        validationIssues: validated.errors,
      };
    }

    const prepared: PreparedModuleExport = {
      sourceModuleId: collected.module.id,
      payload: validated.value,
      assets: imageState.assets,
      warnings,
    };
    Logger.info(SERVICE_SCOPE, 'Prepared module export payload.', {
      moduleId: collected.module.id,
      questionCount: prepared.payload.manifest.counts.questions,
      imageCount: prepared.payload.manifest.counts.images,
      relationCount: prepared.payload.manifest.counts.relations,
      warningCount: warnings.length,
    });
    return { ok: true, value: prepared };
  } catch (error) {
    if (error instanceof ModuleExportBuildError) {
      return failure(error.code, error.message);
    }
    Logger.error(SERVICE_SCOPE, 'Failed to prepare module export payload.', {
      moduleId: input.moduleId,
      error,
    });
    return failure('read_failed', '读取模块数据失败，请稍后重试。');
  }
}

export const ModuleExportService = {
  listModuleExportCandidates,
  prepareModuleExportPayload,
} as const;

import {
  ERROR_REASON_OPTIONS,
  MISTAKE_NOTE_MAX_LENGTH,
  MISTAKE_TITLE_MAX_LENGTH,
  SUPPLEMENT_TEXT_MAX_LENGTH,
} from '@/src/constants/mistakeOptions';
import type { TextHighlightColor, TextHighlightRange } from '@/src/models/TextHighlight';
import {
  MODULE_PACKAGE_CONTENT_VERSION,
  MODULE_PACKAGE_DATA_FILE_NAME,
  MODULE_PACKAGE_FORMAT,
  MODULE_PACKAGE_FORMAT_VERSION,
  MODULE_PACKAGE_IMAGES_DIR_NAME,
  MODULE_PACKAGE_MANIFEST_FILE_NAME,
  type ModulePackageArchiveEntry,
  type ModulePackageCounts,
  type ModulePackageData,
  type ModulePackageErrorReason,
  type ModulePackageImage,
  type ModulePackageImageType,
  type ModulePackageManifest,
  type ModulePackagePayload,
  type ModulePackageQuestion,
  type ModulePackageRelation,
  type ModulePackageValidationCode,
  type ModulePackageValidationIssue,
  type ModulePackageValidationResult,
  type ValidateModulePackageArchiveInput,
} from '@/src/models/ModulePackage';

const BYTES_PER_MEBIBYTE = 1024 * 1024;
const PACKAGE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const LOCAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const IMAGE_FILE_NAME_PATTERN = /^(question|my_solution|answer)_\d{3}\.jpg$/;
const ISO_DATE_TIME_WITH_ZONE_PATTERN = /(Z|[+-]\d{2}:\d{2})$/i;
const VALID_HIGHLIGHT_COLORS: readonly TextHighlightColor[] = ['yellow', 'red', 'green'];
const VALID_IMAGE_TYPES: readonly ModulePackageImageType[] = [
  'question',
  'my_solution',
  'answer',
];
const BUILTIN_REASON_NAMES = new Map<string, string>(
  ERROR_REASON_OPTIONS.map((item) => [item.id, item.label]),
);

export const MODULE_PACKAGE_LIMITS = Object.freeze({
  maxCompressedBytes: 500 * BYTES_PER_MEBIBYTE,
  maxUncompressedBytes: 1024 * BYTES_PER_MEBIBYTE,
  maxManifestBytes: 1 * BYTES_PER_MEBIBYTE,
  maxDataBytes: 10 * BYTES_PER_MEBIBYTE,
  maxImageBytes: 20 * BYTES_PER_MEBIBYTE,
  maxQuestions: 999,
  maxImages: 5000,
  maxArchiveEntries: 10050,
  maxImagesPerQuestion: 100,
  maxRelations: 10000,
  maxTagsPerQuestion: 12,
  maxTagLength: 20,
  maxErrorReasonsPerQuestion: 64,
  maxErrorReasonNameLength: 16,
  maxHighlightsPerQuestion: 1000,
  maxWarnings: 50,
  maxWarningLength: 500,
  maxModuleNameLength: 16,
  maxModuleDescriptionLength: 500,
  maxCreatorNameLength: 32,
  maxAppNameLength: 64,
  maxAppVersionLength: 64,
  maxIconLength: 64,
  maxValidationIssues: 200,
});

type UnknownRecord = Record<string, unknown>;

class IssueCollector {
  readonly errors: ModulePackageValidationIssue[] = [];
  readonly warnings: ModulePackageValidationIssue[] = [];

  addError(code: ModulePackageValidationCode, path: string, message: string): void {
    if (this.errors.length >= MODULE_PACKAGE_LIMITS.maxValidationIssues) {
      return;
    }
    this.errors.push({ code, path, message });
  }

  addWarning(code: ModulePackageValidationCode, path: string, message: string): void {
    if (this.warnings.length >= MODULE_PACKAGE_LIMITS.maxValidationIssues) {
      return;
    }
    this.warnings.push({ code, path, message });
  }

  merge(issues: readonly ModulePackageValidationIssue[], kind: 'error' | 'warning'): void {
    for (const issue of issues) {
      if (kind === 'error') {
        this.addError(issue.code, issue.path, issue.message);
      } else {
        this.addWarning(issue.code, issue.path, issue.message);
      }
    }
  }

  canContinue(): boolean {
    return this.errors.length < MODULE_PACKAGE_LIMITS.maxValidationIssues;
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && Number.isFinite(value) && Number(value) >= min && Number(value) <= max;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function readRequiredString(
  record: UnknownRecord,
  key: string,
  path: string,
  collector: IssueCollector,
  options: { maxLength: number; normalizeWhitespace?: boolean; pattern?: RegExp },
): string | null {
  const value = record[key];
  if (typeof value !== 'string') {
    collector.addError('invalid_type', path, '必须是字符串。');
    return null;
  }

  const normalized = options.normalizeWhitespace === false ? value.trim() : normalizeText(value);
  if (!normalized) {
    collector.addError('required', path, '不能为空。');
    return null;
  }
  if (normalized.length > options.maxLength) {
    collector.addError('out_of_range', path, `长度不能超过 ${options.maxLength}。`);
    return null;
  }
  if (options.pattern && !options.pattern.test(normalized)) {
    collector.addError('invalid_value', path, '格式不正确。');
    return null;
  }
  return normalized;
}

function readNullableString(
  record: UnknownRecord,
  key: string,
  path: string,
  collector: IssueCollector,
  maxLength: number,
  preserveWhitespace = false,
): string | null {
  const value = record[key];
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    collector.addError('invalid_type', path, '必须是字符串或 null。');
    return null;
  }

  if (value.length > maxLength) {
    collector.addError('out_of_range', path, `长度不能超过 ${maxLength}。`);
    return null;
  }
  if (!value.trim()) {
    return null;
  }
  return preserveWhitespace ? value : value.trim();
}

function readInteger(
  record: UnknownRecord,
  key: string,
  path: string,
  collector: IssueCollector,
  min: number,
  max: number,
): number | null {
  const value = record[key];
  if (!isIntegerInRange(value, min, max)) {
    collector.addError('out_of_range', path, `必须是 ${min}-${max} 的整数。`);
    return null;
  }
  return value;
}

function isIsoDateTimeWithZone(value: string): boolean {
  return ISO_DATE_TIME_WITH_ZONE_PATTERN.test(value) && !Number.isNaN(new Date(value).getTime());
}

function normalizeComparableText(value: string): string {
  return normalizeText(value).toLocaleLowerCase();
}

function validateManifestCounts(
  raw: unknown,
  path: string,
  collector: IssueCollector,
): ModulePackageCounts | null {
  if (!isRecord(raw)) {
    collector.addError('invalid_type', path, '必须是对象。');
    return null;
  }

  const questions = readInteger(
    raw,
    'questions',
    `${path}.questions`,
    collector,
    1,
    MODULE_PACKAGE_LIMITS.maxQuestions,
  );
  const images = readInteger(
    raw,
    'images',
    `${path}.images`,
    collector,
    1,
    MODULE_PACKAGE_LIMITS.maxImages,
  );
  const relations = readInteger(
    raw,
    'relations',
    `${path}.relations`,
    collector,
    0,
    MODULE_PACKAGE_LIMITS.maxRelations,
  );

  if (questions === null || images === null || relations === null) {
    return null;
  }
  if (images < questions) {
    collector.addError('count_mismatch', `${path}.images`, '图片数不能少于题目数。');
    return null;
  }
  return { questions, images, relations };
}

function validateWarnings(
  raw: unknown,
  path: string,
  collector: IssueCollector,
): string[] | null {
  if (!Array.isArray(raw)) {
    collector.addError('invalid_type', path, '必须是数组。');
    return null;
  }
  if (raw.length > MODULE_PACKAGE_LIMITS.maxWarnings) {
    collector.addError(
      'limit_exceeded',
      path,
      `警告数量不能超过 ${MODULE_PACKAGE_LIMITS.maxWarnings}。`,
    );
    return null;
  }

  const warnings: string[] = [];
  raw.forEach((item, index) => {
    if (typeof item !== 'string') {
      collector.addError('invalid_type', `${path}[${index}]`, '必须是字符串。');
      return;
    }
    const normalized = item.trim();
    if (!normalized) {
      collector.addError('required', `${path}[${index}]`, '不能为空。');
      return;
    }
    if (normalized.length > MODULE_PACKAGE_LIMITS.maxWarningLength) {
      collector.addError(
        'out_of_range',
        `${path}[${index}]`,
        `长度不能超过 ${MODULE_PACKAGE_LIMITS.maxWarningLength}。`,
      );
      return;
    }
    warnings.push(normalized);
  });
  return warnings;
}

function validateManifestInternal(raw: unknown, collector: IssueCollector): ModulePackageManifest | null {
  if (!isRecord(raw)) {
    collector.addError('invalid_type', '$.manifest', 'manifest 必须是对象。');
    return null;
  }

  if (raw.format !== MODULE_PACKAGE_FORMAT) {
    collector.addError('invalid_value', '$.manifest.format', `必须是 ${MODULE_PACKAGE_FORMAT}。`);
  }
  if (raw.formatVersion !== MODULE_PACKAGE_FORMAT_VERSION) {
    collector.addError(
      'unsupported_version',
      '$.manifest.formatVersion',
      `只支持格式版本 ${MODULE_PACKAGE_FORMAT_VERSION}。`,
    );
  }
  if (raw.contentVersion !== MODULE_PACKAGE_CONTENT_VERSION) {
    collector.addError(
      'unsupported_version',
      '$.manifest.contentVersion',
      `V1 只支持内容版本 ${MODULE_PACKAGE_CONTENT_VERSION}。`,
    );
  }

  const packageId = readRequiredString(raw, 'packageId', '$.manifest.packageId', collector, {
    maxLength: 128,
    pattern: PACKAGE_ID_PATTERN,
  });
  const appName = readRequiredString(raw, 'appName', '$.manifest.appName', collector, {
    maxLength: MODULE_PACKAGE_LIMITS.maxAppNameLength,
  });
  const appVersion = readRequiredString(raw, 'appVersion', '$.manifest.appVersion', collector, {
    maxLength: MODULE_PACKAGE_LIMITS.maxAppVersionLength,
    normalizeWhitespace: false,
  });
  const createdAt = readRequiredString(raw, 'createdAt', '$.manifest.createdAt', collector, {
    maxLength: 64,
    normalizeWhitespace: false,
  });
  if (createdAt && !isIsoDateTimeWithZone(createdAt)) {
    collector.addError('invalid_value', '$.manifest.createdAt', '必须是包含时区的 ISO 8601 时间。');
  }

  let creatorDisplayName: string | null = null;
  if (!isRecord(raw.creator)) {
    collector.addError('invalid_type', '$.manifest.creator', '必须是对象。');
  } else {
    creatorDisplayName = readNullableString(
      raw.creator,
      'displayName',
      '$.manifest.creator.displayName',
      collector,
      MODULE_PACKAGE_LIMITS.maxCreatorNameLength,
    );
  }

  let moduleName: string | null = null;
  let description: string | null = null;
  let icon: string | null = null;
  let color: string | null = null;
  if (!isRecord(raw.module)) {
    collector.addError('invalid_type', '$.manifest.module', '必须是对象。');
  } else {
    moduleName = readRequiredString(raw.module, 'name', '$.manifest.module.name', collector, {
      maxLength: MODULE_PACKAGE_LIMITS.maxModuleNameLength,
    });
    description = readNullableString(
      raw.module,
      'description',
      '$.manifest.module.description',
      collector,
      MODULE_PACKAGE_LIMITS.maxModuleDescriptionLength,
      true,
    );
    if (raw.module.subject !== 'math') {
      collector.addError('invalid_value', '$.manifest.module.subject', 'V1 只支持 math。');
    }
    icon = readRequiredString(raw.module, 'icon', '$.manifest.module.icon', collector, {
      maxLength: MODULE_PACKAGE_LIMITS.maxIconLength,
      pattern: LOCAL_ID_PATTERN,
    });
    color = readRequiredString(raw.module, 'color', '$.manifest.module.color', collector, {
      maxLength: 7,
      normalizeWhitespace: false,
      pattern: HEX_COLOR_PATTERN,
    });
  }

  const counts = validateManifestCounts(raw.counts, '$.manifest.counts', collector);
  const warnings = validateWarnings(raw.warnings, '$.manifest.warnings', collector);

  if (
    collector.errors.length > 0 ||
    !packageId ||
    !appName ||
    !appVersion ||
    !createdAt ||
    !moduleName ||
    !icon ||
    !color ||
    !counts ||
    !warnings
  ) {
    return null;
  }

  return {
    format: MODULE_PACKAGE_FORMAT,
    formatVersion: MODULE_PACKAGE_FORMAT_VERSION,
    packageId,
    contentVersion: MODULE_PACKAGE_CONTENT_VERSION,
    appName,
    appVersion,
    createdAt,
    creator: { displayName: creatorDisplayName },
    module: {
      name: moduleName,
      description,
      subject: 'math',
      icon,
      color: color.toUpperCase(),
    },
    counts,
    warnings,
  };
}

function validateErrorReasons(
  raw: unknown,
  path: string,
  collector: IssueCollector,
): ModulePackageErrorReason[] | null {
  if (!Array.isArray(raw)) {
    collector.addError('invalid_type', path, '必须是数组。');
    return null;
  }
  if (raw.length > MODULE_PACKAGE_LIMITS.maxErrorReasonsPerQuestion) {
    collector.addError(
      'limit_exceeded',
      path,
      `错因数量不能超过 ${MODULE_PACKAGE_LIMITS.maxErrorReasonsPerQuestion}。`,
    );
    return null;
  }

  const reasons: ModulePackageErrorReason[] = [];
  const seen = new Set<string>();
  raw.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) {
      collector.addError('invalid_type', itemPath, '必须是对象。');
      return;
    }
    if (item.kind !== 'builtin' && item.kind !== 'custom') {
      collector.addError('invalid_value', `${itemPath}.kind`, '必须是 builtin 或 custom。');
      return;
    }

    const name = readRequiredString(item, 'name', `${itemPath}.name`, collector, {
      maxLength: MODULE_PACKAGE_LIMITS.maxErrorReasonNameLength,
    });
    if (!name) {
      return;
    }

    if (item.kind === 'builtin') {
      const key = readRequiredString(item, 'key', `${itemPath}.key`, collector, {
        maxLength: 64,
        normalizeWhitespace: false,
      });
      if (!key) {
        return;
      }
      const expectedName = BUILTIN_REASON_NAMES.get(key);
      if (!expectedName) {
        collector.addError('invalid_reference', `${itemPath}.key`, '不是受支持的内置错因键。');
        return;
      }
      if (name !== expectedName) {
        collector.addError('invalid_value', `${itemPath}.name`, '名称与内置错因键不匹配。');
        return;
      }
      const comparableName = normalizeComparableText(name);
      if (seen.has(comparableName)) {
        collector.addError('duplicate', itemPath, '同一道题内的错因不能重复。');
        return;
      }
      seen.add(comparableName);
      reasons.push({ kind: 'builtin', key, name });
      return;
    }

    const comparableName = normalizeComparableText(name);
    if (seen.has(comparableName)) {
      collector.addError('duplicate', itemPath, '同一道题内的错因不能重复。');
      return;
    }
    seen.add(comparableName);
    reasons.push({ kind: 'custom', name });
  });
  return reasons;
}

function validateHighlights(
  raw: unknown,
  note: string | null,
  path: string,
  collector: IssueCollector,
): TextHighlightRange[] | null {
  if (!Array.isArray(raw)) {
    collector.addError('invalid_type', path, '必须是数组。');
    return null;
  }
  if (raw.length > MODULE_PACKAGE_LIMITS.maxHighlightsPerQuestion) {
    collector.addError(
      'limit_exceeded',
      path,
      `高亮数量不能超过 ${MODULE_PACKAGE_LIMITS.maxHighlightsPerQuestion}。`,
    );
    return null;
  }
  if (!note && raw.length > 0) {
    collector.addError('invalid_reference', path, '备注为空时不能包含高亮。');
    return null;
  }

  const highlights: TextHighlightRange[] = [];
  raw.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) {
      collector.addError('invalid_type', itemPath, '必须是对象。');
      return;
    }
    const start = readInteger(item, 'start', `${itemPath}.start`, collector, 0, note?.length ?? 0);
    const end = readInteger(item, 'end', `${itemPath}.end`, collector, 0, note?.length ?? 0);
    if (start === null || end === null) {
      return;
    }
    if (end <= start) {
      collector.addError('out_of_range', itemPath, '高亮 end 必须大于 start。');
      return;
    }
    if (
      typeof item.color !== 'string' ||
      !VALID_HIGHLIGHT_COLORS.includes(item.color as TextHighlightColor)
    ) {
      collector.addError('invalid_value', `${itemPath}.color`, '高亮颜色不受支持。');
      return;
    }
    highlights.push({ start, end, color: item.color as TextHighlightColor });
  });

  const ordered = [...highlights].sort((left, right) => left.start - right.start || left.end - right.end);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].start < ordered[index - 1].end) {
      collector.addError('invalid_value', path, '高亮区间不能重叠。');
      break;
    }
  }
  return highlights;
}

function validateTags(raw: unknown, path: string, collector: IssueCollector): string[] | null {
  if (!Array.isArray(raw)) {
    collector.addError('invalid_type', path, '必须是数组。');
    return null;
  }
  if (raw.length > MODULE_PACKAGE_LIMITS.maxTagsPerQuestion) {
    collector.addError(
      'limit_exceeded',
      path,
      `标签数量不能超过 ${MODULE_PACKAGE_LIMITS.maxTagsPerQuestion}。`,
    );
    return null;
  }

  const tags: string[] = [];
  const seen = new Set<string>();
  raw.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (typeof item !== 'string') {
      collector.addError('invalid_type', itemPath, '必须是字符串。');
      return;
    }
    const normalized = normalizeText(item);
    if (!normalized) {
      collector.addError('required', itemPath, '不能为空。');
      return;
    }
    if (normalized.length > MODULE_PACKAGE_LIMITS.maxTagLength) {
      collector.addError(
        'out_of_range',
        itemPath,
        `标签长度不能超过 ${MODULE_PACKAGE_LIMITS.maxTagLength}。`,
      );
      return;
    }
    const comparable = normalizeComparableText(normalized);
    if (seen.has(comparable)) {
      collector.addError('duplicate', itemPath, '同一道题内的标签不能重复。');
      return;
    }
    seen.add(comparable);
    tags.push(normalized);
  });
  return tags;
}

function isSafeArchivePath(relativePath: string, allowDirectory: boolean): boolean {
  if (!relativePath || relativePath.includes('\\') || relativePath.startsWith('/')) {
    return false;
  }
  if (/^[A-Za-z]:/.test(relativePath) || relativePath.includes('\0')) {
    return false;
  }

  const hasTrailingSlash = relativePath.endsWith('/');
  if (hasTrailingSlash && !allowDirectory) {
    return false;
  }
  const effectivePath = hasTrailingSlash ? relativePath.slice(0, -1) : relativePath;
  const segments = effectivePath.split('/');
  return segments.length > 0 && segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function validateImages(
  raw: unknown,
  itemId: string | null,
  path: string,
  collector: IssueCollector,
  seenAssetIds: Set<string>,
  seenImagePaths: Set<string>,
): ModulePackageImage[] | null {
  if (!Array.isArray(raw)) {
    collector.addError('invalid_type', path, '必须是数组。');
    return null;
  }
  if (raw.length === 0) {
    collector.addError('required', path, '每道题至少需要一张题目图片。');
    return null;
  }
  if (raw.length > MODULE_PACKAGE_LIMITS.maxImagesPerQuestion) {
    collector.addError(
      'limit_exceeded',
      path,
      `每道题图片不能超过 ${MODULE_PACKAGE_LIMITS.maxImagesPerQuestion} 张。`,
    );
    return null;
  }

  const images: ModulePackageImage[] = [];
  const sortKeys = new Set<string>();
  raw.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) {
      collector.addError('invalid_type', itemPath, '必须是对象。');
      return;
    }
    const assetId = readRequiredString(item, 'assetId', `${itemPath}.assetId`, collector, {
      maxLength: 64,
      pattern: LOCAL_ID_PATTERN,
      normalizeWhitespace: false,
    });
    if (assetId && seenAssetIds.has(assetId)) {
      collector.addError('duplicate', `${itemPath}.assetId`, 'assetId 在题包内必须唯一。');
    } else if (assetId) {
      seenAssetIds.add(assetId);
    }

    const type = item.type;
    if (typeof type !== 'string' || !VALID_IMAGE_TYPES.includes(type as ModulePackageImageType)) {
      collector.addError('invalid_value', `${itemPath}.type`, '图片类型不受支持。');
    }
    const sortOrder = readInteger(item, 'sortOrder', `${itemPath}.sortOrder`, collector, 0, 9999);
    const relativePath = readRequiredString(
      item,
      'relativePath',
      `${itemPath}.relativePath`,
      collector,
      { maxLength: 256, normalizeWhitespace: false },
    );

    if (relativePath) {
      if (!isSafeArchivePath(relativePath, false)) {
        collector.addError('invalid_path', `${itemPath}.relativePath`, '不是安全的包内相对路径。');
      } else {
        const comparablePath = relativePath.toLocaleLowerCase();
        if (seenImagePaths.has(comparablePath)) {
          collector.addError('duplicate', `${itemPath}.relativePath`, '图片路径在题包内必须唯一。');
        } else {
          seenImagePaths.add(comparablePath);
        }

        const pathSegments = relativePath.split('/');
        const fileName = pathSegments[2] ?? '';
        const fileNameMatch = IMAGE_FILE_NAME_PATTERN.exec(fileName);
        if (
          pathSegments.length !== 3 ||
          pathSegments[0] !== MODULE_PACKAGE_IMAGES_DIR_NAME ||
          pathSegments[1] !== itemId ||
          !fileNameMatch ||
          fileNameMatch[1] !== type
        ) {
          collector.addError(
            'invalid_path',
            `${itemPath}.relativePath`,
            '图片路径必须为 images/{itemId}/{type}_NNN.jpg，并与题目和类型一致。',
          );
        }
      }
    }

    if (typeof type === 'string' && VALID_IMAGE_TYPES.includes(type as ModulePackageImageType) && sortOrder !== null) {
      const sortKey = `${type}:${sortOrder}`;
      if (sortKeys.has(sortKey)) {
        collector.addError('duplicate', itemPath, '同类型图片的 sortOrder 不能重复。');
      } else {
        sortKeys.add(sortKey);
      }
    }

    if (
      assetId &&
      typeof type === 'string' &&
      VALID_IMAGE_TYPES.includes(type as ModulePackageImageType) &&
      sortOrder !== null &&
      relativePath
    ) {
      images.push({
        assetId,
        type: type as ModulePackageImageType,
        sortOrder,
        relativePath,
      });
    }
  });

  if (!images.some((image) => image.type === 'question')) {
    collector.addError('required', path, '每道题至少需要一张 question 图片。');
  }
  return images;
}

function validateQuestion(
  raw: unknown,
  index: number,
  collector: IssueCollector,
  seenItemIds: Set<string>,
  seenPositions: Set<number>,
  seenAssetIds: Set<string>,
  seenImagePaths: Set<string>,
): ModulePackageQuestion | null {
  const path = `$.data.questions[${index}]`;
  if (!isRecord(raw)) {
    collector.addError('invalid_type', path, '必须是对象。');
    return null;
  }

  const itemId = readRequiredString(raw, 'itemId', `${path}.itemId`, collector, {
    maxLength: 64,
    pattern: LOCAL_ID_PATTERN,
    normalizeWhitespace: false,
  });
  if (itemId && seenItemIds.has(itemId)) {
    collector.addError('duplicate', `${path}.itemId`, 'itemId 在题包内必须唯一。');
  } else if (itemId) {
    seenItemIds.add(itemId);
  }

  const position = readInteger(
    raw,
    'position',
    `${path}.position`,
    collector,
    1,
    MODULE_PACKAGE_LIMITS.maxQuestions,
  );
  if (position !== null && seenPositions.has(position)) {
    collector.addError('duplicate', `${path}.position`, 'position 不能重复。');
  } else if (position !== null) {
    seenPositions.add(position);
  }

  if (raw.subject !== 'math') {
    collector.addError('invalid_value', `${path}.subject`, 'V1 只支持 math。');
  }
  const title = readNullableString(raw, 'title', `${path}.title`, collector, MISTAKE_TITLE_MAX_LENGTH);
  const difficulty = readInteger(raw, 'difficulty', `${path}.difficulty`, collector, 1, 5);
  const errorReasons = validateErrorReasons(raw.errorReasons, `${path}.errorReasons`, collector);
  const note = readNullableString(
    raw,
    'note',
    `${path}.note`,
    collector,
    MISTAKE_NOTE_MAX_LENGTH,
    true,
  );
  const noteHighlights = validateHighlights(raw.noteHighlights, note, `${path}.noteHighlights`, collector);
  const mySolutionText = readNullableString(
    raw,
    'mySolutionText',
    `${path}.mySolutionText`,
    collector,
    SUPPLEMENT_TEXT_MAX_LENGTH,
    true,
  );
  const answerText = readNullableString(
    raw,
    'answerText',
    `${path}.answerText`,
    collector,
    SUPPLEMENT_TEXT_MAX_LENGTH,
    true,
  );
  const tags = validateTags(raw.tags, `${path}.tags`, collector);
  const images = validateImages(
    raw.images,
    itemId,
    `${path}.images`,
    collector,
    seenAssetIds,
    seenImagePaths,
  );

  if (
    !itemId ||
    position === null ||
    difficulty === null ||
    !errorReasons ||
    !noteHighlights ||
    !tags ||
    !images
  ) {
    return null;
  }

  return {
    itemId,
    position,
    subject: 'math',
    title,
    difficulty,
    errorReasons,
    note,
    noteHighlights,
    mySolutionText,
    answerText,
    tags,
    images,
  };
}

function validateRelations(
  raw: unknown,
  itemIds: ReadonlySet<string>,
  collector: IssueCollector,
): ModulePackageRelation[] | null {
  const path = '$.data.relations';
  if (!Array.isArray(raw)) {
    collector.addError('invalid_type', path, '必须是数组。');
    return null;
  }
  if (raw.length > MODULE_PACKAGE_LIMITS.maxRelations) {
    collector.addError(
      'limit_exceeded',
      path,
      `关系数量不能超过 ${MODULE_PACKAGE_LIMITS.maxRelations}。`,
    );
    return null;
  }

  const relations: ModulePackageRelation[] = [];
  const seen = new Set<string>();
  raw.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) {
      collector.addError('invalid_type', itemPath, '必须是对象。');
      return;
    }
    const sourceItemId = readRequiredString(
      item,
      'sourceItemId',
      `${itemPath}.sourceItemId`,
      collector,
      { maxLength: 64, pattern: LOCAL_ID_PATTERN, normalizeWhitespace: false },
    );
    const targetItemId = readRequiredString(
      item,
      'targetItemId',
      `${itemPath}.targetItemId`,
      collector,
      { maxLength: 64, pattern: LOCAL_ID_PATTERN, normalizeWhitespace: false },
    );
    if (!sourceItemId || !targetItemId) {
      return;
    }
    if (!itemIds.has(sourceItemId)) {
      collector.addError('invalid_reference', `${itemPath}.sourceItemId`, '引用了不存在的题目。');
      return;
    }
    if (!itemIds.has(targetItemId)) {
      collector.addError('invalid_reference', `${itemPath}.targetItemId`, '引用了不存在的题目。');
      return;
    }
    if (sourceItemId === targetItemId) {
      collector.addError('invalid_reference', itemPath, '题目不能关联自身。');
      return;
    }
    const relationKey = [sourceItemId, targetItemId].sort().join('\0');
    if (seen.has(relationKey)) {
      collector.addError('duplicate', itemPath, '同一对题目关系不能重复。');
      return;
    }
    seen.add(relationKey);
    relations.push({ sourceItemId, targetItemId });
  });
  return relations;
}

function validateDataInternal(raw: unknown, collector: IssueCollector): ModulePackageData | null {
  if (!isRecord(raw)) {
    collector.addError('invalid_type', '$.data', 'module.json 顶层必须是对象。');
    return null;
  }
  if (!Array.isArray(raw.questions)) {
    collector.addError('invalid_type', '$.data.questions', '必须是数组。');
    return null;
  }
  if (raw.questions.length === 0) {
    collector.addError('required', '$.data.questions', '题包至少需要一道题。');
    return null;
  }
  if (raw.questions.length > MODULE_PACKAGE_LIMITS.maxQuestions) {
    collector.addError(
      'limit_exceeded',
      '$.data.questions',
      `题目数量不能超过 ${MODULE_PACKAGE_LIMITS.maxQuestions}。`,
    );
    return null;
  }

  const seenItemIds = new Set<string>();
  const seenPositions = new Set<number>();
  const seenAssetIds = new Set<string>();
  const seenImagePaths = new Set<string>();
  const questions: ModulePackageQuestion[] = [];
  for (let index = 0; index < raw.questions.length && collector.canContinue(); index += 1) {
    const question = validateQuestion(
      raw.questions[index],
      index,
      collector,
      seenItemIds,
      seenPositions,
      seenAssetIds,
      seenImagePaths,
    );
    if (question) {
      questions.push(question);
    }
  }

  for (let expectedPosition = 1; expectedPosition <= raw.questions.length; expectedPosition += 1) {
    if (!seenPositions.has(expectedPosition)) {
      collector.addError(
        'invalid_value',
        '$.data.questions',
        `position 必须从 1 连续排列，缺少 ${expectedPosition}。`,
      );
      break;
    }
  }

  const imageCount = questions.reduce((total, question) => total + question.images.length, 0);
  if (imageCount > MODULE_PACKAGE_LIMITS.maxImages) {
    collector.addError(
      'limit_exceeded',
      '$.data.questions',
      `图片总数不能超过 ${MODULE_PACKAGE_LIMITS.maxImages}。`,
    );
  }

  const relations = validateRelations(raw.relations, seenItemIds, collector);
  if (collector.errors.length > 0 || !relations || questions.length !== raw.questions.length) {
    return null;
  }
  return { questions, relations };
}

function buildResult<T>(value: T | null, collector: IssueCollector): ModulePackageValidationResult<T> {
  if (!value || collector.errors.length > 0) {
    return {
      ok: false,
      errors: collector.errors,
      warnings: collector.warnings,
    };
  }
  return {
    ok: true,
    value,
    errors: [],
    warnings: collector.warnings,
  };
}

function validatePayloadInternal(
  manifestRaw: unknown,
  dataRaw: unknown,
  collector: IssueCollector,
): ModulePackagePayload | null {
  const manifest = validateManifestInternal(manifestRaw, collector);
  const data = validateDataInternal(dataRaw, collector);
  if (!manifest || !data || collector.errors.length > 0) {
    return null;
  }

  const actualCounts: ModulePackageCounts = {
    questions: data.questions.length,
    images: data.questions.reduce((total, question) => total + question.images.length, 0),
    relations: data.relations.length,
  };
  (Object.keys(actualCounts) as (keyof ModulePackageCounts)[]).forEach((key) => {
    if (manifest.counts[key] !== actualCounts[key]) {
      collector.addError(
        'count_mismatch',
        `$.manifest.counts.${key}`,
        `声明数量 ${manifest.counts[key]} 与实际数量 ${actualCounts[key]} 不一致。`,
      );
    }
  });

  return collector.errors.length === 0 ? { manifest, data } : null;
}

function validateArchiveEntries(
  entries: readonly ModulePackageArchiveEntry[],
  payload: ModulePackagePayload,
  collector: IssueCollector,
): void {
  const fileEntries = new Map<string, ModulePackageArchiveEntry>();
  let totalUncompressedBytes = 0;

  if (entries.length > MODULE_PACKAGE_LIMITS.maxArchiveEntries) {
    collector.addError(
      'limit_exceeded',
      '$.entries',
      `ZIP 条目数量不能超过 ${MODULE_PACKAGE_LIMITS.maxArchiveEntries}。`,
    );
  }

  const entryCountToValidate = Math.min(entries.length, MODULE_PACKAGE_LIMITS.maxArchiveEntries);
  for (let index = 0; index < entryCountToValidate && collector.canContinue(); index += 1) {
    const entry = entries[index];
    const path = `$.entries[${index}]`;
    if (!isRecord(entry)) {
      collector.addError('invalid_type', path, 'ZIP 条目必须是对象。');
      continue;
    }
    if (typeof entry.relativePath !== 'string' || !isSafeArchivePath(entry.relativePath, true)) {
      collector.addError('invalid_path', `${path}.relativePath`, 'ZIP 条目路径不安全。');
      continue;
    }
    if (!isIntegerInRange(entry.uncompressedSize, 0, MODULE_PACKAGE_LIMITS.maxUncompressedBytes)) {
      collector.addError('out_of_range', `${path}.uncompressedSize`, 'ZIP 条目大小不合法。');
      continue;
    }

    totalUncompressedBytes += entry.uncompressedSize;
    if (totalUncompressedBytes > MODULE_PACKAGE_LIMITS.maxUncompressedBytes) {
      collector.addError('limit_exceeded', '$.entries', '解压后总大小超过 1 GB。');
      break;
    }

    const isDirectory = entry.isDirectory === true || entry.relativePath.endsWith('/');
    if (isDirectory) {
      continue;
    }
    const comparablePath = entry.relativePath.toLocaleLowerCase();
    if (fileEntries.has(comparablePath)) {
      collector.addError('duplicate', `${path}.relativePath`, 'ZIP 文件路径不能重复或仅大小写不同。');
      continue;
    }
    fileEntries.set(comparablePath, entry);
  }

  const manifestEntry = fileEntries.get(MODULE_PACKAGE_MANIFEST_FILE_NAME);
  const dataEntry = fileEntries.get(MODULE_PACKAGE_DATA_FILE_NAME);
  if (!manifestEntry) {
    collector.addError('missing_file', '$.entries', `缺少 ${MODULE_PACKAGE_MANIFEST_FILE_NAME}。`);
  } else if (manifestEntry.uncompressedSize === 0) {
    collector.addError('invalid_value', '$.entries.manifest.json', 'manifest.json 不能为空。');
  } else if (manifestEntry.uncompressedSize > MODULE_PACKAGE_LIMITS.maxManifestBytes) {
    collector.addError('limit_exceeded', '$.entries.manifest.json', 'manifest.json 超过 1 MB。');
  }
  if (!dataEntry) {
    collector.addError('missing_file', '$.entries', `缺少 ${MODULE_PACKAGE_DATA_FILE_NAME}。`);
  } else if (dataEntry.uncompressedSize === 0) {
    collector.addError('invalid_value', '$.entries.module.json', 'module.json 不能为空。');
  } else if (dataEntry.uncompressedSize > MODULE_PACKAGE_LIMITS.maxDataBytes) {
    collector.addError('limit_exceeded', '$.entries.module.json', 'module.json 超过 10 MB。');
  }

  const expectedImagePaths = new Set(
    payload.data.questions.flatMap((question) =>
      question.images.map((image) => image.relativePath.toLocaleLowerCase()),
    ),
  );
  for (const imagePath of expectedImagePaths) {
    const entry = fileEntries.get(imagePath);
    if (!entry) {
      collector.addError('missing_file', `$.entries.${imagePath}`, '缺少 module.json 引用的图片。');
    } else if (entry.uncompressedSize === 0) {
      collector.addError('invalid_value', `$.entries.${imagePath}`, '图片文件不能为空。');
    } else if (entry.uncompressedSize > MODULE_PACKAGE_LIMITS.maxImageBytes) {
      collector.addError('limit_exceeded', `$.entries.${imagePath}`, '单张图片超过 20 MB。');
    }
  }

  let actualImageCount = 0;
  for (const [comparablePath, entry] of fileEntries) {
    if (
      comparablePath === MODULE_PACKAGE_MANIFEST_FILE_NAME ||
      comparablePath === MODULE_PACKAGE_DATA_FILE_NAME
    ) {
      continue;
    }
    if (!comparablePath.startsWith(`${MODULE_PACKAGE_IMAGES_DIR_NAME}/`)) {
      collector.addError('unexpected_file', `$.entries.${entry.relativePath}`, '题包中包含未允许的文件。');
      continue;
    }
    actualImageCount += 1;
    if (!expectedImagePaths.has(comparablePath)) {
      collector.addError('unexpected_file', `$.entries.${entry.relativePath}`, '图片没有被 module.json 引用。');
    }
  }
  if (actualImageCount > MODULE_PACKAGE_LIMITS.maxImages) {
    collector.addError('limit_exceeded', '$.entries', '图片文件数量超过限制。');
  }
  if (actualImageCount !== payload.manifest.counts.images) {
    collector.addError(
      'count_mismatch',
      '$.entries',
      `图片文件数 ${actualImageCount} 与 manifest 声明 ${payload.manifest.counts.images} 不一致。`,
    );
  }
}

export function validateModulePackageManifest(
  raw: unknown,
): ModulePackageValidationResult<ModulePackageManifest> {
  const collector = new IssueCollector();
  return buildResult(validateManifestInternal(raw, collector), collector);
}

export function validateModulePackageData(
  raw: unknown,
): ModulePackageValidationResult<ModulePackageData> {
  const collector = new IssueCollector();
  return buildResult(validateDataInternal(raw, collector), collector);
}

export function validateModulePackagePayload(input: {
  manifest: unknown;
  data: unknown;
}): ModulePackageValidationResult<ModulePackagePayload> {
  const collector = new IssueCollector();
  return buildResult(validatePayloadInternal(input.manifest, input.data, collector), collector);
}

export function validateModulePackageArchive(
  input: ValidateModulePackageArchiveInput,
): ModulePackageValidationResult<ModulePackagePayload> {
  const collector = new IssueCollector();
  if (
    input.compressedSizeBytes !== undefined &&
    !isIntegerInRange(input.compressedSizeBytes, 0, MODULE_PACKAGE_LIMITS.maxCompressedBytes)
  ) {
    collector.addError('limit_exceeded', '$.compressedSizeBytes', '压缩文件大小不能超过 500 MB。');
  }

  const payload = validatePayloadInternal(input.manifest, input.data, collector);
  if (payload) {
    validateArchiveEntries(input.entries, payload, collector);
  }
  return buildResult(payload, collector);
}

import { Directory, File, Paths } from 'expo-file-system';

import { REVIEW_STATUS } from '@/src/constants/review';
import { withDatabaseTransaction } from '@/src/db';
import type { CustomErrorReason } from '@/src/models/CustomErrorReason';
import type {
  ModulePackageErrorReason,
  ModulePackagePayload,
  ModulePackageQuestion,
} from '@/src/models/ModulePackage';
import type { CustomModule } from '@/src/models/CustomModule';
import type { ModuleImportWithItems } from '@/src/models/ModuleImport';
import { CustomErrorReasonRepository } from '@/src/repositories/CustomErrorReasonRepository';
import { CustomModuleRepository } from '@/src/repositories/CustomModuleRepository';
import { MistakeImageRepository } from '@/src/repositories/MistakeImageRepository';
import { MistakeRelationRepository } from '@/src/repositories/MistakeRelationRepository';
import { MistakeRepository } from '@/src/repositories/MistakeRepository';
import { MistakeTagRepository } from '@/src/repositories/MistakeTagRepository';
import { ModuleImportRepository } from '@/src/repositories/ModuleImportRepository';
import { buildImageFileName, buildMistakeImageDir } from '@/src/services/ImagePathService';
import { Logger } from '@/src/services/Logger';
import type {
  ExecutedModuleImport,
  ExecuteModuleImportInput,
  ExecuteModuleImportResult,
  ModuleImportExecutionFailureCode,
  ModuleImportExecutionProgressEvent,
} from '@/src/services/moduleTransfer/ModuleImportExecutionTypes';
import { readModuleImportPreview } from '@/src/services/moduleTransfer/ModuleImportPreviewService';
import type {
  ModuleImportPreviewFailureCode,
  ParsedModulePackagePreview,
} from '@/src/services/moduleTransfer/ModuleImportPreviewTypes';
import {
  cleanupStagedModuleImport,
  ModuleImportStagingError,
  stageModulePackageImages,
} from '@/src/services/moduleTransfer/ModuleImportStagingService';
import type {
  ModuleImportStagingFailureCode,
  StagedModuleImportAsset,
  StagedModuleImportPackage,
} from '@/src/services/moduleTransfer/ModuleImportStagingTypes';
import { serializeTextHighlights } from '@/src/utils/textHighlights';

const SERVICE_SCOPE = 'ModuleImportExecutionService';

type CommittedImage = {
  id: string;
  itemId: string;
  mistakeId: string;
  type: StagedModuleImportAsset['type'];
  uri: string;
  sortOrder: number;
};

type CommittedImageStorage = {
  directories: Directory[];
  images: CommittedImage[];
};

type TransactionResult = {
  module: CustomModule;
  importRecord: ModuleImportWithItems;
};

class ModuleImportExecutionError extends Error {
  constructor(
    readonly code: ModuleImportExecutionFailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'ModuleImportExecutionError';
  }
}

function emitProgress(
  callback: ExecuteModuleImportInput['onProgress'],
  event: ModuleImportExecutionProgressEvent,
): void {
  try {
    callback?.(event);
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Module import progress callback failed.', error);
  }
}

function failure(
  code: ModuleImportExecutionFailureCode,
  message: string,
  options?: {
    causeCode?: ModuleImportPreviewFailureCode | ModuleImportStagingFailureCode;
    cleanupWarning?: string;
  },
): ExecuteModuleImportResult {
  return {
    ok: false,
    code,
    message,
    ...(options?.causeCode ? { causeCode: options.causeCode } : {}),
    ...(options?.cleanupWarning ? { cleanupWarning: options.cleanupWarning } : {}),
  };
}

function normalizeImportedAt(value: string | undefined): string {
  const normalized = value?.trim() || new Date().toISOString();
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new ModuleImportExecutionError('invalid_input', 'importedAt 必须是有效时间。');
  }
  return parsed.toISOString();
}

function buildSessionToken(): string {
  const randomPart = Math.random().toString(36).slice(2, 14).toUpperCase();
  return `${Date.now().toString(36).toUpperCase()}${randomPart}`;
}

function buildLocalId(prefix: string, sessionToken: string, index: number): string {
  return `${prefix}${sessionToken}${String(index).padStart(4, '0')}`;
}

function normalizeComparableName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function buildCustomReasonLookup(
  reasons: CustomErrorReason[],
): Map<string, CustomErrorReason> {
  return new Map(reasons.map((reason) => [normalizeComparableName(reason.name), reason]));
}

function mapErrorReasons(
  errorReasons: ModulePackageErrorReason[],
  customReasonsByName: ReadonlyMap<string, CustomErrorReason>,
): { displayText: string | null; stableIdsJson: string | null } {
  const names: string[] = [];
  const stableIds: string[] = [];
  for (const reason of errorReasons) {
    names.push(reason.name);
    if (reason.kind === 'builtin') {
      stableIds.push(reason.key);
      continue;
    }
    const localReason = customReasonsByName.get(normalizeComparableName(reason.name));
    if (localReason) {
      stableIds.push(`custom:${localReason.id}`);
    }
  }
  return {
    displayText: names.length > 0 ? names.join('、') : null,
    stableIdsJson: stableIds.length > 0 ? JSON.stringify(stableIds) : null,
  };
}

function cleanupCommittedImageDirectories(storage: CommittedImageStorage | null): boolean {
  if (!storage) {
    return true;
  }
  let cleaned = true;
  for (const directory of [...storage.directories].reverse()) {
    try {
      if (directory.exists) {
        directory.delete();
      }
    } catch (error) {
      cleaned = false;
      Logger.error(SERVICE_SCOPE, 'Failed to clean an imported mistake image directory.', error);
    }
  }
  return cleaned;
}

function commitStagedImages(options: {
  parsed: ParsedModulePackagePreview;
  staged: StagedModuleImportPackage;
  mistakeIdByItemId: ReadonlyMap<string, string>;
  sessionToken: string;
}): CommittedImageStorage {
  const storage: CommittedImageStorage = { directories: [], images: [] };
  const stagedByAssetId = new Map(options.staged.assets.map((asset) => [asset.assetId, asset]));
  let imageIndex = 0;
  try {
    for (const question of options.parsed.payload.data.questions) {
      const mistakeId = options.mistakeIdByItemId.get(question.itemId);
      if (!mistakeId) {
        throw new ModuleImportExecutionError(
          'image_commit_failed',
          `无法为题目 ${question.itemId} 分配本机图片目录。`,
        );
      }
      const relativeDirectory = buildMistakeImageDir(mistakeId);
      const directory = new Directory(Paths.document, ...relativeDirectory.split('/'));
      if (directory.exists) {
        throw new ModuleImportExecutionError(
          'image_commit_failed',
          '本机图片目录发生 ID 冲突，请重试。',
        );
      }
      directory.create({ intermediates: true });
      storage.directories.push(directory);

      for (const image of question.images) {
        const stagedAsset = stagedByAssetId.get(image.assetId);
        if (!stagedAsset) {
          throw new ModuleImportExecutionError(
            'image_commit_failed',
            `缺少已暂存的图片 ${image.assetId}。`,
          );
        }
        const sourceFile = new File(stagedAsset.stagedUri);
        if (!sourceFile.exists) {
          throw new ModuleImportExecutionError(
            'image_commit_failed',
            `暂存图片 ${image.assetId} 已不可访问。`,
          );
        }
        const fileName = buildImageFileName(image.type, image.sortOrder + 1);
        const targetFile = new File(directory, fileName);
        if (targetFile.exists) {
          throw new ModuleImportExecutionError(
            'image_commit_failed',
            `本机图片文件名冲突：${fileName}。`,
          );
        }
        sourceFile.copy(targetFile);
        const targetSize = targetFile.exists ? targetFile.info().size : null;
        if (targetSize !== stagedAsset.sizeBytes) {
          throw new ModuleImportExecutionError(
            'image_commit_failed',
            `复制图片 ${image.assetId} 后校验失败。`,
          );
        }
        imageIndex += 1;
        storage.images.push({
          id: buildLocalId('IMG', options.sessionToken, imageIndex),
          itemId: question.itemId,
          mistakeId,
          type: image.type,
          uri: targetFile.uri,
          sortOrder: image.sortOrder,
        });
      }
    }
    return storage;
  } catch (error) {
    cleanupCommittedImageDirectories(storage);
    if (error instanceof ModuleImportExecutionError) {
      throw error;
    }
    throw new ModuleImportExecutionError('image_commit_failed', '复制题包图片到本机目录失败。');
  }
}

async function writeImportTransaction(options: {
  parsed: ParsedModulePackagePreview;
  committedStorage: CommittedImageStorage;
  mistakeIdByItemId: ReadonlyMap<string, string>;
  customReasonsByName: ReadonlyMap<string, CustomErrorReason>;
  sessionToken: string;
  importedAt: string;
}): Promise<TransactionResult> {
  const payload: ModulePackagePayload = options.parsed.payload;
  const questions = [...payload.data.questions].sort((left, right) => left.position - right.position);
  const committedImagesByItemId = new Map<string, CommittedImage[]>();
  for (const image of options.committedStorage.images) {
    const images = committedImagesByItemId.get(image.itemId) ?? [];
    images.push(image);
    committedImagesByItemId.set(image.itemId, images);
  }

  return withDatabaseTransaction(async (db) => {
    const moduleItem = await CustomModuleRepository.createImportedCustomModuleInTransaction(db, {
      name: payload.manifest.module.name,
      icon: payload.manifest.module.icon,
      color: payload.manifest.module.color,
    });
    const questionNumbers = await MistakeRepository.reserveNextQuestionNumbersByModuleInTransaction(
      db,
      moduleItem.id,
      questions.length,
    );

    let tagIndex = 0;
    for (let questionIndex = 0; questionIndex < questions.length; questionIndex += 1) {
      const question = questions[questionIndex];
      const mistakeId = options.mistakeIdByItemId.get(question.itemId);
      if (!mistakeId) {
        throw new Error(`Missing local mistake ID for ${question.itemId}.`);
      }
      const errorReason = mapErrorReasons(question.errorReasons, options.customReasonsByName);
      await MistakeRepository.createMistakeInTransaction(db, {
        id: mistakeId,
        subject: question.subject,
        module: moduleItem.name,
        module_id: moduleItem.id,
        question_no: questionNumbers[questionIndex],
        title: question.title ?? undefined,
        error_reason: errorReason.displayText ?? undefined,
        error_reason_ids: errorReason.stableIdsJson,
        difficulty: question.difficulty,
        note: question.note,
        my_solution_text: question.mySolutionText,
        answer_text: question.answerText,
        note_highlights: serializeTextHighlights(question.noteHighlights, question.note),
        status: REVIEW_STATUS.COLLECTED,
        next_review_at: null,
        last_review_at: null,
        last_review_result: null,
        is_pinned: false,
        last_viewed_at: null,
      });

      for (let tagOrder = 0; tagOrder < question.tags.length; tagOrder += 1) {
        const name = question.tags[tagOrder].trim().replace(/\s+/g, ' ');
        tagIndex += 1;
        await MistakeTagRepository.createTagInTransaction(db, {
          id: buildLocalId('TAG', options.sessionToken, tagIndex),
          mistakeId,
          name,
          normalizedName: name.toLocaleLowerCase(),
          sortOrder: tagOrder,
          createdAt: options.importedAt,
        });
      }

      for (const image of committedImagesByItemId.get(question.itemId) ?? []) {
        await MistakeImageRepository.createMistakeImageInTransaction(db, {
          id: image.id,
          mistake_id: mistakeId,
          type: image.type,
          uri: image.uri,
          sort_order: image.sortOrder,
          createdAt: options.importedAt,
        });
      }
    }

    for (let relationIndex = 0; relationIndex < payload.data.relations.length; relationIndex += 1) {
      const relation = payload.data.relations[relationIndex];
      const sourceMistakeId = options.mistakeIdByItemId.get(relation.sourceItemId);
      const targetMistakeId = options.mistakeIdByItemId.get(relation.targetItemId);
      if (!sourceMistakeId || !targetMistakeId) {
        throw new Error('题包关系引用缺少本机错题 ID。');
      }
      await MistakeRelationRepository.createRelationInTransaction(db, {
        id: buildLocalId('REL', options.sessionToken, relationIndex + 1),
        source_mistake_id: sourceMistakeId,
        target_mistake_id: targetMistakeId,
        source: 'manual',
        created_at: options.importedAt,
      });
    }

    const importRecord = await ModuleImportRepository.createImportInTransaction(db, {
      id: buildLocalId('MI', options.sessionToken, 1),
      packageId: payload.manifest.packageId,
      contentVersion: payload.manifest.contentVersion,
      moduleId: moduleItem.id,
      sourceModuleName: payload.manifest.module.name,
      description: payload.manifest.module.description,
      creatorName: payload.manifest.creator.displayName,
      packageCreatedAt: payload.manifest.createdAt,
      importedAt: options.importedAt,
      items: questions.map((question) => ({
        itemId: question.itemId,
        mistakeId: options.mistakeIdByItemId.get(question.itemId) as string,
        position: question.position,
      })),
    });
    return { module: moduleItem, importRecord };
  });
}

function buildMistakeIdMap(
  questions: ModulePackageQuestion[],
  sessionToken: string,
): Map<string, string> {
  const result = new Map<string, string>();
  for (const question of questions) {
    result.set(question.itemId, buildLocalId('M', sessionToken, question.position));
  }
  return result;
}

export async function executeModuleImport(
  input: ExecuteModuleImportInput,
): Promise<ExecuteModuleImportResult> {
  emitProgress(input?.onProgress, {
    stage: 'validating',
    message: '正在重新校验题包…',
    percent: 5,
  });
  let importedAt: string;
  try {
    importedAt = normalizeImportedAt(input?.importedAt);
  } catch (error) {
    return error instanceof ModuleImportExecutionError
      ? failure(error.code, error.message)
      : failure('invalid_input', '导入参数无效。');
  }

  const previewResult = await readModuleImportPreview({
    fileUri: input?.fileUri,
    fileName: input?.fileName,
    fileSizeBytes: input?.fileSizeBytes,
  });
  if (!previewResult.ok) {
    return failure('preview_failed', previewResult.message, { causeCode: previewResult.code });
  }
  const parsed = previewResult.value;
  const packageId = parsed.payload.manifest.packageId;

  emitProgress(input.onProgress, {
    stage: 'checking_duplicate',
    message: '正在检查是否重复导入…',
    percent: 18,
  });
  try {
    if (await ModuleImportRepository.hasImportedPackage(packageId)) {
      return failure('already_imported', '该题包已经导入，不能重复导入。');
    }
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Failed to check duplicate module package.', { packageId, error });
    return failure('duplicate_check_failed', '检查题包导入记录失败，请稍后重试。');
  }

  let customReasons: CustomErrorReason[];
  try {
    customReasons = await CustomErrorReasonRepository.listCustomErrorReasons();
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Failed to read custom error reasons before import.', error);
    return failure('local_data_read_failed', '读取本机错因数据失败，请稍后重试。');
  }

  let staged: StagedModuleImportPackage;
  emitProgress(input.onProgress, {
    stage: 'staging_images',
    message: '正在安全暂存题包图片…',
    percent: 32,
  });
  try {
    staged = await stageModulePackageImages(parsed);
  } catch (error) {
    if (error instanceof ModuleImportStagingError) {
      return failure('staging_failed', error.message, { causeCode: error.code });
    }
    Logger.error(SERVICE_SCOPE, 'Failed to stage module package.', error);
    return failure('staging_failed', '暂存题包图片失败。');
  }

  const sessionToken = buildSessionToken();
  const mistakeIdByItemId = buildMistakeIdMap(parsed.payload.data.questions, sessionToken);
  let committedStorage: CommittedImageStorage | null = null;
  let result: ExecuteModuleImportResult;
  try {
    emitProgress(input.onProgress, {
      stage: 'committing_images',
      message: '正在保存题目图片…',
      percent: 56,
    });
    committedStorage = commitStagedImages({
      parsed,
      staged,
      mistakeIdByItemId,
      sessionToken,
    });
    emitProgress(input.onProgress, {
      stage: 'writing_database',
      message: '正在写入模块和错题…',
      percent: 72,
    });
    const transactionResult = await writeImportTransaction({
      parsed,
      committedStorage,
      mistakeIdByItemId,
      customReasonsByName: buildCustomReasonLookup(customReasons),
      sessionToken,
      importedAt,
    });
    const executed: ExecutedModuleImport = {
      importId: transactionResult.importRecord.id,
      packageId,
      moduleId: transactionResult.module.id,
      moduleName: transactionResult.module.name,
      moduleDisplayCode: transactionResult.module.display_code,
      mistakeIds: transactionResult.importRecord.items.map((item) => item.mistake_id),
      imageCount: committedStorage.images.length,
      relationCount: parsed.payload.manifest.counts.relations,
      importedAt: transactionResult.importRecord.imported_at,
    };
    Logger.info(SERVICE_SCOPE, 'Executed module package import.', {
      importId: executed.importId,
      packageId,
      moduleId: executed.moduleId,
      questionCount: executed.mistakeIds.length,
      imageCount: executed.imageCount,
      relationCount: executed.relationCount,
    });
    result = { ok: true, value: executed };
  } catch (error) {
    const finalStorageCleaned = cleanupCommittedImageDirectories(committedStorage);
    const cleanupWarning = finalStorageCleaned
      ? undefined
      : '部分本机图片目录清理失败，请稍后执行存储清理。';
    if (error instanceof ModuleImportExecutionError) {
      result = failure(error.code, error.message, { cleanupWarning });
    } else {
      Logger.error(SERVICE_SCOPE, 'Module import transaction failed and was rolled back.', {
        packageId,
        error,
      });
      result = failure('transaction_failed', '导入事务失败，数据库写入已回滚。', {
        cleanupWarning,
      });
    }
  }

  emitProgress(input.onProgress, {
    stage: 'cleaning_up',
    message: '正在清理临时文件…',
    percent: 94,
  });
  const stagedCleaned = cleanupStagedModuleImport(staged);
  if (!stagedCleaned) {
    const cleanupWarning = '题包临时目录清理失败，系统稍后可统一清理缓存。';
    if (result.ok) {
      result.value.cleanupWarning = cleanupWarning;
    } else {
      result.cleanupWarning = result.cleanupWarning
        ? `${result.cleanupWarning}\n${cleanupWarning}`
        : cleanupWarning;
    }
  }
  if (result.ok) {
    emitProgress(input.onProgress, {
      stage: 'completed',
      message: '题包导入完成',
      percent: 100,
    });
  }
  return result;
}

export const ModuleImportExecutionService = {
  executeModuleImport,
} as const;

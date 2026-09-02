import { MistakeDeletionRepository, type MistakeDeletionSnapshot } from '@/src/repositories/MistakeDeletionRepository';
import { MistakeImageRepository } from '@/src/repositories/MistakeImageRepository';
import { ReviewRecordRepository } from '@/src/repositories/ReviewRecordRepository';
import {
  deleteLocalImage,
  deleteMistakeImageFolder,
  listMistakeImageFiles,
} from '@/src/services/ImageStorageService';
import { Logger } from '@/src/services/Logger';
import * as VoiceNoteService from '@/src/services/VoiceNoteService';
import { executeBulkDelete, executeBulkDeleteUndo } from '@/src/utils/bulkMistakeDeletion';

const SERVICE_SCOPE = 'BulkMistakeDeleteService';

type UndoTokenState = 'pending' | 'restoring' | 'restored' | 'finalizing' | 'finalized';

export interface BulkMistakeDeleteUndoToken {
  readonly id: string;
  readonly deletedCount: number;
  readonly createdAt: string;
  readonly snapshot: MistakeDeletionSnapshot;
  state: UndoTokenState;
}

export type BulkMistakeDeleteResult =
  | { ok: true; deletedCount: number; undoToken: BulkMistakeDeleteUndoToken }
  | { ok: false; errorMessage: string };

export type BulkMistakeDeleteUndoResult =
  | { ok: true; restoredCount: number }
  | { ok: false; errorMessage: string };

export interface FinalizeBulkMistakeDeleteResult {
  deletedImageFileCount: number;
  deletedImageFolderCount: number;
  deletedVoiceNoteCount: number;
  failedFileCount: number;
}

function buildTokenId(): string {
  return `bulk-delete-${Date.now()}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
}

function normalizeUri(value: string | null | undefined): string | null {
  const uri = typeof value === 'string' ? value.trim() : '';
  return uri || null;
}

function parseVoiceNoteUri(value: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as { fileUri?: unknown };
    return normalizeUri(typeof parsed.fileUri === 'string' ? parsed.fileUri : null);
  } catch {
    return null;
  }
}

export async function deleteMistakes(ids: string[]): Promise<BulkMistakeDeleteResult> {
  const result = await executeBulkDelete(ids, {
    deleteInTransaction: (normalizedIds) => (
      MistakeDeletionRepository.deleteMistakesWithSnapshot(normalizedIds)
    ),
    getDeletedCount: (snapshot) => snapshot.mistakes.length,
  });

  if (!result.ok) {
    Logger.error(SERVICE_SCOPE, 'Bulk mistake delete failed.', {
      requestedCount: ids.length,
      errorMessage: result.errorMessage,
    });
    return result;
  }

  const undoToken: BulkMistakeDeleteUndoToken = {
    id: buildTokenId(),
    deletedCount: result.deletedCount,
    createdAt: new Date().toISOString(),
    snapshot: result.snapshot,
    state: 'pending',
  };

  Logger.info(SERVICE_SCOPE, 'Bulk mistake delete committed; file cleanup deferred.', {
    tokenId: undoToken.id,
    deletedCount: undoToken.deletedCount,
  });

  return { ok: true, deletedCount: result.deletedCount, undoToken };
}

export async function undoDelete(
  token: BulkMistakeDeleteUndoToken,
): Promise<BulkMistakeDeleteUndoResult> {
  if (token.state !== 'pending') {
    return {
      ok: false,
      errorMessage: token.state === 'restored' ? '这些题目已经恢复。' : '撤销时间已结束。',
    };
  }

  token.state = 'restoring';
  const result = await executeBulkDeleteUndo(token.snapshot, token.deletedCount, {
    restoreInTransaction: (snapshot) => (
      MistakeDeletionRepository.restoreMistakesFromSnapshot(snapshot)
    ),
  });

  if (!result.ok) {
    token.state = 'pending';
    Logger.error(SERVICE_SCOPE, 'Bulk mistake delete undo failed.', {
      tokenId: token.id,
      errorMessage: result.errorMessage,
    });
    return result;
  }

  token.state = 'restored';
  Logger.info(SERVICE_SCOPE, 'Bulk mistake delete restored.', {
    tokenId: token.id,
    restoredCount: result.restoredCount,
  });
  return result;
}

export async function finalizeDelete(
  token: BulkMistakeDeleteUndoToken,
): Promise<FinalizeBulkMistakeDeleteResult> {
  const emptyResult: FinalizeBulkMistakeDeleteResult = {
    deletedImageFileCount: 0,
    deletedImageFolderCount: 0,
    deletedVoiceNoteCount: 0,
    failedFileCount: 0,
  };
  if (token.state !== 'pending') {
    return emptyResult;
  }

  token.state = 'finalizing';
  const result = { ...emptyResult };

  try {
    const referencedImageUris = new Set(
      (await MistakeImageRepository.listAllImageUris())
        .map(normalizeUri)
        .filter((uri): uri is string => uri !== null),
    );
    const processedImageUris = new Set<string>();

    for (const mistake of token.snapshot.mistakes) {
      const folderFiles = await listMistakeImageFiles(mistake.id);
      const hasReferencedFolderFile = folderFiles.some((uri) => referencedImageUris.has(uri));

      if (folderFiles.length > 0 && !hasReferencedFolderFile) {
        if (await deleteMistakeImageFolder(mistake.id)) {
          result.deletedImageFolderCount += 1;
          folderFiles.forEach((uri) => processedImageUris.add(uri));
        } else {
          result.failedFileCount += 1;
        }
      } else {
        for (const uri of folderFiles) {
          processedImageUris.add(uri);
          if (!referencedImageUris.has(uri)) {
            if (await deleteLocalImage(uri)) {
              result.deletedImageFileCount += 1;
            } else {
              result.failedFileCount += 1;
            }
          }
        }
      }
    }

    for (const image of token.snapshot.images) {
      const uri = normalizeUri(image.uri);
      if (!uri || processedImageUris.has(uri) || referencedImageUris.has(uri)) {
        continue;
      }
      processedImageUris.add(uri);
      if (await deleteLocalImage(uri)) {
        result.deletedImageFileCount += 1;
      } else {
        result.failedFileCount += 1;
      }
    }

    const referencedVoiceNoteUris = new Set(
      (await ReviewRecordRepository.listAllReviewRecords())
        .map((record) => normalizeUri(record.voice_note?.fileUri))
        .filter((uri): uri is string => uri !== null),
    );
    const voiceNoteUris = new Set(
      token.snapshot.reviewRecords
        .map((record) => parseVoiceNoteUri(record.voice_note))
        .filter((uri): uri is string => uri !== null),
    );

    for (const uri of voiceNoteUris) {
      if (referencedVoiceNoteUris.has(uri)) {
        continue;
      }
      const deleteResult = await VoiceNoteService.deleteVoiceNote(uri);
      if (deleteResult.ok) {
        if (deleteResult.deleted) {
          result.deletedVoiceNoteCount += 1;
        }
      } else {
        result.failedFileCount += 1;
      }
    }
  } catch (error) {
    result.failedFileCount += 1;
    Logger.error(SERVICE_SCOPE, 'Deferred bulk delete file cleanup failed.', {
      tokenId: token.id,
      error,
    });
  } finally {
    token.state = 'finalized';
  }

  Logger.info(SERVICE_SCOPE, 'Deferred bulk delete file cleanup completed.', {
    tokenId: token.id,
    ...result,
  });
  return result;
}

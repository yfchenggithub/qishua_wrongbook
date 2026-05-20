import { withDatabaseTransaction } from '@/src/db';
import type { ReviewRecordVoiceNote } from '@/src/models/ReviewRecord';
import { ReviewRecordRepository } from '@/src/repositories';
import { Logger } from '@/src/services/Logger';

const SERVICE_SCOPE = 'ReviewRecordVoiceService';

export type UpsertReviewRecordVoiceNoteParams = {
  mistakeId: string;
  reviewRecordId: string;
  voiceNote: ReviewRecordVoiceNote;
};

export type UpsertReviewRecordVoiceNoteResult = {
  ok: boolean;
  errorMessage?: string;
};

function normalizeRequiredText(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const normalized = error.message.trim();
    return normalized.length > 0 ? normalized : fallback;
  }
  const normalized = String(error ?? '').trim();
  return normalized.length > 0 ? normalized : fallback;
}

async function ensureRecordMatchesMistake(
  mistakeId: string,
  reviewRecordId: string,
): Promise<{ ok: true } | { ok: false; errorMessage: string }> {
  const record = await ReviewRecordRepository.getReviewRecordById(reviewRecordId);
  if (!record) {
    return {
      ok: false,
      errorMessage: '复做记录不存在，请刷新后重试。',
    };
  }

  if (record.mistake_id !== mistakeId) {
    return {
      ok: false,
      errorMessage: '复做记录与当前错题不匹配。',
    };
  }

  return { ok: true };
}

export async function upsertReviewRecordVoiceNote(
  params: UpsertReviewRecordVoiceNoteParams,
): Promise<UpsertReviewRecordVoiceNoteResult> {
  const mistakeId = normalizeRequiredText(params.mistakeId);
  const reviewRecordId = normalizeRequiredText(params.reviewRecordId);
  const voiceNote = params.voiceNote;

  if (!mistakeId) {
    return {
      ok: false,
      errorMessage: '错题 id 不能为空。',
    };
  }

  if (!reviewRecordId) {
    return {
      ok: false,
      errorMessage: '复做记录 id 不能为空。',
    };
  }

  if (!voiceNote) {
    return {
      ok: false,
      errorMessage: '语音信息不能为空。',
    };
  }

  try {
    const ensureResult = await ensureRecordMatchesMistake(mistakeId, reviewRecordId);
    if (!ensureResult.ok) {
      return ensureResult;
    }

    const updated = await withDatabaseTransaction((db) =>
      ReviewRecordRepository.updateReviewRecordVoiceNoteInTransaction(db, reviewRecordId, voiceNote),
    );

    if (!updated) {
      return {
        ok: false,
        errorMessage: '复做记录不存在，请刷新后重试。',
      };
    }

    Logger.info(SERVICE_SCOPE, 'Bound voice note to review record successfully.', {
      mistakeId,
      reviewRecordId,
      voiceNoteId: voiceNote.id,
      durationMs: voiceNote.durationMs,
      sizeBytes: voiceNote.sizeBytes,
    });

    return {
      ok: true,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'upsertReviewRecordVoiceNote failed.', {
      mistakeId,
      reviewRecordId,
      voiceNoteId: voiceNote.id,
      error,
    });
    return {
      ok: false,
      errorMessage: toErrorMessage(error, '语音讲解保存失败，请重试。'),
    };
  }
}

import { REVIEW_TEXT_NOTE_MAX_LENGTH } from '@/src/constants/review';
import { withDatabaseTransaction } from '@/src/db';
import { ReviewRecordRepository } from '@/src/repositories';
import { Logger } from '@/src/services/Logger';

const SERVICE_SCOPE = 'ReviewRecordTextService';

export type UpsertReviewRecordTextParams = {
  mistakeId: string;
  reviewRecordId: string;
  note: string;
};

export type UpsertReviewRecordTextResult = {
  ok: boolean;
  note?: string;
  errorMessage?: string;
};

function normalizeRequiredText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return '文本讲解保存失败，请重试。';
}

export async function upsertReviewRecordText(
  params: UpsertReviewRecordTextParams,
): Promise<UpsertReviewRecordTextResult> {
  const mistakeId = normalizeRequiredText(params.mistakeId);
  const reviewRecordId = normalizeRequiredText(params.reviewRecordId);
  const note = normalizeRequiredText(params.note);

  if (!mistakeId) {
    return { ok: false, errorMessage: '错题 id 不能为空。' };
  }
  if (!reviewRecordId) {
    return { ok: false, errorMessage: '复做记录 id 不能为空。' };
  }
  if (!note) {
    return { ok: false, errorMessage: '文本讲解不能为空。' };
  }
  if (note.length > REVIEW_TEXT_NOTE_MAX_LENGTH) {
    return {
      ok: false,
      errorMessage: `文本讲解不能超过 ${REVIEW_TEXT_NOTE_MAX_LENGTH} 字。`,
    };
  }

  try {
    const record = await ReviewRecordRepository.getReviewRecordById(reviewRecordId);
    if (!record) {
      return { ok: false, errorMessage: '复做记录不存在，请刷新后重试。' };
    }
    if (record.mistake_id !== mistakeId) {
      return { ok: false, errorMessage: '复做记录与当前错题不匹配。' };
    }

    const updated = await withDatabaseTransaction((db) =>
      ReviewRecordRepository.updateReviewRecordNoteInTransaction(db, reviewRecordId, note),
    );
    if (!updated) {
      return { ok: false, errorMessage: '复做记录不存在，请刷新后重试。' };
    }

    Logger.info(SERVICE_SCOPE, 'Saved review record text successfully.', {
      mistakeId,
      reviewRecordId,
      noteLength: note.length,
    });
    return { ok: true, note };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'upsertReviewRecordText failed.', {
      mistakeId,
      reviewRecordId,
      error,
    });
    return { ok: false, errorMessage: toErrorMessage(error) };
  }
}

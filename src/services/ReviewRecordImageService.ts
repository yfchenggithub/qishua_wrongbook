import { MistakeImageRepository, ReviewRecordRepository } from '@/src/repositories';
import { Logger } from '@/src/services/Logger';

const SERVICE_SCOPE = 'ReviewRecordImageService';

export type UpdateReviewRecordImageParams = {
  mistakeId: string;
  reviewRecordId: string;
  imageUri: string;
};

export type UpdateReviewRecordImageResult = {
  ok: boolean;
  imageId?: string;
  errorMessage?: string;
};

export type RemoveReviewRecordImageParams = {
  mistakeId: string;
  reviewRecordId: string;
};

export type RemoveReviewRecordImageResult = {
  ok: boolean;
  deletedCount?: number;
  errorMessage?: string;
};

function normalizeRequiredText(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function toShortUri(uri: string | null | undefined): string | null {
  const normalized = normalizeRequiredText(uri);
  if (!normalized) {
    return null;
  }
  if (normalized.length <= 64) {
    return normalized;
  }
  return `${normalized.slice(0, 28)}...${normalized.slice(-20)}`;
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

export async function updateReviewRecordImage(
  params: UpdateReviewRecordImageParams,
): Promise<UpdateReviewRecordImageResult> {
  const mistakeId = normalizeRequiredText(params.mistakeId);
  const reviewRecordId = normalizeRequiredText(params.reviewRecordId);
  const imageUri = normalizeRequiredText(params.imageUri);

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

  if (!imageUri) {
    return {
      ok: false,
      errorMessage: '图片地址不能为空。',
    };
  }

  try {
    const ensureResult = await ensureRecordMatchesMistake(mistakeId, reviewRecordId);
    if (!ensureResult.ok) {
      return ensureResult;
    }

    const upserted = await MistakeImageRepository.upsertReviewSolutionImageByReviewRecordId(
      mistakeId,
      reviewRecordId,
      imageUri,
    );

    Logger.info(SERVICE_SCOPE, 'Updated review record image successfully.', {
      mistakeId,
      reviewRecordId,
      imageId: upserted.id,
      imageUriShort: toShortUri(upserted.uri),
    });

    return {
      ok: true,
      imageId: upserted.id,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'updateReviewRecordImage failed.', {
      mistakeId,
      reviewRecordId,
      imageUriShort: toShortUri(imageUri),
      error,
    });
    return {
      ok: false,
      errorMessage: toErrorMessage(error, '复做图片更新失败，请重试。'),
    };
  }
}

export async function removeReviewRecordImage(
  params: RemoveReviewRecordImageParams,
): Promise<RemoveReviewRecordImageResult> {
  const mistakeId = normalizeRequiredText(params.mistakeId);
  const reviewRecordId = normalizeRequiredText(params.reviewRecordId);

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

  try {
    const ensureResult = await ensureRecordMatchesMistake(mistakeId, reviewRecordId);
    if (!ensureResult.ok) {
      return ensureResult;
    }

    const deletedCount = await MistakeImageRepository.deleteImagesByReviewRecordId(reviewRecordId);
    Logger.info(SERVICE_SCOPE, 'Removed review record image successfully.', {
      mistakeId,
      reviewRecordId,
      deletedCount,
    });

    return {
      ok: true,
      deletedCount,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'removeReviewRecordImage failed.', {
      mistakeId,
      reviewRecordId,
      error,
    });
    return {
      ok: false,
      errorMessage: toErrorMessage(error, '复做图片更新失败，请重试。'),
    };
  }
}

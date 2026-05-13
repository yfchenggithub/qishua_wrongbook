import { getDatabase, initDatabase } from '@/src/db';
import type { ImageType, MistakeImageType } from '@/src/models/Mistake';
import type { CreateMistakeImageInput, MistakeImage } from '@/src/models/MistakeImage';
import { Logger } from '@/src/services/Logger';
import type * as SQLite from 'expo-sqlite';

const REPO_SCOPE = 'MistakeImageRepository';

type InsertableMistakeImageType = Exclude<ImageType, 'review_solution'>;

export interface InsertMistakeImageItem {
  type: InsertableMistakeImageType;
  uri: string;
  sort_order?: number;
}

export interface InsertReviewSolutionImageItem {
  uri: string;
  sort_order?: number;
  type?: 'review_solution';
}

const INSERT_MISTAKE_IMAGE_SQL = `
INSERT INTO mistake_images (
  id,
  mistake_id,
  review_record_id,
  type,
  uri,
  sort_order,
  created_at
) VALUES (?, ?, ?, ?, ?, ?, ?);
`;

const SELECT_MISTAKE_IMAGE_FIELDS_SQL = `
SELECT
  id,
  mistake_id,
  review_record_id,
  type,
  uri,
  sort_order,
  created_at
FROM mistake_images
`;

let databaseReady = false;
let databaseInitPromise: Promise<void> | null = null;

// The repository assumes app startup runs initDatabase().
// For safety, we still lazy-initialize here to prevent direct repository usage from failing.
async function ensureDatabaseReady(): Promise<void> {
  if (databaseReady) {
    return;
  }

  if (databaseInitPromise) {
    return databaseInitPromise;
  }

  databaseInitPromise = initDatabase()
    .then(() => {
      databaseReady = true;
    })
    .catch((error) => {
      Logger.error(REPO_SCOPE, 'Failed to ensure database initialization.', error);
      throw error;
    })
    .finally(() => {
      databaseInitPromise = null;
    });

  return databaseInitPromise;
}

function nowIso(): string {
  return new Date().toISOString();
}

function buildMistakeImageId(): string {
  const randomPart = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');
  return `IMG${Date.now()}${randomPart}`;
}

function normalizeRequiredText(value: string, fieldName: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (normalized.length <= 0) {
    throw new Error(`${fieldName} cannot be empty.`);
  }
  return normalized;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeSortOrder(value: number | undefined, fallbackOrder: number): number {
  if (value === undefined) {
    return fallbackOrder;
  }
  if (!Number.isFinite(value)) {
    throw new Error('sort_order must be a finite integer.');
  }
  const normalized = Math.floor(value);
  if (normalized < 0) {
    throw new Error('sort_order must be >= 0.');
  }
  return normalized;
}

function assertReviewRecordBinding(type: MistakeImageType, reviewRecordId: string | null): void {
  if (type === 'review_solution') {
    if (!reviewRecordId) {
      throw new Error('review_solution image requires review_record_id.');
    }
    return;
  }

  if (reviewRecordId) {
    throw new Error(`${type} image must not carry review_record_id.`);
  }
}

function mapMistakeImageRow(row: MistakeImage): MistakeImage {
  return {
    ...row,
    review_record_id: normalizeOptionalText(row.review_record_id) ?? null,
    type: row.type as MistakeImageType,
    sort_order: Number(row.sort_order),
  };
}

function buildMistakeImage(
  input: CreateMistakeImageInput & { id?: string; createdAt?: string; sortOrderFallback?: number },
): MistakeImage {
  const mistakeId = normalizeRequiredText(input.mistake_id, 'mistake_id');
  const uri = normalizeRequiredText(input.uri, 'uri');
  const reviewRecordId = normalizeOptionalText(input.review_record_id);
  const sortOrder = normalizeSortOrder(input.sort_order, input.sortOrderFallback ?? 0);
  const type = input.type;

  assertReviewRecordBinding(type, reviewRecordId);

  return {
    id: input.id?.trim() || buildMistakeImageId(),
    mistake_id: mistakeId,
    review_record_id: reviewRecordId,
    type,
    uri,
    sort_order: sortOrder,
    created_at: input.createdAt ?? nowIso(),
  };
}

async function getImageByIdInternal(id: string): Promise<MistakeImage | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<MistakeImage>(
    `${SELECT_MISTAKE_IMAGE_FIELDS_SQL}
WHERE id = ?
LIMIT 1;`,
    id,
  );

  if (!row) {
    return null;
  }

  return mapMistakeImageRow(row);
}

function ensureMistakeImageTypeAllowedForMistakeInsert(type: ImageType): InsertableMistakeImageType {
  if (type === 'review_solution') {
    throw new Error('insertMistakeImages cannot insert type=review_solution.');
  }
  return type;
}

function ensureReviewSolutionTypeOnly(type: 'review_solution' | undefined): void {
  if (type !== undefined && type !== 'review_solution') {
    throw new Error('insertReviewSolutionImages only accepts review_solution type.');
  }
}

export const MistakeImageRepository = {
  async createMistakeImage(input: CreateMistakeImageInput): Promise<MistakeImage> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const record = await MistakeImageRepository.createMistakeImageInTransaction(db, input);

      const created = await getImageByIdInternal(record.id);
      if (!created) {
        throw new Error('Failed to load the created mistake image record.');
      }

      return created;
    } catch (error) {
      Logger.error(REPO_SCOPE, 'createMistakeImage failed.', { input, error });
      throw error;
    }
  },

  async createMistakeImageInTransaction(
    db: SQLite.SQLiteDatabase,
    input: CreateMistakeImageInput & { id?: string; createdAt?: string; sortOrderFallback?: number },
  ): Promise<MistakeImage> {
    try {
      const record = buildMistakeImage(input);
      await db.runAsync(
        INSERT_MISTAKE_IMAGE_SQL,
        record.id,
        record.mistake_id,
        record.review_record_id ?? null,
        record.type,
        record.uri,
        record.sort_order,
        record.created_at,
      );

      return mapMistakeImageRow(record);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'createMistakeImageInTransaction failed.', { input, error });
      throw error;
    }
  },

  async getImagesByMistakeId(mistakeId: string): Promise<MistakeImage[]> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const normalizedMistakeId = normalizeRequiredText(mistakeId, 'mistakeId');
      const rows = await db.getAllAsync<MistakeImage>(
        `${SELECT_MISTAKE_IMAGE_FIELDS_SQL}
WHERE mistake_id = ?
ORDER BY type ASC, sort_order ASC, created_at ASC;`,
        normalizedMistakeId,
      );

      return rows.map(mapMistakeImageRow);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'getImagesByMistakeId failed.', { mistakeId, error });
      throw error;
    }
  },

  async getImagesByMistakeIdAndType(mistakeId: string, type: ImageType): Promise<MistakeImage[]> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const normalizedMistakeId = normalizeRequiredText(mistakeId, 'mistakeId');
      const rows = await db.getAllAsync<MistakeImage>(
        `${SELECT_MISTAKE_IMAGE_FIELDS_SQL}
WHERE mistake_id = ?
  AND type = ?
ORDER BY sort_order ASC, created_at ASC;`,
        normalizedMistakeId,
        type,
      );

      return rows.map(mapMistakeImageRow);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'getImagesByMistakeIdAndType failed.', { mistakeId, type, error });
      throw error;
    }
  },

  async getCoverImageForMistake(mistakeId: string): Promise<MistakeImage | null> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const normalizedMistakeId = normalizeRequiredText(mistakeId, 'mistakeId');

      const questionCover = await db.getFirstAsync<MistakeImage>(
        `${SELECT_MISTAKE_IMAGE_FIELDS_SQL}
WHERE mistake_id = ?
  AND type = 'question'
ORDER BY sort_order ASC, created_at ASC
LIMIT 1;`,
        normalizedMistakeId,
      );
      if (questionCover) {
        return mapMistakeImageRow(questionCover);
      }

      const solutionCover = await db.getFirstAsync<MistakeImage>(
        `${SELECT_MISTAKE_IMAGE_FIELDS_SQL}
WHERE mistake_id = ?
  AND type = 'my_solution'
ORDER BY sort_order ASC, created_at ASC
LIMIT 1;`,
        normalizedMistakeId,
      );
      if (solutionCover) {
        return mapMistakeImageRow(solutionCover);
      }

      return null;
    } catch (error) {
      Logger.error(REPO_SCOPE, 'getCoverImageForMistake failed.', { mistakeId, error });
      throw error;
    }
  },

  async getReviewSolutionImages(reviewRecordId: string): Promise<MistakeImage[]> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const normalizedReviewRecordId = normalizeRequiredText(reviewRecordId, 'reviewRecordId');
      const rows = await db.getAllAsync<MistakeImage>(
        `${SELECT_MISTAKE_IMAGE_FIELDS_SQL}
WHERE review_record_id = ?
  AND type = 'review_solution'
ORDER BY sort_order ASC, created_at ASC;`,
        normalizedReviewRecordId,
      );

      return rows.map(mapMistakeImageRow);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'getReviewSolutionImages failed.', { reviewRecordId, error });
      throw error;
    }
  },

  async insertMistakeImages(mistakeId: string, images: InsertMistakeImageItem[]): Promise<MistakeImage[]> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      return await MistakeImageRepository.insertMistakeImagesInTransaction(db, mistakeId, images);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'insertMistakeImages failed.', { mistakeId, images, error });
      throw error;
    }
  },

  async insertReviewSolutionImages(
    mistakeId: string,
    reviewRecordId: string,
    images: InsertReviewSolutionImageItem[],
  ): Promise<MistakeImage[]> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      return await MistakeImageRepository.insertReviewSolutionImagesInTransaction(
        db,
        mistakeId,
        reviewRecordId,
        images,
      );
    } catch (error) {
      Logger.error(REPO_SCOPE, 'insertReviewSolutionImages failed.', {
        mistakeId,
        reviewRecordId,
        images,
        error,
      });
      throw error;
    }
  },

  async insertMistakeImagesInTransaction(
    db: SQLite.SQLiteDatabase,
    mistakeId: string,
    images: InsertMistakeImageItem[],
    createdAt?: string,
  ): Promise<MistakeImage[]> {
    const normalizedMistakeId = normalizeRequiredText(mistakeId, 'mistakeId');
    if (!Array.isArray(images)) {
      throw new Error('images must be an array.');
    }

    const batchCreatedAt = createdAt ?? nowIso();
    const created: MistakeImage[] = [];
    for (let index = 0; index < images.length; index += 1) {
      const image = images[index];
      const normalizedType = ensureMistakeImageTypeAllowedForMistakeInsert(image.type);
      const record = await MistakeImageRepository.createMistakeImageInTransaction(db, {
        mistake_id: normalizedMistakeId,
        review_record_id: null,
        type: normalizedType,
        uri: image.uri,
        sort_order: image.sort_order,
        sortOrderFallback: index,
        createdAt: batchCreatedAt,
      });
      created.push(record);
    }
    return created;
  },

  async insertReviewSolutionImagesInTransaction(
    db: SQLite.SQLiteDatabase,
    mistakeId: string,
    reviewRecordId: string,
    images: InsertReviewSolutionImageItem[],
    createdAt?: string,
  ): Promise<MistakeImage[]> {
    const normalizedMistakeId = normalizeRequiredText(mistakeId, 'mistakeId');
    const normalizedReviewRecordId = normalizeRequiredText(reviewRecordId, 'reviewRecordId');
    if (!Array.isArray(images)) {
      throw new Error('images must be an array.');
    }

    const batchCreatedAt = createdAt ?? nowIso();
    const created: MistakeImage[] = [];
    for (let index = 0; index < images.length; index += 1) {
      const image = images[index];
      ensureReviewSolutionTypeOnly(image.type);
      const record = await MistakeImageRepository.createMistakeImageInTransaction(db, {
        mistake_id: normalizedMistakeId,
        review_record_id: normalizedReviewRecordId,
        type: 'review_solution',
        uri: image.uri,
        sort_order: image.sort_order,
        sortOrderFallback: index,
        createdAt: batchCreatedAt,
      });
      created.push(record);
    }
    return created;
  },

  async countMistakeImages(): Promise<number> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const row = await db.getFirstAsync<{ total: number | null }>(
        `SELECT COUNT(*) AS total
FROM mistake_images;`,
      );

      return Number(row?.total ?? 0);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'countMistakeImages failed.', error);
      throw error;
    }
  },

  async deleteImage(id: string): Promise<boolean> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const result = await db.runAsync('DELETE FROM mistake_images WHERE id = ?;', id);
      return result.changes > 0;
    } catch (error) {
      Logger.error(REPO_SCOPE, 'deleteImage failed.', { id, error });
      throw error;
    }
  },

  async deleteImagesByMistakeId(mistakeId: string): Promise<number> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const normalizedMistakeId = normalizeRequiredText(mistakeId, 'mistakeId');
      const result = await db.runAsync('DELETE FROM mistake_images WHERE mistake_id = ?;', normalizedMistakeId);
      return result.changes;
    } catch (error) {
      Logger.error(REPO_SCOPE, 'deleteImagesByMistakeId failed.', { mistakeId, error });
      throw error;
    }
  },

  async deleteImagesByReviewRecordId(reviewRecordId: string): Promise<number> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const normalizedReviewRecordId = normalizeRequiredText(reviewRecordId, 'reviewRecordId');
      const result = await db.runAsync(
        `DELETE FROM mistake_images
WHERE review_record_id = ?
  AND type = 'review_solution';`,
        normalizedReviewRecordId,
      );
      return result.changes;
    } catch (error) {
      Logger.error(REPO_SCOPE, 'deleteImagesByReviewRecordId failed.', { reviewRecordId, error });
      throw error;
    }
  },

  // Backward-compatible aliases during refactor.
  async listImagesByMistakeId(mistakeId: string): Promise<MistakeImage[]> {
    return MistakeImageRepository.getImagesByMistakeId(mistakeId);
  },

  async listImagesByType(mistakeId: string, type: MistakeImageType): Promise<MistakeImage[]> {
    return MistakeImageRepository.getImagesByMistakeIdAndType(mistakeId, type);
  },
} as const;

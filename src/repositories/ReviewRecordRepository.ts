import { getDatabase, initDatabase } from '@/src/db';
import { MAX_REVIEW_COUNT } from '@/src/constants/review';
import type { ReviewResult } from '@/src/models/Mistake';
import type {
  CreateReviewRecordInput,
  ReviewRecord,
  ReviewRecordVoiceNote,
} from '@/src/models/ReviewRecord';
import { Logger } from '@/src/services/Logger';
import type * as SQLite from 'expo-sqlite';

const REPO_SCOPE = 'ReviewRecordRepository';

const INSERT_REVIEW_RECORD_SQL = `
INSERT INTO review_records (
  id,
  mistake_id,
  review_index,
  result,
  note,
  voice_note,
  created_at
) VALUES (?, ?, ?, ?, ?, ?, ?);
`;

const SELECT_REVIEW_RECORD_FIELDS_SQL = `
SELECT
  id,
  mistake_id,
  review_index,
  result,
  note,
  voice_note,
  created_at
FROM review_records
`;

export interface ReviewRecordResultStats {
  total: number;
  mastered: number;
  unsure: number;
  wrong: number;
}

export interface ListAllReviewRecordsOptions {
  limit?: number;
  offset?: number;
}

type ReviewRecordRow = {
  id: string;
  mistake_id: string;
  review_index: number;
  result: string | null;
  note?: string | null;
  voice_note?: string | null;
  created_at: string;
};

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

function buildReviewRecordId(): string {
  const randomPart = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');
  return `R${Date.now()}${randomPart}`;
}

function normalizeReviewIndex(reviewIndex: number): number {
  const normalized = Math.floor(reviewIndex);
  if (normalized < 1 || normalized > MAX_REVIEW_COUNT) {
    throw new Error(`review_index must be an integer between 1 and ${MAX_REVIEW_COUNT}.`);
  }
  return normalized;
}

function normalizeStoredReviewResult(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeRequiredText(value: string | null | undefined, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }

  return trimmed;
}

function normalizeReviewRecordVoiceNote(
  value: unknown,
  source: 'input' | 'stored',
): ReviewRecordVoiceNote | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<ReviewRecordVoiceNote>;
  const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
  const fileUri = typeof candidate.fileUri === 'string' ? candidate.fileUri.trim() : '';
  const fileName = typeof candidate.fileName === 'string' ? candidate.fileName.trim() : '';
  const createdAt = typeof candidate.createdAt === 'string' ? candidate.createdAt.trim() : '';

  const durationMsRaw = candidate.durationMs;
  const sizeBytesRaw = candidate.sizeBytes;
  const durationMs =
    typeof durationMsRaw === 'number' && Number.isFinite(durationMsRaw)
      ? Math.max(0, Math.floor(durationMsRaw))
      : NaN;
  const sizeBytes =
    typeof sizeBytesRaw === 'number' && Number.isFinite(sizeBytesRaw)
      ? Math.max(0, Math.floor(sizeBytesRaw))
      : NaN;

  const hasRequiredText = id.length > 0 && fileUri.length > 0 && fileName.length > 0 && createdAt.length > 0;
  const hasRequiredNumbers = Number.isFinite(durationMs) && Number.isFinite(sizeBytes);

  if (!hasRequiredText || !hasRequiredNumbers) {
    if (source === 'input') {
      throw new Error('voice_note has invalid fields.');
    }
    return null;
  }

  if (Number.isNaN(new Date(createdAt).getTime())) {
    if (source === 'input') {
      throw new Error('voice_note.createdAt must be a valid ISO datetime string.');
    }
    return null;
  }

  return {
    id,
    fileUri,
    fileName,
    durationMs,
    sizeBytes,
    createdAt,
  };
}

function parseStoredReviewRecordVoiceNote(
  value: string | null | undefined,
  reviewRecordId: string,
): ReviewRecordVoiceNote | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const normalized = normalizeReviewRecordVoiceNote(parsed, 'stored');
    if (!normalized) {
      Logger.warn(REPO_SCOPE, 'Stored review_record.voice_note is invalid. Fallback to null.', {
        reviewRecordId,
      });
      return null;
    }
    return normalized;
  } catch (error) {
    Logger.warn(REPO_SCOPE, 'Failed to parse review_record.voice_note JSON. Fallback to null.', {
      reviewRecordId,
      error,
    });
    return null;
  }
}

function serializeReviewRecordVoiceNote(value: ReviewRecordVoiceNote | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = normalizeReviewRecordVoiceNote(value, 'input');
  return normalized ? JSON.stringify(normalized) : null;
}

function mapReviewRecordRow(row: ReviewRecordRow): ReviewRecord {
  return {
    ...row,
    review_index: Number(row.review_index),
    result: normalizeStoredReviewResult(row.result),
    voice_note: parseStoredReviewRecordVoiceNote(row.voice_note, row.id),
  };
}

type ReviewRecordStatsRow = {
  total: number | null;
  mastered: number | null;
  unsure: number | null;
  wrong: number | null;
};

function normalizeRangeIso(value: string, fieldName: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    throw new Error(`${fieldName} must be a non-empty ISO datetime string.`);
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${fieldName} must be a valid datetime string.`);
  }

  return trimmed;
}

function normalizeLimit(value?: number): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isFinite(value)) {
    throw new Error('limit must be a finite number.');
  }

  const normalized = Math.floor(value);
  if (normalized < 0) {
    throw new Error('limit must be >= 0.');
  }
  return normalized;
}

function normalizeOffset(value?: number): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isFinite(value)) {
    throw new Error('offset must be a finite number.');
  }

  const normalized = Math.floor(value);
  if (normalized < 0) {
    throw new Error('offset must be >= 0.');
  }
  return normalized;
}

function buildReviewRecord(
  input: CreateReviewRecordInput & { id?: string; createdAt?: string },
): ReviewRecord {
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  const normalizedVoiceNote = normalizeReviewRecordVoiceNote(input.voice_note ?? null, 'input');
  return {
    id: input.id?.trim() || buildReviewRecordId(),
    mistake_id: input.mistake_id,
    review_index: normalizeReviewIndex(input.review_index),
    result: input.result,
    note: note.length > 0 ? note : null,
    voice_note: normalizedVoiceNote,
    created_at: input.createdAt ?? nowIso(),
  };
}

async function getReviewRecordByIdInternal(id: string): Promise<ReviewRecord | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<ReviewRecordRow>(
    `${SELECT_REVIEW_RECORD_FIELDS_SQL}
WHERE id = ?
LIMIT 1;`,
    id,
  );

  if (!row) {
    return null;
  }

  return mapReviewRecordRow(row);
}

export const ReviewRecordRepository = {
  async createReviewRecord(input: CreateReviewRecordInput): Promise<ReviewRecord> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const record = await ReviewRecordRepository.createReviewRecordInTransaction(db, input);

      const created = await getReviewRecordByIdInternal(record.id);
      if (!created) {
        throw new Error('Failed to load the created review record.');
      }

      return created;
    } catch (error) {
      Logger.error(REPO_SCOPE, 'createReviewRecord failed.', { input, error });
      throw error;
    }
  },

  async listReviewRecordsByMistakeId(mistakeId: string): Promise<ReviewRecord[]> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const rows = await db.getAllAsync<ReviewRecordRow>(
        `${SELECT_REVIEW_RECORD_FIELDS_SQL}
WHERE mistake_id = ?
ORDER BY review_index ASC, created_at ASC;`,
        mistakeId,
      );

      return rows.map(mapReviewRecordRow);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'listReviewRecordsByMistakeId failed.', { mistakeId, error });
      throw error;
    }
  },

  async getReviewRecordById(id: string): Promise<ReviewRecord | null> {
    try {
      await ensureDatabaseReady();
      const normalizedId = typeof id === 'string' ? id.trim() : '';
      if (!normalizedId) {
        return null;
      }

      const record = await getReviewRecordByIdInternal(normalizedId);
      return record;
    } catch (error) {
      Logger.error(REPO_SCOPE, 'getReviewRecordById failed.', { id, error });
      throw error;
    }
  },

  async getLatestReviewRecord(mistakeId: string): Promise<ReviewRecord | null> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const row = await db.getFirstAsync<ReviewRecordRow>(
        `${SELECT_REVIEW_RECORD_FIELDS_SQL}
WHERE mistake_id = ?
ORDER BY review_index DESC, created_at DESC
LIMIT 1;`,
        mistakeId,
      );

      if (!row) {
        return null;
      }

      return mapReviewRecordRow(row);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'getLatestReviewRecord failed.', { mistakeId, error });
      throw error;
    }
  },

  async listAllReviewRecords(options?: ListAllReviewRecordsOptions): Promise<ReviewRecord[]> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const limit = normalizeLimit(options?.limit);
      const offset = normalizeOffset(options?.offset);
      let paginationSql = '';
      const paginationParams: number[] = [];

      if (limit !== undefined) {
        paginationSql = '\nLIMIT ?';
        paginationParams.push(limit);
        if (offset !== undefined) {
          paginationSql += '\nOFFSET ?';
          paginationParams.push(offset);
        }
      } else if (offset !== undefined) {
        paginationSql = '\nLIMIT -1\nOFFSET ?';
        paginationParams.push(offset);
      }

      const rows = await db.getAllAsync<ReviewRecordRow>(
        `${SELECT_REVIEW_RECORD_FIELDS_SQL}
ORDER BY created_at ASC, id ASC${paginationSql};`,
        ...paginationParams,
      );

      return rows.map(mapReviewRecordRow);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'listAllReviewRecords failed.', { options, error });
      throw error;
    }
  },

  async listReviewRecordsByCreatedAtRange(
    startInclusiveIso: string,
    endInclusiveIso: string,
  ): Promise<ReviewRecord[]> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const normalizedStart = normalizeRangeIso(startInclusiveIso, 'startInclusiveIso');
      const normalizedEnd = normalizeRangeIso(endInclusiveIso, 'endInclusiveIso');
      const rows = await db.getAllAsync<ReviewRecordRow>(
        `${SELECT_REVIEW_RECORD_FIELDS_SQL}
WHERE created_at >= ?
  AND created_at <= ?
ORDER BY created_at ASC;`,
        normalizedStart,
        normalizedEnd,
      );
      return rows.map(mapReviewRecordRow);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'listReviewRecordsByCreatedAtRange failed.', {
        startInclusiveIso,
        endInclusiveIso,
        error,
      });
      throw error;
    }
  },

  async getReviewResultStatsByCreatedAtRange(
    startInclusiveIso: string,
    endInclusiveIso: string,
  ): Promise<ReviewRecordResultStats> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const normalizedStart = normalizeRangeIso(startInclusiveIso, 'startInclusiveIso');
      const normalizedEnd = normalizeRangeIso(endInclusiveIso, 'endInclusiveIso');
      const row = await db.getFirstAsync<ReviewRecordStatsRow>(
        `SELECT
  COUNT(*) AS total,
  SUM(CASE WHEN result = ? THEN 1 ELSE 0 END) AS mastered,
  SUM(CASE WHEN result = ? THEN 1 ELSE 0 END) AS unsure,
  SUM(CASE WHEN result = ? THEN 1 ELSE 0 END) AS wrong
FROM review_records
WHERE created_at >= ?
  AND created_at <= ?;`,
        'mastered' satisfies ReviewResult,
        'unsure' satisfies ReviewResult,
        'wrong' satisfies ReviewResult,
        normalizedStart,
        normalizedEnd,
      );

      return {
        total: Number(row?.total ?? 0),
        mastered: Number(row?.mastered ?? 0),
        unsure: Number(row?.unsure ?? 0),
        wrong: Number(row?.wrong ?? 0),
      };
    } catch (error) {
      Logger.error(REPO_SCOPE, 'getReviewResultStatsByCreatedAtRange failed.', {
        startInclusiveIso,
        endInclusiveIso,
        error,
      });
      throw error;
    }
  },

  async countReviewRecords(): Promise<number> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const row = await db.getFirstAsync<{ total: number | null }>(
        `SELECT COUNT(*) AS total
FROM review_records;`,
      );

      return Number(row?.total ?? 0);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'countReviewRecords failed.', error);
      throw error;
    }
  },

  async deleteReviewRecord(id: string): Promise<boolean> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const result = await db.runAsync('DELETE FROM review_records WHERE id = ?;', id);
      return result.changes > 0;
    } catch (error) {
      Logger.error(REPO_SCOPE, 'deleteReviewRecord failed.', { id, error });
      throw error;
    }
  },

  async deleteReviewRecordsByMistakeId(mistakeId: string): Promise<number> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const result = await db.runAsync('DELETE FROM review_records WHERE mistake_id = ?;', mistakeId);
      return result.changes;
    } catch (error) {
      Logger.error(REPO_SCOPE, 'deleteReviewRecordsByMistakeId failed.', { mistakeId, error });
      throw error;
    }
  },

  async createReviewRecordInTransaction(
    db: SQLite.SQLiteDatabase,
    input: CreateReviewRecordInput & { id?: string; createdAt?: string },
  ): Promise<ReviewRecord> {
    try {
      const record = buildReviewRecord(input);
      const voiceNoteJson = serializeReviewRecordVoiceNote(record.voice_note ?? null);
      await db.runAsync(
        INSERT_REVIEW_RECORD_SQL,
        record.id,
        record.mistake_id,
        record.review_index,
        record.result,
        record.note ?? null,
        voiceNoteJson,
        record.created_at,
      );

      return {
        ...record,
        result: normalizeStoredReviewResult(record.result),
      };
    } catch (error) {
      Logger.error(REPO_SCOPE, 'createReviewRecordInTransaction failed.', { input, error });
      throw error;
    }
  },

  async updateReviewRecordVoiceNoteInTransaction(
    db: SQLite.SQLiteDatabase,
    reviewRecordId: string,
    voiceNote: ReviewRecordVoiceNote | null,
  ): Promise<boolean> {
    try {
      const normalizedReviewRecordId = normalizeRequiredText(reviewRecordId, 'reviewRecordId');
      const voiceNoteJson = serializeReviewRecordVoiceNote(voiceNote);

      const result = await db.runAsync(
        `UPDATE review_records
SET voice_note = ?
WHERE id = ?;`,
        voiceNoteJson,
        normalizedReviewRecordId,
      );

      if (result.changes <= 0) {
        Logger.warn(REPO_SCOPE, 'updateReviewRecordVoiceNoteInTransaction skipped because review_record was not found.', {
          reviewRecordId: normalizedReviewRecordId,
        });
        return false;
      }

      return true;
    } catch (error) {
      Logger.error(REPO_SCOPE, 'updateReviewRecordVoiceNoteInTransaction failed.', {
        reviewRecordId,
        hasVoiceNote: voiceNote !== null,
        error,
      });
      throw error;
    }
  },
} as const;

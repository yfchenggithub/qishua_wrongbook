import { getDatabase, initDatabase } from '@/src/db';
import { MAX_REVIEW_COUNT } from '@/src/constants/review';
import type { ReviewResult } from '@/src/models/Mistake';
import type { CreateReviewRecordInput, ReviewRecord } from '@/src/models/ReviewRecord';
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
  created_at
) VALUES (?, ?, ?, ?, ?, ?);
`;

const SELECT_REVIEW_RECORD_FIELDS_SQL = `
SELECT
  id,
  mistake_id,
  review_index,
  result,
  note,
  created_at
FROM review_records
`;

export interface ReviewRecordResultStats {
  total: number;
  mastered: number;
  unsure: number;
  wrong: number;
}

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

function mapReviewRecordRow(row: ReviewRecord): ReviewRecord {
  return {
    ...row,
    review_index: Number(row.review_index),
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

function buildReviewRecord(
  input: CreateReviewRecordInput & { id?: string; createdAt?: string },
): ReviewRecord {
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  return {
    id: input.id?.trim() || buildReviewRecordId(),
    mistake_id: input.mistake_id,
    review_index: normalizeReviewIndex(input.review_index),
    result: input.result,
    note: note.length > 0 ? note : null,
    created_at: input.createdAt ?? nowIso(),
  };
}

async function getReviewRecordByIdInternal(id: string): Promise<ReviewRecord | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<ReviewRecord>(
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
      const rows = await db.getAllAsync<ReviewRecord>(
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

  async getLatestReviewRecord(mistakeId: string): Promise<ReviewRecord | null> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const row = await db.getFirstAsync<ReviewRecord>(
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

  async listReviewRecordsByCreatedAtRange(
    startInclusiveIso: string,
    endInclusiveIso: string,
  ): Promise<ReviewRecord[]> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const normalizedStart = normalizeRangeIso(startInclusiveIso, 'startInclusiveIso');
      const normalizedEnd = normalizeRangeIso(endInclusiveIso, 'endInclusiveIso');
      const rows = await db.getAllAsync<ReviewRecord>(
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
      await db.runAsync(
        INSERT_REVIEW_RECORD_SQL,
        record.id,
        record.mistake_id,
        record.review_index,
        record.result,
        record.note ?? null,
        record.created_at,
      );

      return mapReviewRecordRow(record);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'createReviewRecordInTransaction failed.', { input, error });
      throw error;
    }
  },
} as const;

import { getDatabase, initDatabase, withDatabaseTransaction } from '@/src/db';
import type { ReviewSheet, ReviewSheetItem, ReviewSheetWithItems } from '@/src/models/ReviewSheet';
import { Logger } from '@/src/services/Logger';
import { createRecordId } from '@/src/utils/id';
import type * as SQLite from 'expo-sqlite';

const REPO_SCOPE = 'ReviewSheetRepository';

type ReviewSheetRow = {
  id: string;
  created_at: string;
  submitted_at?: string | null;
  is_submitted: number;
};

type ReviewSheetItemRow = {
  id: string;
  sheet_id: string;
  mistake_id: string;
  sort_order: number;
  created_at: string;
};

let databaseReady = false;
let databaseInitPromise: Promise<void> | null = null;

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

function normalizeRequiredId(value: string, fieldName: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return normalized;
}

function normalizeMistakeIds(mistakeIds: string[]): string[] {
  if (!Array.isArray(mistakeIds)) {
    throw new Error('mistakeIds must be an array.');
  }

  const normalized = mistakeIds
    .map((id) => (typeof id === 'string' ? id.trim() : ''))
    .filter((id) => id.length > 0);

  if (normalized.length <= 0) {
    throw new Error('mistakeIds must contain at least one id.');
  }

  return normalized;
}

function mapSheetRow(row: ReviewSheetRow): ReviewSheet {
  return {
    id: row.id,
    created_at: row.created_at,
    submitted_at: row.submitted_at ?? null,
    is_submitted: Number(row.is_submitted) === 1 ? 1 : 0,
  };
}

function mapSheetItemRow(row: ReviewSheetItemRow): ReviewSheetItem {
  return {
    id: row.id,
    sheet_id: row.sheet_id,
    mistake_id: row.mistake_id,
    sort_order: Number(row.sort_order),
    created_at: row.created_at,
  };
}

async function getReviewSheetByIdInternal(
  db: SQLite.SQLiteDatabase,
  sheetId: string,
): Promise<ReviewSheet | null> {
  const row = await db.getFirstAsync<ReviewSheetRow>(
    `SELECT id, created_at, submitted_at, is_submitted
FROM review_sheets
WHERE id = ?
LIMIT 1;`,
    sheetId,
  );

  return row ? mapSheetRow(row) : null;
}

async function listReviewSheetItemsInternal(
  db: SQLite.SQLiteDatabase,
  sheetId: string,
): Promise<ReviewSheetItem[]> {
  const rows = await db.getAllAsync<ReviewSheetItemRow>(
    `SELECT id, sheet_id, mistake_id, sort_order, created_at
FROM review_sheet_items
WHERE sheet_id = ?
ORDER BY sort_order ASC, created_at ASC;`,
    sheetId,
  );

  return rows.map(mapSheetItemRow);
}

async function getReviewSheetWithItemsInternal(
  db: SQLite.SQLiteDatabase,
  sheetId: string,
): Promise<ReviewSheetWithItems | null> {
  const sheet = await getReviewSheetByIdInternal(db, sheetId);
  if (!sheet) {
    return null;
  }

  const items = await listReviewSheetItemsInternal(db, sheetId);
  return {
    ...sheet,
    items,
  };
}

export const ReviewSheetRepository = {
  async createReviewSheet(mistakeIds: string[]): Promise<ReviewSheetWithItems> {
    try {
      await ensureDatabaseReady();
      const normalizedMistakeIds = normalizeMistakeIds(mistakeIds);
      const created = await withDatabaseTransaction(async (db) =>
        ReviewSheetRepository.createReviewSheetInTransaction(db, normalizedMistakeIds),
      );

      const db = await getDatabase();
      const reloaded = await getReviewSheetWithItemsInternal(db, created.id);
      if (!reloaded) {
        throw new Error('Failed to reload created review sheet.');
      }
      return reloaded;
    } catch (error) {
      Logger.error(REPO_SCOPE, 'createReviewSheet failed.', { mistakeIds, error });
      throw error;
    }
  },

  async createReviewSheetInTransaction(
    db: SQLite.SQLiteDatabase,
    mistakeIds: string[],
  ): Promise<ReviewSheetWithItems> {
    try {
      const normalizedMistakeIds = normalizeMistakeIds(mistakeIds);
      const sheetId = createRecordId('RS');
      const createdAt = nowIso();

      await db.runAsync(
        `INSERT INTO review_sheets (id, created_at, submitted_at, is_submitted)
VALUES (?, ?, ?, ?);`,
        sheetId,
        createdAt,
        null,
        0,
      );

      const items: ReviewSheetItem[] = [];
      for (let index = 0; index < normalizedMistakeIds.length; index += 1) {
        const sortOrder = index;
        const item: ReviewSheetItem = {
          id: `${sheetId}_I${String(index + 1).padStart(3, '0')}`,
          sheet_id: sheetId,
          mistake_id: normalizedMistakeIds[index],
          sort_order: sortOrder,
          created_at: createdAt,
        };

        await db.runAsync(
          `INSERT INTO review_sheet_items (id, sheet_id, mistake_id, sort_order, created_at)
VALUES (?, ?, ?, ?, ?);`,
          item.id,
          item.sheet_id,
          item.mistake_id,
          item.sort_order,
          item.created_at,
        );
        items.push(item);
      }

      return {
        id: sheetId,
        created_at: createdAt,
        submitted_at: null,
        is_submitted: 0,
        items,
      };
    } catch (error) {
      Logger.error(REPO_SCOPE, 'createReviewSheetInTransaction failed.', { mistakeIds, error });
      throw error;
    }
  },

  async getReviewSheetWithItems(sheetId: string): Promise<ReviewSheetWithItems | null> {
    try {
      await ensureDatabaseReady();
      const normalizedSheetId = normalizeRequiredId(sheetId, 'sheetId');
      const db = await getDatabase();
      return await getReviewSheetWithItemsInternal(db, normalizedSheetId);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'getReviewSheetWithItems failed.', { sheetId, error });
      throw error;
    }
  },

  async markReviewSheetSubmitted(sheetId: string, submittedAt = nowIso()): Promise<boolean> {
    try {
      await ensureDatabaseReady();
      const normalizedSheetId = normalizeRequiredId(sheetId, 'sheetId');
      const db = await getDatabase();
      const result = await db.runAsync(
        `UPDATE review_sheets
SET is_submitted = 1,
    submitted_at = ?
WHERE id = ?
  AND is_submitted = 0;`,
        submittedAt,
        normalizedSheetId,
      );

      return result.changes > 0;
    } catch (error) {
      Logger.error(REPO_SCOPE, 'markReviewSheetSubmitted failed.', { sheetId, error });
      throw error;
    }
  },
} as const;

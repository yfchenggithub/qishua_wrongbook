import type * as SQLite from 'expo-sqlite';

import { initDatabase, withDatabaseTransaction } from '@/src/db';
import { Logger } from '@/src/services/Logger';

const REPO_SCOPE = 'MistakeDeletionRepository';
const ID_BATCH_SIZE = 200;

export interface DeletedMistakeRow {
  id: string;
  subject: string;
  module: string;
  module_id: number;
  question_no: number;
  title: string | null;
  error_reason: string | null;
  error_reason_ids: string | null;
  difficulty: number;
  note: string | null;
  my_solution_text: string | null;
  answer_text: string | null;
  note_highlights: string | null;
  review_count: number;
  status: string;
  created_at: string;
  updated_at: string;
  next_review_at: string | null;
  last_review_at: string | null;
  last_review_result: string | null;
  is_pinned: number;
  last_viewed_at: string | null;
}

export interface DeletedReviewRecordRow {
  id: string;
  mistake_id: string;
  review_index: number;
  result: string;
  note: string | null;
  note_highlights: string | null;
  voice_note: string | null;
  created_at: string;
}

export interface DeletedMistakeImageRow {
  id: string;
  mistake_id: string;
  review_record_id: string | null;
  type: string;
  uri: string;
  sort_order: number;
  created_at: string;
}

export interface DeletedReviewSheetItemRow {
  id: string;
  sheet_id: string;
  mistake_id: string;
  sort_order: number;
  created_at: string;
}

export interface DeletedMistakeRelationRow {
  id: string;
  source_mistake_id: string;
  target_mistake_id: string;
  source: string;
  created_at: string;
}

export interface DeletedMistakeTagRow {
  id: string;
  mistake_id: string;
  name: string;
  normalized_name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface DeletedModuleImportItemRow {
  import_id: string;
  item_id: string;
  mistake_id: string;
  position: number;
}

export interface MistakeDeletionSnapshot {
  requestedIds: string[];
  mistakes: DeletedMistakeRow[];
  reviewRecords: DeletedReviewRecordRow[];
  images: DeletedMistakeImageRow[];
  reviewSheetItems: DeletedReviewSheetItemRow[];
  relations: DeletedMistakeRelationRow[];
  tags: DeletedMistakeTagRow[];
  moduleImportItems: DeletedModuleImportItemRow[];
}

function normalizeIds(idsInput: string[]): string[] {
  const ids = new Set<string>();
  for (const value of idsInput) {
    const id = typeof value === 'string' ? value.trim() : '';
    if (id) {
      ids.add(id);
    }
  }
  return Array.from(ids);
}

function chunkIds(ids: string[]): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += ID_BATCH_SIZE) {
    chunks.push(ids.slice(index, index + ID_BATCH_SIZE));
  }
  return chunks;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

async function selectRowsByMistakeIds<T>(
  db: SQLite.SQLiteDatabase,
  tableName: string,
  mistakeIdColumn: string,
  ids: string[],
): Promise<T[]> {
  const rows: T[] = [];
  for (const batch of chunkIds(ids)) {
    rows.push(...await db.getAllAsync<T>(
      `SELECT * FROM ${tableName} WHERE ${mistakeIdColumn} IN (${placeholders(batch.length)});`,
      ...batch,
    ));
  }
  return rows;
}

async function selectRelations(
  db: SQLite.SQLiteDatabase,
  ids: string[],
): Promise<DeletedMistakeRelationRow[]> {
  const rowsById = new Map<string, DeletedMistakeRelationRow>();
  for (const batch of chunkIds(ids)) {
    const markerSql = placeholders(batch.length);
    const rows = await db.getAllAsync<DeletedMistakeRelationRow>(
      `SELECT * FROM mistake_relations
WHERE source_mistake_id IN (${markerSql}) OR target_mistake_id IN (${markerSql});`,
      ...batch,
      ...batch,
    );
    rows.forEach((row) => rowsById.set(row.id, row));
  }
  return Array.from(rowsById.values());
}

async function captureSnapshot(
  db: SQLite.SQLiteDatabase,
  ids: string[],
): Promise<MistakeDeletionSnapshot> {
  const mistakes = await selectRowsByMistakeIds<DeletedMistakeRow>(db, 'mistakes', 'id', ids);
  if (mistakes.length !== ids.length) {
    throw new Error('选中的题目已发生变化，请刷新后重试。');
  }

  const [reviewRecords, images, reviewSheetItems, relations, tags, moduleImportItems] = await Promise.all([
    selectRowsByMistakeIds<DeletedReviewRecordRow>(db, 'review_records', 'mistake_id', ids),
    selectRowsByMistakeIds<DeletedMistakeImageRow>(db, 'mistake_images', 'mistake_id', ids),
    selectRowsByMistakeIds<DeletedReviewSheetItemRow>(db, 'review_sheet_items', 'mistake_id', ids),
    selectRelations(db, ids),
    selectRowsByMistakeIds<DeletedMistakeTagRow>(db, 'mistake_tags', 'mistake_id', ids),
    selectRowsByMistakeIds<DeletedModuleImportItemRow>(db, 'module_import_items', 'mistake_id', ids),
  ]);

  return {
    requestedIds: ids,
    mistakes,
    reviewRecords,
    images,
    reviewSheetItems,
    relations,
    tags,
    moduleImportItems,
  };
}

async function deleteCapturedMistakes(
  db: SQLite.SQLiteDatabase,
  ids: string[],
): Promise<number> {
  let deletedCount = 0;
  for (const batch of chunkIds(ids)) {
    const result = await db.runAsync(
      `DELETE FROM mistakes WHERE id IN (${placeholders(batch.length)});`,
      ...batch,
    );
    deletedCount += result.changes;
  }
  return deletedCount;
}

async function restoreSnapshotRows(
  db: SQLite.SQLiteDatabase,
  snapshot: MistakeDeletionSnapshot,
): Promise<void> {
  for (const row of snapshot.mistakes) {
    await db.runAsync(
      `INSERT INTO mistakes (
  id, subject, module, module_id, question_no, title, error_reason, error_reason_ids,
  difficulty, note, my_solution_text, answer_text, note_highlights, review_count, status,
  created_at, updated_at, next_review_at, last_review_at, last_review_result, is_pinned,
  last_viewed_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      row.id,
      row.subject,
      row.module,
      row.module_id,
      row.question_no,
      row.title,
      row.error_reason,
      row.error_reason_ids,
      row.difficulty,
      row.note,
      row.my_solution_text,
      row.answer_text,
      row.note_highlights,
      row.review_count,
      row.status,
      row.created_at,
      row.updated_at,
      row.next_review_at,
      row.last_review_at,
      row.last_review_result,
      row.is_pinned,
      row.last_viewed_at,
    );
  }

  for (const row of snapshot.reviewRecords) {
    await db.runAsync(
      `INSERT INTO review_records (
  id, mistake_id, review_index, result, note, note_highlights, voice_note, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      row.id,
      row.mistake_id,
      row.review_index,
      row.result,
      row.note,
      row.note_highlights,
      row.voice_note,
      row.created_at,
    );
  }

  for (const row of snapshot.images) {
    await db.runAsync(
      `INSERT INTO mistake_images (
  id, mistake_id, review_record_id, type, uri, sort_order, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?);`,
      row.id,
      row.mistake_id,
      row.review_record_id,
      row.type,
      row.uri,
      row.sort_order,
      row.created_at,
    );
  }

  for (const row of snapshot.reviewSheetItems) {
    await db.runAsync(
      `INSERT INTO review_sheet_items (id, sheet_id, mistake_id, sort_order, created_at)
VALUES (?, ?, ?, ?, ?);`,
      row.id,
      row.sheet_id,
      row.mistake_id,
      row.sort_order,
      row.created_at,
    );
  }

  for (const row of snapshot.relations) {
    await db.runAsync(
      `INSERT INTO mistake_relations (
  id, source_mistake_id, target_mistake_id, source, created_at
) VALUES (?, ?, ?, ?, ?);`,
      row.id,
      row.source_mistake_id,
      row.target_mistake_id,
      row.source,
      row.created_at,
    );
  }

  for (const row of snapshot.tags) {
    await db.runAsync(
      `INSERT INTO mistake_tags (
  id, mistake_id, name, normalized_name, sort_order, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?);`,
      row.id,
      row.mistake_id,
      row.name,
      row.normalized_name,
      row.sort_order,
      row.created_at,
      row.updated_at,
    );
  }

  for (const row of snapshot.moduleImportItems) {
    await db.runAsync(
      `INSERT INTO module_import_items (import_id, item_id, mistake_id, position)
VALUES (?, ?, ?, ?);`,
      row.import_id,
      row.item_id,
      row.mistake_id,
      row.position,
    );
  }
}

export const MistakeDeletionRepository = {
  async deleteMistakesWithSnapshot(idsInput: string[]): Promise<MistakeDeletionSnapshot> {
    const ids = normalizeIds(idsInput);
    if (ids.length === 0) {
      throw new Error('请先选择要删除的题目。');
    }

    await initDatabase();
    try {
      return await withDatabaseTransaction(async (db) => {
        const snapshot = await captureSnapshot(db, ids);
        const deletedCount = await deleteCapturedMistakes(db, ids);
        if (deletedCount !== ids.length) {
          throw new Error('没有完整删除全部选中题目，操作已撤回。');
        }
        return snapshot;
      });
    } catch (error) {
      Logger.error(REPO_SCOPE, 'deleteMistakesWithSnapshot failed.', { ids, error });
      throw error;
    }
  },

  async restoreMistakesFromSnapshot(snapshot: MistakeDeletionSnapshot): Promise<number> {
    if (!snapshot || snapshot.mistakes.length === 0) {
      throw new Error('没有可恢复的题目。');
    }

    await initDatabase();
    try {
      return await withDatabaseTransaction(async (db) => {
        await restoreSnapshotRows(db, snapshot);
        return snapshot.mistakes.length;
      });
    } catch (error) {
      Logger.error(REPO_SCOPE, 'restoreMistakesFromSnapshot failed.', {
        ids: snapshot.requestedIds,
        error,
      });
      throw error;
    }
  },
} as const;

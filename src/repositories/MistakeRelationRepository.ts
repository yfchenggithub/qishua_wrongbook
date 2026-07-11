import { getDatabase, initDatabase } from '@/src/db';
import type {
  CreateMistakeRelationInput,
  MistakeRelation,
  MistakeRelationSource,
  MistakeRelationSummary,
} from '@/src/models/MistakeRelation';
import { Logger } from '@/src/services/Logger';
import type * as SQLite from 'expo-sqlite';

const REPO_SCOPE = 'MistakeRelationRepository';
const DEFAULT_LIST_LIMIT = 200;
const DEFAULT_LIST_OFFSET = 0;
const RELATION_SOURCE_VALUES: MistakeRelationSource[] = ['system', 'manual'];

export interface ListAllMistakeRelationsOptions {
  limit?: number;
  offset?: number;
}

type CountRow = {
  total: number | null;
};

type SummaryRow = {
  total: number | null;
  system: number | null;
  manual: number | null;
};

const SELECT_RELATION_FIELDS_SQL = `
SELECT
  id,
  source_mistake_id,
  target_mistake_id,
  source,
  created_at
FROM mistake_relations
`;

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

function buildRelationId(): string {
  const randomPart = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');
  return `REL${Date.now()}${randomPart}`;
}

function normalizeRequiredId(value: string, fieldName: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return normalized;
}

function normalizeSource(value: MistakeRelationSource): MistakeRelationSource {
  if (RELATION_SOURCE_VALUES.includes(value)) {
    return value;
  }
  throw new Error('source must be system or manual.');
}

function normalizeLimit(value?: number): number {
  if (value === undefined) {
    return DEFAULT_LIST_LIMIT;
  }
  const normalized = Math.floor(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new Error('limit must be a non-negative integer.');
  }
  return normalized;
}

function normalizeOffset(value?: number): number {
  if (value === undefined) {
    return DEFAULT_LIST_OFFSET;
  }
  const normalized = Math.floor(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new Error('offset must be a non-negative integer.');
  }
  return normalized;
}

function mapRelationRow(row: MistakeRelation): MistakeRelation {
  return {
    id: row.id,
    source_mistake_id: row.source_mistake_id,
    target_mistake_id: row.target_mistake_id,
    source: normalizeSource(row.source),
    created_at: row.created_at,
  };
}

async function getRelationBetweenInternal(
  db: SQLite.SQLiteDatabase,
  leftMistakeId: string,
  rightMistakeId: string,
): Promise<MistakeRelation | null> {
  const row = await db.getFirstAsync<MistakeRelation>(
    `${SELECT_RELATION_FIELDS_SQL}
WHERE (source_mistake_id = ? AND target_mistake_id = ?)
   OR (source_mistake_id = ? AND target_mistake_id = ?)
LIMIT 1;`,
    leftMistakeId,
    rightMistakeId,
    rightMistakeId,
    leftMistakeId,
  );

  return row ? mapRelationRow(row) : null;
}

export const MistakeRelationRepository = {
  async createRelation(input: CreateMistakeRelationInput): Promise<MistakeRelation> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const sourceMistakeId = normalizeRequiredId(input.sourceMistakeId, 'sourceMistakeId');
      const targetMistakeId = normalizeRequiredId(input.targetMistakeId, 'targetMistakeId');
      const source = normalizeSource(input.source);

      if (sourceMistakeId === targetMistakeId) {
        throw new Error('Cannot relate a mistake to itself.');
      }

      const existing = await getRelationBetweenInternal(db, sourceMistakeId, targetMistakeId);
      if (existing) {
        return existing;
      }

      const relation: MistakeRelation = {
        id: buildRelationId(),
        source_mistake_id: sourceMistakeId,
        target_mistake_id: targetMistakeId,
        source,
        created_at: nowIso(),
      };

      await db.runAsync(
        `INSERT INTO mistake_relations (
  id,
  source_mistake_id,
  target_mistake_id,
  source,
  created_at
) VALUES (?, ?, ?, ?, ?);`,
        relation.id,
        relation.source_mistake_id,
        relation.target_mistake_id,
        relation.source,
        relation.created_at,
      );

      return relation;
    } catch (error) {
      Logger.error(REPO_SCOPE, 'createRelation failed.', { input, error });
      throw error;
    }
  },

  async createRelationInTransaction(
    db: SQLite.SQLiteDatabase,
    relation: MistakeRelation,
  ): Promise<void> {
    try {
      const sourceMistakeId = normalizeRequiredId(relation.source_mistake_id, 'source_mistake_id');
      const targetMistakeId = normalizeRequiredId(relation.target_mistake_id, 'target_mistake_id');
      const source = normalizeSource(relation.source);
      const relationId = normalizeRequiredId(relation.id, 'id');
      const createdAt = normalizeRequiredId(relation.created_at, 'created_at');

      if (sourceMistakeId === targetMistakeId) {
        throw new Error('Cannot relate a mistake to itself.');
      }

      const existing = await getRelationBetweenInternal(db, sourceMistakeId, targetMistakeId);
      if (existing) {
        return;
      }

      await db.runAsync(
        `INSERT INTO mistake_relations (
  id,
  source_mistake_id,
  target_mistake_id,
  source,
  created_at
) VALUES (?, ?, ?, ?, ?);`,
        relationId,
        sourceMistakeId,
        targetMistakeId,
        source,
        createdAt,
      );
    } catch (error) {
      Logger.error(REPO_SCOPE, 'createRelationInTransaction failed.', { relation, error });
      throw error;
    }
  },

  async getRelationById(relationIdInput: string): Promise<MistakeRelation | null> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const relationId = normalizeRequiredId(relationIdInput, 'relationId');
      const row = await db.getFirstAsync<MistakeRelation>(
        `${SELECT_RELATION_FIELDS_SQL}
WHERE id = ?
LIMIT 1;`,
        relationId,
      );
      return row ? mapRelationRow(row) : null;
    } catch (error) {
      Logger.error(REPO_SCOPE, 'getRelationById failed.', { relationIdInput, error });
      throw error;
    }
  },

  async getRelationBetween(
    leftMistakeIdInput: string,
    rightMistakeIdInput: string,
  ): Promise<MistakeRelation | null> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const leftMistakeId = normalizeRequiredId(leftMistakeIdInput, 'leftMistakeId');
      const rightMistakeId = normalizeRequiredId(rightMistakeIdInput, 'rightMistakeId');
      if (leftMistakeId === rightMistakeId) {
        return null;
      }
      return await getRelationBetweenInternal(db, leftMistakeId, rightMistakeId);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'getRelationBetween failed.', {
        leftMistakeIdInput,
        rightMistakeIdInput,
        error,
      });
      throw error;
    }
  },

  async listRelationsByMistakeId(mistakeIdInput: string): Promise<MistakeRelation[]> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const mistakeId = normalizeRequiredId(mistakeIdInput, 'mistakeId');
      const rows = await db.getAllAsync<MistakeRelation>(
        `${SELECT_RELATION_FIELDS_SQL}
WHERE source_mistake_id = ? OR target_mistake_id = ?
ORDER BY created_at DESC;`,
        mistakeId,
        mistakeId,
      );
      return rows.map(mapRelationRow);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'listRelationsByMistakeId failed.', { mistakeIdInput, error });
      throw error;
    }
  },

  async getRelationSummaryByMistakeId(mistakeIdInput: string): Promise<MistakeRelationSummary> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const mistakeId = normalizeRequiredId(mistakeIdInput, 'mistakeId');
      const row = await db.getFirstAsync<SummaryRow>(
        `SELECT
  COUNT(*) AS total,
  SUM(CASE WHEN source = 'system' THEN 1 ELSE 0 END) AS system,
  SUM(CASE WHEN source = 'manual' THEN 1 ELSE 0 END) AS manual
FROM mistake_relations
WHERE source_mistake_id = ? OR target_mistake_id = ?;`,
        mistakeId,
        mistakeId,
      );

      return {
        total: Number(row?.total ?? 0),
        system: Number(row?.system ?? 0),
        manual: Number(row?.manual ?? 0),
      };
    } catch (error) {
      Logger.error(REPO_SCOPE, 'getRelationSummaryByMistakeId failed.', { mistakeIdInput, error });
      throw error;
    }
  },

  async deleteRelation(relationIdInput: string): Promise<boolean> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const relationId = normalizeRequiredId(relationIdInput, 'relationId');
      const result = await db.runAsync('DELETE FROM mistake_relations WHERE id = ?;', relationId);
      return result.changes > 0;
    } catch (error) {
      Logger.error(REPO_SCOPE, 'deleteRelation failed.', { relationIdInput, error });
      throw error;
    }
  },

  async countRelations(): Promise<number> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const row = await db.getFirstAsync<CountRow>(
        'SELECT COUNT(*) AS total FROM mistake_relations;',
      );
      return Number(row?.total ?? 0);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'countRelations failed.', error);
      throw error;
    }
  },

  async listAllRelations(options?: ListAllMistakeRelationsOptions): Promise<MistakeRelation[]> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const limit = normalizeLimit(options?.limit);
      const offset = normalizeOffset(options?.offset);
      const rows = await db.getAllAsync<MistakeRelation>(
        `${SELECT_RELATION_FIELDS_SQL}
ORDER BY created_at ASC
LIMIT ?
OFFSET ?;`,
        limit,
        offset,
      );
      return rows.map(mapRelationRow);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'listAllRelations failed.', { options, error });
      throw error;
    }
  },
} as const;

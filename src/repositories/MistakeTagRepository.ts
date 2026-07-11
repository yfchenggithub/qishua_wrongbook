import { getDatabase, initDatabase } from '@/src/db';
import type { CreateMistakeTagInput, MistakeTag } from '@/src/models/MistakeTag';
import { Logger } from '@/src/services/Logger';

const REPO_SCOPE = 'MistakeTagRepository';
const DEFAULT_LIST_LIMIT = 500;
const DEFAULT_LIST_OFFSET = 0;
const DEFAULT_RECENT_TAG_LIMIT = 24;

type MaxSortOrderRow = {
  max_sort_order: number | null;
};

type CountRow = {
  total: number | null;
};

type RecentTagNameRow = {
  name: string;
  normalized_name: string;
  latest_updated_at: string | null;
};

let databaseReady = false;
let databaseInitPromise: Promise<void> | null = null;

const SELECT_TAG_FIELDS_SQL = `
SELECT
  id,
  mistake_id,
  name,
  normalized_name,
  sort_order,
  created_at,
  updated_at
FROM mistake_tags
`;

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

function buildTagId(): string {
  const randomPart = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');
  return `TAG${Date.now()}${randomPart}`;
}

function normalizeRequiredText(value: string, fieldName: string): string {
  const normalized = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!normalized) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return normalized;
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

function normalizeRecentLimit(value?: number): number {
  if (value === undefined) {
    return DEFAULT_RECENT_TAG_LIMIT;
  }
  const normalized = Math.floor(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return DEFAULT_RECENT_TAG_LIMIT;
  }
  return normalized;
}

function mapTagRow(row: MistakeTag): MistakeTag {
  return {
    ...row,
    sort_order: Number(row.sort_order),
  };
}

async function getTagByMistakeAndNormalizedName(
  mistakeId: string,
  normalizedName: string,
): Promise<MistakeTag | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<MistakeTag>(
    `${SELECT_TAG_FIELDS_SQL}
WHERE mistake_id = ? AND normalized_name = ?
LIMIT 1;`,
    mistakeId,
    normalizedName,
  );
  return row ? mapTagRow(row) : null;
}

export const MistakeTagRepository = {
  async createTag(input: CreateMistakeTagInput): Promise<MistakeTag> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const mistakeId = normalizeRequiredText(input.mistakeId, 'mistakeId');
      const name = normalizeRequiredText(input.name, 'name');
      const normalizedName = normalizeRequiredText(input.normalizedName, 'normalizedName');

      const existing = await getTagByMistakeAndNormalizedName(mistakeId, normalizedName);
      if (existing) {
        return existing;
      }

      const orderRow = await db.getFirstAsync<MaxSortOrderRow>(
        `SELECT MAX(sort_order) AS max_sort_order
FROM mistake_tags
WHERE mistake_id = ?;`,
        mistakeId,
      );
      const nextSortOrder = Number(orderRow?.max_sort_order ?? -1) + 1;
      const createdAt = nowIso();
      const tag: MistakeTag = {
        id: buildTagId(),
        mistake_id: mistakeId,
        name,
        normalized_name: normalizedName,
        sort_order: nextSortOrder,
        created_at: createdAt,
        updated_at: createdAt,
      };

      await db.runAsync(
        `INSERT INTO mistake_tags (
  id,
  mistake_id,
  name,
  normalized_name,
  sort_order,
  created_at,
  updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?);`,
        tag.id,
        tag.mistake_id,
        tag.name,
        tag.normalized_name,
        tag.sort_order,
        tag.created_at,
        tag.updated_at,
      );

      return tag;
    } catch (error) {
      Logger.error(REPO_SCOPE, 'createTag failed.', { input, error });
      throw error;
    }
  },

  async listTagsByMistakeId(mistakeIdInput: string): Promise<MistakeTag[]> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const mistakeId = normalizeRequiredText(mistakeIdInput, 'mistakeId');
      const rows = await db.getAllAsync<MistakeTag>(
        `${SELECT_TAG_FIELDS_SQL}
WHERE mistake_id = ?
ORDER BY sort_order ASC, created_at ASC;`,
        mistakeId,
      );
      return rows.map(mapTagRow);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'listTagsByMistakeId failed.', { mistakeIdInput, error });
      throw error;
    }
  },

  async listTagsByMistakeIds(mistakeIdsInput: string[]): Promise<Map<string, MistakeTag[]>> {
    try {
      await ensureDatabaseReady();
      const normalizedIds = Array.from(
        new Set(
          mistakeIdsInput
            .map((id) => (typeof id === 'string' ? id.trim() : ''))
            .filter((id) => id.length > 0),
        ),
      );
      const result = new Map<string, MistakeTag[]>();
      for (const id of normalizedIds) {
        result.set(id, []);
      }
      if (normalizedIds.length <= 0) {
        return result;
      }

      const db = await getDatabase();
      const placeholders = normalizedIds.map(() => '?').join(', ');
      const rows = await db.getAllAsync<MistakeTag>(
        `${SELECT_TAG_FIELDS_SQL}
WHERE mistake_id IN (${placeholders})
ORDER BY mistake_id ASC, sort_order ASC, created_at ASC;`,
        ...normalizedIds,
      );

      for (const row of rows.map(mapTagRow)) {
        const list = result.get(row.mistake_id) ?? [];
        list.push(row);
        result.set(row.mistake_id, list);
      }
      return result;
    } catch (error) {
      Logger.error(REPO_SCOPE, 'listTagsByMistakeIds failed.', {
        count: mistakeIdsInput.length,
        error,
      });
      throw error;
    }
  },

  async listRecentTagNames(limitInput?: number): Promise<RecentTagNameRow[]> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const limit = normalizeRecentLimit(limitInput);
      return await db.getAllAsync<RecentTagNameRow>(
        `SELECT
  name,
  normalized_name,
  MAX(updated_at) AS latest_updated_at
FROM mistake_tags
GROUP BY normalized_name
ORDER BY latest_updated_at DESC, name ASC
LIMIT ?;`,
        limit,
      );
    } catch (error) {
      Logger.error(REPO_SCOPE, 'listRecentTagNames failed.', { limitInput, error });
      throw error;
    }
  },

  async countTagsByMistakeId(mistakeIdInput: string): Promise<number> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const mistakeId = normalizeRequiredText(mistakeIdInput, 'mistakeId');
      const row = await db.getFirstAsync<CountRow>(
        `SELECT COUNT(*) AS total
FROM mistake_tags
WHERE mistake_id = ?;`,
        mistakeId,
      );
      return Number(row?.total ?? 0);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'countTagsByMistakeId failed.', { mistakeIdInput, error });
      throw error;
    }
  },

  async deleteTagForMistake(mistakeIdInput: string, tagIdInput: string): Promise<boolean> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const mistakeId = normalizeRequiredText(mistakeIdInput, 'mistakeId');
      const tagId = normalizeRequiredText(tagIdInput, 'tagId');
      const result = await db.runAsync(
        `DELETE FROM mistake_tags
WHERE id = ? AND mistake_id = ?;`,
        tagId,
        mistakeId,
      );
      return result.changes > 0;
    } catch (error) {
      Logger.error(REPO_SCOPE, 'deleteTagForMistake failed.', {
        mistakeIdInput,
        tagIdInput,
        error,
      });
      throw error;
    }
  },

  async listAllTags(options?: { limit?: number; offset?: number }): Promise<MistakeTag[]> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const limit = normalizeLimit(options?.limit);
      const offset = normalizeOffset(options?.offset);
      const rows = await db.getAllAsync<MistakeTag>(
        `${SELECT_TAG_FIELDS_SQL}
ORDER BY created_at ASC
LIMIT ?
OFFSET ?;`,
        limit,
        offset,
      );
      return rows.map(mapTagRow);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'listAllTags failed.', { options, error });
      throw error;
    }
  },
} as const;

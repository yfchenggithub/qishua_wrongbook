import { getDatabase, initDatabase, withDatabaseTransaction } from '@/src/db';
import type {
  CreateCustomErrorReasonInput,
  CustomErrorReason,
  UpdateCustomErrorReasonInput,
} from '@/src/models/CustomErrorReason';
import { Logger } from '@/src/services/Logger';
import { createRecordId } from '@/src/utils/id';

const REPO_SCOPE = 'CustomErrorReasonRepository';
const DEFAULT_ICON = 'error-outline';
const DEFAULT_COLOR = '#F59E0B';

type CountRow = {
  total: number | null;
};

type MaxSortOrderRow = {
  max_sort_order: number | null;
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

function normalizeRequiredName(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    throw new Error('错因名称不能为空。');
  }
  return normalized;
}

function normalizeOptionalText(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}

function mapCustomErrorReasonRow(row: CustomErrorReason): CustomErrorReason {
  return {
    ...row,
    sort_order: Number(row.sort_order),
  };
}

export const CustomErrorReasonRepository = {
  async listCustomErrorReasons(): Promise<CustomErrorReason[]> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const rows = await db.getAllAsync<CustomErrorReason>(
        `SELECT id, name, icon, color, sort_order, created_at, updated_at
FROM custom_error_reasons
ORDER BY sort_order ASC, created_at ASC;`,
      );
      return rows.map(mapCustomErrorReasonRow);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'listCustomErrorReasons failed.', error);
      throw error;
    }
  },

  async countCustomErrorReasons(): Promise<number> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const row = await db.getFirstAsync<CountRow>(
        'SELECT COUNT(*) AS total FROM custom_error_reasons;',
      );
      return Number(row?.total ?? 0);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'countCustomErrorReasons failed.', error);
      throw error;
    }
  },

  async findCustomErrorReasonByName(name: string): Promise<CustomErrorReason | null> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const normalizedName = normalizeRequiredName(name);
      const row = await db.getFirstAsync<CustomErrorReason>(
        `SELECT id, name, icon, color, sort_order, created_at, updated_at
FROM custom_error_reasons
WHERE name = ?
LIMIT 1;`,
        normalizedName,
      );
      return row ? mapCustomErrorReasonRow(row) : null;
    } catch (error) {
      Logger.error(REPO_SCOPE, 'findCustomErrorReasonByName failed.', { name, error });
      throw error;
    }
  },

  async createCustomErrorReason(input: CreateCustomErrorReasonInput): Promise<CustomErrorReason> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const now = nowIso();
      const maxSortOrderRow = await db.getFirstAsync<MaxSortOrderRow>(
        'SELECT MAX(sort_order) AS max_sort_order FROM custom_error_reasons;',
      );
      const nextSortOrder = Number(maxSortOrderRow?.max_sort_order ?? -1) + 1;
      const id = input.id?.trim() || createRecordId('CER');
      const name = normalizeRequiredName(input.name);

      await db.runAsync(
        `INSERT INTO custom_error_reasons (
  id,
  name,
  icon,
  color,
  sort_order,
  created_at,
  updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?);`,
        id,
        name,
        normalizeOptionalText(input.icon, DEFAULT_ICON),
        normalizeOptionalText(input.color, DEFAULT_COLOR),
        nextSortOrder,
        now,
        now,
      );

      const created = await CustomErrorReasonRepository.findCustomErrorReasonByName(name);
      if (!created) {
        throw new Error('自定义错因创建后读取失败。');
      }
      return created;
    } catch (error) {
      Logger.error(REPO_SCOPE, 'createCustomErrorReason failed.', { input, error });
      throw error;
    }
  },

  async updateCustomErrorReason(
    id: string,
    input: UpdateCustomErrorReasonInput,
  ): Promise<CustomErrorReason | null> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const setClauses: string[] = [];
      const bindParams: string[] = [];

      if (input.name !== undefined) {
        setClauses.push('name = ?');
        bindParams.push(normalizeRequiredName(input.name));
      }
      if (input.icon !== undefined) {
        setClauses.push('icon = ?');
        bindParams.push(normalizeOptionalText(input.icon, DEFAULT_ICON));
      }
      if (input.color !== undefined) {
        setClauses.push('color = ?');
        bindParams.push(normalizeOptionalText(input.color, DEFAULT_COLOR));
      }

      if (setClauses.length === 0) {
        return null;
      }

      setClauses.push('updated_at = ?');
      bindParams.push(nowIso(), id);

      const result = await db.runAsync(
        `UPDATE custom_error_reasons
SET ${setClauses.join(', ')}
WHERE id = ?;`,
        ...bindParams,
      );

      if (result.changes <= 0) {
        return null;
      }

      const rows = await db.getAllAsync<CustomErrorReason>(
        `SELECT id, name, icon, color, sort_order, created_at, updated_at
FROM custom_error_reasons
WHERE id = ?
LIMIT 1;`,
        id,
      );
      return rows[0] ? mapCustomErrorReasonRow(rows[0]) : null;
    } catch (error) {
      Logger.error(REPO_SCOPE, 'updateCustomErrorReason failed.', { id, input, error });
      throw error;
    }
  },

  async deleteCustomErrorReason(id: string): Promise<boolean> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const result = await db.runAsync('DELETE FROM custom_error_reasons WHERE id = ?;', id);
      return result.changes > 0;
    } catch (error) {
      Logger.error(REPO_SCOPE, 'deleteCustomErrorReason failed.', { id, error });
      throw error;
    }
  },

  async replaceCustomErrorReasonOrder(orderedIds: string[]): Promise<void> {
    try {
      await ensureDatabaseReady();
      await withDatabaseTransaction(async (db) => {
        const now = nowIso();
        for (let index = 0; index < orderedIds.length; index += 1) {
          await db.runAsync(
            `UPDATE custom_error_reasons
SET sort_order = ?, updated_at = ?
WHERE id = ?;`,
            index,
            now,
            orderedIds[index],
          );
        }
      });
    } catch (error) {
      Logger.error(REPO_SCOPE, 'replaceCustomErrorReasonOrder failed.', { orderedIds, error });
      throw error;
    }
  },
} as const;

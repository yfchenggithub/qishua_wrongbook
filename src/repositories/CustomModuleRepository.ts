import { getDatabase, initDatabase, withDatabaseTransaction } from '@/src/db';
import type {
  CreateCustomModuleInput,
  CustomModule,
  UpdateCustomModuleInput,
} from '@/src/models/CustomModule';
import { Logger } from '@/src/services/Logger';
import { createRecordId } from '@/src/utils/id';

const REPO_SCOPE = 'CustomModuleRepository';
const DEFAULT_ICON = 'label';
const DEFAULT_COLOR = '#2EBB61';

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
    throw new Error('模块名称不能为空。');
  }
  return normalized;
}

function normalizeOptionalText(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}

function mapCustomModuleRow(row: CustomModule): CustomModule {
  return {
    ...row,
    sort_order: Number(row.sort_order),
  };
}

export const CustomModuleRepository = {
  async listCustomModules(): Promise<CustomModule[]> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const rows = await db.getAllAsync<CustomModule>(
        `SELECT id, name, icon, color, sort_order, created_at, updated_at
FROM custom_modules
ORDER BY sort_order ASC, created_at ASC;`,
      );
      return rows.map(mapCustomModuleRow);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'listCustomModules failed.', error);
      throw error;
    }
  },

  async countCustomModules(): Promise<number> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const row = await db.getFirstAsync<CountRow>(
        'SELECT COUNT(*) AS total FROM custom_modules;',
      );
      return Number(row?.total ?? 0);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'countCustomModules failed.', error);
      throw error;
    }
  },

  async findCustomModuleByName(name: string): Promise<CustomModule | null> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const normalizedName = normalizeRequiredName(name);
      const row = await db.getFirstAsync<CustomModule>(
        `SELECT id, name, icon, color, sort_order, created_at, updated_at
FROM custom_modules
WHERE name = ?
LIMIT 1;`,
        normalizedName,
      );
      return row ? mapCustomModuleRow(row) : null;
    } catch (error) {
      Logger.error(REPO_SCOPE, 'findCustomModuleByName failed.', { name, error });
      throw error;
    }
  },

  async createCustomModule(input: CreateCustomModuleInput): Promise<CustomModule> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const now = nowIso();
      const maxSortOrderRow = await db.getFirstAsync<MaxSortOrderRow>(
        'SELECT MAX(sort_order) AS max_sort_order FROM custom_modules;',
      );
      const nextSortOrder = Number(maxSortOrderRow?.max_sort_order ?? -1) + 1;
      const id = input.id?.trim() || createRecordId('CM');
      const name = normalizeRequiredName(input.name);

      await db.runAsync(
        `INSERT INTO custom_modules (
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

      const created = await CustomModuleRepository.findCustomModuleByName(name);
      if (!created) {
        throw new Error('自定义模块创建后读取失败。');
      }
      return created;
    } catch (error) {
      Logger.error(REPO_SCOPE, 'createCustomModule failed.', { input, error });
      throw error;
    }
  },

  async updateCustomModule(
    id: string,
    input: UpdateCustomModuleInput,
  ): Promise<CustomModule | null> {
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
        `UPDATE custom_modules
SET ${setClauses.join(', ')}
WHERE id = ?;`,
        ...bindParams,
      );

      if (result.changes <= 0) {
        return null;
      }

      const rows = await db.getAllAsync<CustomModule>(
        `SELECT id, name, icon, color, sort_order, created_at, updated_at
FROM custom_modules
WHERE id = ?
LIMIT 1;`,
        id,
      );
      return rows[0] ? mapCustomModuleRow(rows[0]) : null;
    } catch (error) {
      Logger.error(REPO_SCOPE, 'updateCustomModule failed.', { id, input, error });
      throw error;
    }
  },

  async deleteCustomModule(id: string): Promise<boolean> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const result = await db.runAsync('DELETE FROM custom_modules WHERE id = ?;', id);
      return result.changes > 0;
    } catch (error) {
      Logger.error(REPO_SCOPE, 'deleteCustomModule failed.', { id, error });
      throw error;
    }
  },

  async replaceCustomModuleOrder(orderedIds: string[]): Promise<void> {
    try {
      await ensureDatabaseReady();
      await withDatabaseTransaction(async (db) => {
        const now = nowIso();
        for (let index = 0; index < orderedIds.length; index += 1) {
          await db.runAsync(
            `UPDATE custom_modules
SET sort_order = ?, updated_at = ?
WHERE id = ?;`,
            index,
            now,
            orderedIds[index],
          );
        }
      });
    } catch (error) {
      Logger.error(REPO_SCOPE, 'replaceCustomModuleOrder failed.', { orderedIds, error });
      throw error;
    }
  },
} as const;

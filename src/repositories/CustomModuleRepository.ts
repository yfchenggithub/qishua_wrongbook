import type * as SQLite from 'expo-sqlite';

import {
  CUSTOM_MODULE_ID_START,
  CUSTOM_MODULE_MAX_NUMBER,
  CUSTOM_MODULE_NEW_NUMBER_FLOOR,
  formatCustomModuleDisplayCode,
} from '@/src/constants/modules';
import { getDatabase, initDatabase, withDatabaseTransaction } from '@/src/db';
import type {
  CreateCustomModuleInput,
  CustomModule,
  UpdateCustomModuleInput,
} from '@/src/models/CustomModule';
import { Logger } from '@/src/services/Logger';
import { BRAND_ACCENT } from '@/src/styles/tokens';

const REPO_SCOPE = 'CustomModuleRepository';
const DEFAULT_ICON = 'label';
const DEFAULT_COLOR = BRAND_ACCENT;
const MAX_MODULE_NAME_LENGTH = 16;
const MAX_IMPORTED_NAME_ATTEMPTS = 999;
const CUSTOM_MODULE_SELECT_SQL = `
SELECT
  id, name, display_code, custom_no, icon, color,
  sort_order, is_active, created_at, updated_at
FROM modules
WHERE type = 'custom'
`;

type CountRow = {
  total: number | null;
};

type CustomModuleAllocationRow = {
  max_id: number | null;
  max_custom_no: number | null;
  max_sort_order: number | null;
};

type CustomModuleDatabaseRow = Omit<CustomModule, 'is_active'> & {
  is_active: number;
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

function mapCustomModuleRow(row: CustomModuleDatabaseRow): CustomModule {
  return {
    ...row,
    id: Number(row.id),
    custom_no: Number(row.custom_no),
    sort_order: Number(row.sort_order),
    is_active: row.is_active === 1,
  };
}

async function findCustomModuleByNameInternal(
  db: SQLite.SQLiteDatabase,
  name: string,
  includeInactive = false,
): Promise<CustomModule | null> {
  const row = await db.getFirstAsync<CustomModuleDatabaseRow>(
    `${CUSTOM_MODULE_SELECT_SQL}
  AND name = ?
  ${includeInactive ? '' : 'AND is_active = 1'}
LIMIT 1;`,
    normalizeRequiredName(name),
  );
  return row ? mapCustomModuleRow(row) : null;
}

async function findCustomModuleByIdInternal(
  db: SQLite.SQLiteDatabase,
  id: number,
): Promise<CustomModule | null> {
  const row = await db.getFirstAsync<CustomModuleDatabaseRow>(
    `${CUSTOM_MODULE_SELECT_SQL}
  AND id = ?
LIMIT 1;`,
    id,
  );
  return row ? mapCustomModuleRow(row) : null;
}

async function moduleNameExistsInternal(
  db: SQLite.SQLiteDatabase,
  name: string,
): Promise<boolean> {
  const row = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM modules WHERE name = ? COLLATE NOCASE LIMIT 1;',
    name,
  );
  return Boolean(row);
}

function truncateWithoutSplittingSurrogatePair(value: string, maxLength: number): string {
  const truncated = value.slice(0, maxLength);
  return /[\uD800-\uDBFF]$/.test(truncated) ? truncated.slice(0, -1) : truncated;
}

function buildImportedModuleNameCandidate(sourceName: string, attempt: number): string {
  if (attempt === 0) {
    return truncateWithoutSplittingSurrogatePair(sourceName, MAX_MODULE_NAME_LENGTH);
  }
  const suffix = attempt === 1 ? '（导入）' : `（导入 ${attempt}）`;
  const baseLength = Math.max(1, MAX_MODULE_NAME_LENGTH - suffix.length);
  return `${truncateWithoutSplittingSurrogatePair(sourceName, baseLength)}${suffix}`;
}

async function resolveImportedModuleName(
  db: SQLite.SQLiteDatabase,
  sourceNameInput: string,
): Promise<string> {
  const sourceName = normalizeRequiredName(sourceNameInput);
  for (let attempt = 0; attempt < MAX_IMPORTED_NAME_ATTEMPTS; attempt += 1) {
    const candidate = buildImportedModuleNameCandidate(sourceName, attempt);
    if (!(await moduleNameExistsInternal(db, candidate))) {
      return candidate;
    }
  }
  throw new Error('无法为导入题包分配可用的模块名称。');
}

async function createNewCustomModuleInTransaction(
  db: SQLite.SQLiteDatabase,
  input: CreateCustomModuleInput,
  name: string,
): Promise<CustomModule> {
  const allocation = await db.getFirstAsync<CustomModuleAllocationRow>(
    `SELECT
  MAX(id) AS max_id,
  MAX(custom_no) AS max_custom_no,
  MAX(sort_order) AS max_sort_order
FROM modules
WHERE type = 'custom';`,
  );
  const nextId = Math.max(
    CUSTOM_MODULE_ID_START,
    Math.floor(Number(allocation?.max_id ?? CUSTOM_MODULE_ID_START - 1)) + 1,
  );
  const nextCustomNo = Math.max(
    CUSTOM_MODULE_NEW_NUMBER_FLOOR,
    Math.floor(Number(allocation?.max_custom_no ?? 0)) + 1,
  );
  if (nextCustomNo > CUSTOM_MODULE_MAX_NUMBER) {
    throw new Error(`自定义模块编号已达到 U${CUSTOM_MODULE_MAX_NUMBER}。`);
  }
  const nextSortOrder = Math.floor(Number(allocation?.max_sort_order ?? -1)) + 1;
  const now = nowIso();
  await db.runAsync(
    `INSERT INTO modules (
  id, type, name, display_code, custom_no, icon, color,
  sort_order, is_active, created_at, updated_at
) VALUES (?, 'custom', ?, ?, ?, ?, ?, ?, 1, ?, ?);`,
    nextId,
    name,
    formatCustomModuleDisplayCode(nextCustomNo),
    nextCustomNo,
    normalizeOptionalText(input.icon, DEFAULT_ICON),
    normalizeOptionalText(input.color, DEFAULT_COLOR),
    nextSortOrder,
    now,
    now,
  );
  const created = await findCustomModuleByIdInternal(db, nextId);
  if (!created) {
    throw new Error('自定义模块创建后读取失败。');
  }
  return created;
}

export const CustomModuleRepository = {
  async listCustomModules(): Promise<CustomModule[]> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const rows = await db.getAllAsync<CustomModuleDatabaseRow>(
        `${CUSTOM_MODULE_SELECT_SQL}
  AND is_active = 1
ORDER BY sort_order ASC, created_at ASC, id ASC;`,
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
        "SELECT COUNT(*) AS total FROM modules WHERE type = 'custom' AND is_active = 1;",
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
      return await findCustomModuleByNameInternal(await getDatabase(), name);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'findCustomModuleByName failed.', { name, error });
      throw error;
    }
  },

  async createCustomModule(input: CreateCustomModuleInput): Promise<CustomModule> {
    try {
      await ensureDatabaseReady();
      const name = normalizeRequiredName(input.name);
      return await withDatabaseTransaction(async (db) => {
        const existing = await findCustomModuleByNameInternal(db, name, true);
        if (existing) {
          if (existing.is_active) {
            throw new Error('该模块已存在。');
          }
          const now = nowIso();
          await db.runAsync(
            'UPDATE modules SET is_active = 1, updated_at = ? WHERE id = ?;',
            now,
            existing.id,
          );
          const reactivated = await findCustomModuleByIdInternal(db, existing.id);
          if (!reactivated) {
            throw new Error('自定义模块恢复后读取失败。');
          }
          return reactivated;
        }

        return createNewCustomModuleInTransaction(db, input, name);
      });
    } catch (error) {
      Logger.error(REPO_SCOPE, 'createCustomModule failed.', { input, error });
      throw error;
    }
  },

  async createImportedCustomModuleInTransaction(
    db: SQLite.SQLiteDatabase,
    input: CreateCustomModuleInput,
  ): Promise<CustomModule> {
    try {
      const name = await resolveImportedModuleName(db, input.name);
      return await createNewCustomModuleInTransaction(db, input, name);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'createImportedCustomModuleInTransaction failed.', {
        input,
        error,
      });
      throw error;
    }
  },

  async updateCustomModule(
    id: number,
    input: UpdateCustomModuleInput,
  ): Promise<CustomModule | null> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const setClauses: string[] = [];
      const bindParams: (string | number)[] = [];
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
        return findCustomModuleByIdInternal(db, id);
      }
      setClauses.push('updated_at = ?');
      bindParams.push(nowIso(), id);
      const result = await db.runAsync(
        `UPDATE modules
SET ${setClauses.join(', ')}
WHERE id = ? AND type = 'custom';`,
        ...bindParams,
      );
      return result.changes > 0 ? findCustomModuleByIdInternal(db, id) : null;
    } catch (error) {
      Logger.error(REPO_SCOPE, 'updateCustomModule failed.', { id, input, error });
      throw error;
    }
  },

  async deleteCustomModule(id: number): Promise<boolean> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const result = await db.runAsync(
        `UPDATE modules
SET is_active = 0, updated_at = ?
WHERE id = ? AND type = 'custom' AND is_active = 1;`,
        nowIso(),
        id,
      );
      return result.changes > 0;
    } catch (error) {
      Logger.error(REPO_SCOPE, 'deleteCustomModule failed.', { id, error });
      throw error;
    }
  },

  async replaceCustomModuleOrder(orderedIds: number[]): Promise<void> {
    try {
      await ensureDatabaseReady();
      await withDatabaseTransaction(async (db) => {
        const now = nowIso();
        for (let index = 0; index < orderedIds.length; index += 1) {
          await db.runAsync(
            `UPDATE modules
SET sort_order = ?, updated_at = ?
WHERE id = ? AND type = 'custom' AND is_active = 1;`,
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

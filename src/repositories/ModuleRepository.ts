import { getDatabase, initDatabase } from '@/src/db';
import type { ModuleQuestionCounter, ModuleRecord } from '@/src/models/Module';
import { Logger } from '@/src/services/Logger';

const REPO_SCOPE = 'ModuleRepository';

type ModuleDatabaseRow = Omit<ModuleRecord, 'is_active'> & {
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
    .finally(() => {
      databaseInitPromise = null;
    });
  return databaseInitPromise;
}

function mapModuleRow(row: ModuleDatabaseRow): ModuleRecord {
  return {
    ...row,
    id: Number(row.id),
    custom_no: row.custom_no === null ? null : Number(row.custom_no),
    sort_order: Number(row.sort_order),
    is_active: row.is_active === 1,
  };
}

export const ModuleRepository = {
  async getModuleById(moduleId: number): Promise<ModuleRecord | null> {
    try {
      if (!Number.isInteger(moduleId) || moduleId <= 0) {
        throw new Error('moduleId must be a positive integer.');
      }
      await ensureDatabaseReady();
      const db = await getDatabase();
      const row = await db.getFirstAsync<ModuleDatabaseRow>(
        `SELECT
  id, type, name, display_code, custom_no, icon, color,
  sort_order, is_active, created_at, updated_at
FROM modules
WHERE id = ?
LIMIT 1;`,
        moduleId,
      );
      return row ? mapModuleRow(row) : null;
    } catch (error) {
      Logger.error(REPO_SCOPE, 'getModuleById failed.', { moduleId, error });
      throw error;
    }
  },

  async listAllModules(): Promise<ModuleRecord[]> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const rows = await db.getAllAsync<ModuleDatabaseRow>(
        `SELECT
  id, type, name, display_code, custom_no, icon, color,
  sort_order, is_active, created_at, updated_at
FROM modules
ORDER BY id ASC;`,
      );
      return rows.map(mapModuleRow);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'listAllModules failed.', error);
      throw error;
    }
  },

  async listQuestionCounters(): Promise<ModuleQuestionCounter[]> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const rows = await db.getAllAsync<ModuleQuestionCounter>(
        `SELECT module_id, last_question_no, updated_at
FROM module_question_counters
ORDER BY module_id ASC;`,
      );
      return rows.map((row) => ({
        module_id: Number(row.module_id),
        last_question_no: Number(row.last_question_no),
        updated_at: row.updated_at,
      }));
    } catch (error) {
      Logger.error(REPO_SCOPE, 'listQuestionCounters failed.', error);
      throw error;
    }
  },
} as const;

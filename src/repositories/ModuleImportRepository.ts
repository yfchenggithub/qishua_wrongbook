import type * as SQLite from 'expo-sqlite';

import { getDatabase, initDatabase } from '@/src/db';
import type {
  CreateModuleImportInput,
  CreateModuleImportItemInput,
  ListModuleImportsOptions,
  ModuleImportItemRecord,
  ModuleImportRecord,
  ModuleImportWithItems,
} from '@/src/models/ModuleImport';
import { Logger } from '@/src/services/Logger';
import { createRecordId } from '@/src/utils/id';

const REPO_SCOPE = 'ModuleImportRepository';
const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 1000;
const MAX_IMPORT_ITEMS = 999;
const MAX_SOURCE_MODULE_NAME_LENGTH = 16;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_CREATOR_NAME_LENGTH = 32;
const MAX_ITEM_ID_LENGTH = 64;
const MAX_PACKAGE_ID_LENGTH = 128;
const SQLITE_LOOKUP_CHUNK_SIZE = 200;
const ITEM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const PACKAGE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

const SELECT_IMPORT_FIELDS_SQL = `
SELECT
  id,
  package_id,
  content_version,
  module_id,
  source_module_name,
  description,
  creator_name,
  package_created_at,
  imported_at
FROM module_imports
`;

const SELECT_IMPORT_ITEM_FIELDS_SQL = `
SELECT
  import_id,
  item_id,
  mistake_id,
  position
FROM module_import_items
`;

type ModuleImportDatabaseRow = Omit<ModuleImportRecord, 'content_version' | 'module_id'> & {
  content_version: number;
  module_id: number;
};

type ModuleImportItemDatabaseRow = Omit<ModuleImportItemRecord, 'position'> & {
  position: number;
};

type CountRow = {
  total: number | null;
};

type ModuleTypeRow = {
  type: string;
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

function mapImportRow(row: ModuleImportDatabaseRow): ModuleImportRecord {
  return {
    ...row,
    content_version: Number(row.content_version),
    module_id: Number(row.module_id),
  };
}

function mapImportItemRow(row: ModuleImportItemDatabaseRow): ModuleImportItemRecord {
  return {
    ...row,
    position: Number(row.position),
  };
}

function normalizeRequiredText(value: string, fieldName: string, maxLength: number): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new Error(`${fieldName} 不能为空。`);
  }
  if (normalized.length > maxLength) {
    throw new Error(`${fieldName} 不能超过 ${maxLength} 个字符。`);
  }
  return normalized;
}

function normalizeOptionalText(
  value: string | null | undefined,
  fieldName: string,
  maxLength: number,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length > maxLength) {
    throw new Error(`${fieldName} 不能超过 ${maxLength} 个字符。`);
  }
  return normalized;
}

function normalizePositiveInteger(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${fieldName} 必须是正整数。`);
  }
  return value;
}

function normalizeIsoDateTime(value: string, fieldName: string): string {
  const normalized = normalizeRequiredText(value, fieldName, 64);
  if (Number.isNaN(new Date(normalized).getTime())) {
    throw new Error(`${fieldName} 必须是有效时间。`);
  }
  return normalized;
}

function normalizePackageId(value: string): string {
  const normalized = normalizeRequiredText(value, 'packageId', MAX_PACKAGE_ID_LENGTH);
  if (!PACKAGE_ID_PATTERN.test(normalized)) {
    throw new Error('packageId 格式不正确。');
  }
  return normalized;
}

function normalizeItemId(value: string): string {
  const normalized = normalizeRequiredText(value, 'itemId', MAX_ITEM_ID_LENGTH);
  if (!ITEM_ID_PATTERN.test(normalized)) {
    throw new Error('itemId 格式不正确。');
  }
  return normalized;
}

function normalizeListLimit(value?: number): number {
  if (value === undefined) {
    return DEFAULT_LIST_LIMIT;
  }
  if (!Number.isInteger(value) || value < 0 || value > MAX_LIST_LIMIT) {
    throw new Error(`limit 必须是 0-${MAX_LIST_LIMIT} 的整数。`);
  }
  return value;
}

function normalizeListOffset(value?: number): number {
  if (value === undefined) {
    return 0;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('offset 必须是非负整数。');
  }
  return value;
}

function normalizeItems(items: CreateModuleImportItemInput[]): CreateModuleImportItemInput[] {
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_IMPORT_ITEMS) {
    throw new Error(`items 数量必须是 1-${MAX_IMPORT_ITEMS}。`);
  }

  const normalizedItems = items.map((item) => ({
    itemId: normalizeItemId(item.itemId),
    mistakeId: normalizeRequiredText(item.mistakeId, 'mistakeId', 128),
    position: normalizePositiveInteger(item.position, 'position'),
  }));
  const itemIds = new Set<string>();
  const mistakeIds = new Set<string>();
  const positions = new Set<number>();
  for (const item of normalizedItems) {
    if (item.position > MAX_IMPORT_ITEMS) {
      throw new Error(`position 不能超过 ${MAX_IMPORT_ITEMS}。`);
    }
    if (itemIds.has(item.itemId)) {
      throw new Error('同一次导入中的 itemId 不能重复。');
    }
    if (mistakeIds.has(item.mistakeId)) {
      throw new Error('同一次导入中的 mistakeId 不能重复。');
    }
    if (positions.has(item.position)) {
      throw new Error('同一次导入中的 position 不能重复。');
    }
    itemIds.add(item.itemId);
    mistakeIds.add(item.mistakeId);
    positions.add(item.position);
  }
  for (let position = 1; position <= normalizedItems.length; position += 1) {
    if (!positions.has(position)) {
      throw new Error('position 必须从 1 开始连续排列。');
    }
  }
  return normalizedItems.sort((left, right) => left.position - right.position);
}

async function findImportByPackageIdInternal(
  db: SQLite.SQLiteDatabase,
  packageId: string,
): Promise<ModuleImportRecord | null> {
  const row = await db.getFirstAsync<ModuleImportDatabaseRow>(
    `${SELECT_IMPORT_FIELDS_SQL}
WHERE package_id = ?
LIMIT 1;`,
    packageId,
  );
  return row ? mapImportRow(row) : null;
}

async function findImportByIdInternal(
  db: SQLite.SQLiteDatabase,
  importId: string,
): Promise<ModuleImportRecord | null> {
  const row = await db.getFirstAsync<ModuleImportDatabaseRow>(
    `${SELECT_IMPORT_FIELDS_SQL}
WHERE id = ?
LIMIT 1;`,
    importId,
  );
  return row ? mapImportRow(row) : null;
}

async function listItemsByImportIdInternal(
  db: SQLite.SQLiteDatabase,
  importId: string,
): Promise<ModuleImportItemRecord[]> {
  const rows = await db.getAllAsync<ModuleImportItemDatabaseRow>(
    `${SELECT_IMPORT_ITEM_FIELDS_SQL}
WHERE import_id = ?
ORDER BY position ASC;`,
    importId,
  );
  return rows.map(mapImportItemRow);
}

async function ensureCustomModuleExists(db: SQLite.SQLiteDatabase, moduleId: number): Promise<void> {
  const row = await db.getFirstAsync<ModuleTypeRow>(
    'SELECT type FROM modules WHERE id = ? LIMIT 1;',
    moduleId,
  );
  if (row?.type !== 'custom') {
    throw new Error('题包来源只能关联自定义模块。');
  }
}

async function ensureMistakesBelongToModule(
  db: SQLite.SQLiteDatabase,
  moduleId: number,
  mistakeIds: string[],
): Promise<void> {
  let matchedCount = 0;
  for (let offset = 0; offset < mistakeIds.length; offset += SQLITE_LOOKUP_CHUNK_SIZE) {
    const chunk = mistakeIds.slice(offset, offset + SQLITE_LOOKUP_CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(', ');
    const row = await db.getFirstAsync<CountRow>(
      `SELECT COUNT(*) AS total
FROM mistakes
WHERE module_id = ? AND id IN (${placeholders});`,
      moduleId,
      ...chunk,
    );
    matchedCount += Number(row?.total ?? 0);
  }
  if (matchedCount !== mistakeIds.length) {
    throw new Error('题包题目必须全部属于本次导入的新模块。');
  }
}

export const ModuleImportRepository = {
  async hasImportedPackage(packageIdInput: string): Promise<boolean> {
    try {
      await ensureDatabaseReady();
      const packageId = normalizePackageId(packageIdInput);
      return Boolean(await findImportByPackageIdInternal(await getDatabase(), packageId));
    } catch (error) {
      Logger.error(REPO_SCOPE, 'hasImportedPackage failed.', error);
      throw error;
    }
  },

  async findImportByPackageId(packageIdInput: string): Promise<ModuleImportRecord | null> {
    try {
      await ensureDatabaseReady();
      const packageId = normalizePackageId(packageIdInput);
      return await findImportByPackageIdInternal(await getDatabase(), packageId);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'findImportByPackageId failed.', error);
      throw error;
    }
  },

  async findImportByMistakeId(mistakeIdInput: string): Promise<ModuleImportRecord | null> {
    try {
      await ensureDatabaseReady();
      const mistakeId = normalizeRequiredText(mistakeIdInput, 'mistakeId', 128);
      const db = await getDatabase();
      const row = await db.getFirstAsync<ModuleImportDatabaseRow>(
        `${SELECT_IMPORT_FIELDS_SQL}
WHERE id = (
  SELECT import_id
  FROM module_import_items
  WHERE mistake_id = ?
  LIMIT 1
)
LIMIT 1;`,
        mistakeId,
      );
      return row ? mapImportRow(row) : null;
    } catch (error) {
      Logger.error(REPO_SCOPE, 'findImportByMistakeId failed.', error);
      throw error;
    }
  },

  async listImports(options?: ListModuleImportsOptions): Promise<ModuleImportRecord[]> {
    try {
      await ensureDatabaseReady();
      const limit = normalizeListLimit(options?.limit);
      const offset = normalizeListOffset(options?.offset);
      const rows = await (await getDatabase()).getAllAsync<ModuleImportDatabaseRow>(
        `${SELECT_IMPORT_FIELDS_SQL}
ORDER BY imported_at DESC, id DESC
LIMIT ? OFFSET ?;`,
        limit,
        offset,
      );
      return rows.map(mapImportRow);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'listImports failed.', { options, error });
      throw error;
    }
  },

  async listAllImportItems(options?: ListModuleImportsOptions): Promise<ModuleImportItemRecord[]> {
    try {
      await ensureDatabaseReady();
      const limit = normalizeListLimit(options?.limit);
      const offset = normalizeListOffset(options?.offset);
      const rows = await (await getDatabase()).getAllAsync<ModuleImportItemDatabaseRow>(
        `${SELECT_IMPORT_ITEM_FIELDS_SQL}
ORDER BY import_id ASC, position ASC
LIMIT ? OFFSET ?;`,
        limit,
        offset,
      );
      return rows.map(mapImportItemRow);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'listAllImportItems failed.', { options, error });
      throw error;
    }
  },

  async getImportWithItems(importIdInput: string): Promise<ModuleImportWithItems | null> {
    try {
      await ensureDatabaseReady();
      const importId = normalizeRequiredText(importIdInput, 'importId', 128);
      const db = await getDatabase();
      const record = await findImportByIdInternal(db, importId);
      if (!record) {
        return null;
      }
      return {
        ...record,
        items: await listItemsByImportIdInternal(db, importId),
      };
    } catch (error) {
      Logger.error(REPO_SCOPE, 'getImportWithItems failed.', error);
      throw error;
    }
  },

  async createImportInTransaction(
    db: SQLite.SQLiteDatabase,
    input: CreateModuleImportInput,
  ): Promise<ModuleImportWithItems> {
    const id = input.id
      ? normalizeRequiredText(input.id, 'id', 128)
      : createRecordId('MI');
    const packageId = normalizePackageId(input.packageId);
    const contentVersion = normalizePositiveInteger(input.contentVersion, 'contentVersion');
    const moduleId = normalizePositiveInteger(input.moduleId, 'moduleId');
    const sourceModuleName = normalizeRequiredText(
      input.sourceModuleName,
      'sourceModuleName',
      MAX_SOURCE_MODULE_NAME_LENGTH,
    );
    const description = normalizeOptionalText(
      input.description,
      'description',
      MAX_DESCRIPTION_LENGTH,
    );
    const creatorName = normalizeOptionalText(
      input.creatorName,
      'creatorName',
      MAX_CREATOR_NAME_LENGTH,
    );
    const packageCreatedAt = normalizeIsoDateTime(input.packageCreatedAt, 'packageCreatedAt');
    const importedAt = input.importedAt
      ? normalizeIsoDateTime(input.importedAt, 'importedAt')
      : new Date().toISOString();
    const items = normalizeItems(input.items);

    await ensureCustomModuleExists(db, moduleId);
    await ensureMistakesBelongToModule(
      db,
      moduleId,
      items.map((item) => item.mistakeId),
    );
    if (await findImportByPackageIdInternal(db, packageId)) {
      throw new Error('该题包已经导入。');
    }

    await db.runAsync(
      `INSERT INTO module_imports (
  id,
  package_id,
  content_version,
  module_id,
  source_module_name,
  description,
  creator_name,
  package_created_at,
  imported_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      id,
      packageId,
      contentVersion,
      moduleId,
      sourceModuleName,
      description,
      creatorName,
      packageCreatedAt,
      importedAt,
    );

    const records: ModuleImportItemRecord[] = [];
    for (const item of items) {
      await db.runAsync(
        `INSERT INTO module_import_items (
  import_id,
  item_id,
  mistake_id,
  position
) VALUES (?, ?, ?, ?);`,
        id,
        item.itemId,
        item.mistakeId,
        item.position,
      );
      records.push({
        import_id: id,
        item_id: item.itemId,
        mistake_id: item.mistakeId,
        position: item.position,
      });
    }

    const created = await findImportByIdInternal(db, id);
    if (!created) {
      throw new Error('题包来源记录创建后读取失败。');
    }
    return { ...created, items: records };
  },
} as const;

import * as SQLite from 'expo-sqlite';

import { DATABASE_NAME, DATABASE_VERSION } from '@/src/db/constants';
import { CREATE_MISTAKES_TABLE_SQL, CREATE_SCHEMA_SQL } from '@/src/db/schema';
import { Logger } from '@/src/services/Logger';

const DB_SCOPE = 'DatabaseService';
const REQUIRED_TABLES = [
  'mistakes',
  'mistake_images',
  'review_records',
  'review_sheets',
  'review_sheet_items',
  'module_question_counters',
  'custom_modules',
  'custom_error_reasons',
  'mistake_relations',
  'mistake_tags',
] as const;

type UserVersionRow = {
  user_version: number;
};

type TableRow = {
  name: string;
};

type TableColumnRow = {
  name: string;
};

type TableSqlRow = {
  sql: string | null;
};

export interface DatabaseHealthReport {
  ok: boolean;
  version: number;
  tables: string[];
  message: string;
}

export type DatabaseTransactionCallback<T> = (db: SQLite.SQLiteDatabase) => Promise<T>;

type TransactionCapableDatabase = SQLite.SQLiteDatabase & {
  withTransactionAsync?: (task: () => Promise<void>) => Promise<void>;
};

let databaseInstance: SQLite.SQLiteDatabase | null = null;
let openingDatabasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function readUserVersion(db: SQLite.SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<UserVersionRow>('PRAGMA user_version');
  return Number(row?.user_version ?? 0);
}

async function setUserVersion(db: SQLite.SQLiteDatabase, version: number): Promise<void> {
  await db.execAsync(`PRAGMA user_version = ${version}`);
}

async function applyBaseSchema(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(CREATE_SCHEMA_SQL);
}

async function ensureReviewRecordsVoiceNoteColumn(db: SQLite.SQLiteDatabase): Promise<void> {
  const columnRows = await db.getAllAsync<TableColumnRow>('PRAGMA table_info(review_records);');
  const hasVoiceNoteColumn = columnRows.some((row) => row.name === 'voice_note');

  if (hasVoiceNoteColumn) {
    return;
  }

  Logger.info(DB_SCOPE, 'Adding missing review_records.voice_note column for backward compatibility.');
  await db.execAsync('ALTER TABLE review_records ADD COLUMN voice_note TEXT;');
}

async function ensureColumn(
  db: SQLite.SQLiteDatabase,
  tableName: string,
  columnName: string,
  alterTableSql: string,
): Promise<void> {
  const columnRows = await db.getAllAsync<TableColumnRow>(`PRAGMA table_info(${tableName});`);
  const hasColumn = columnRows.some((row) => row.name === columnName);

  if (hasColumn) {
    return;
  }

  Logger.info(DB_SCOPE, `Adding missing ${tableName}.${columnName} column for backward compatibility.`);
  await db.execAsync(alterTableSql);
}

async function ensureTextHighlightColumns(db: SQLite.SQLiteDatabase): Promise<void> {
  await ensureColumn(
    db,
    'mistakes',
    'note_highlights',
    'ALTER TABLE mistakes ADD COLUMN note_highlights TEXT;',
  );
  await ensureColumn(
    db,
    'review_records',
    'note_highlights',
    'ALTER TABLE review_records ADD COLUMN note_highlights TEXT;',
  );
}

async function ensureLibraryColumns(db: SQLite.SQLiteDatabase): Promise<void> {
  await ensureColumn(
    db,
    'mistakes',
    'is_pinned',
    'ALTER TABLE mistakes ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1));',
  );
  await ensureColumn(
    db,
    'mistakes',
    'last_viewed_at',
    'ALTER TABLE mistakes ADD COLUMN last_viewed_at TEXT;',
  );
  await db.execAsync(`
CREATE INDEX IF NOT EXISTS idx_mistakes_is_pinned ON mistakes(is_pinned);
CREATE INDEX IF NOT EXISTS idx_mistakes_last_viewed_at ON mistakes(last_viewed_at);
`);
}

async function ensureMistakesCollectedStatusSupport(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<TableSqlRow>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'mistakes' LIMIT 1;",
  );
  const createSql = row?.sql ?? '';
  if (!createSql) {
    return;
  }
  if (createSql.includes("'collected'")) {
    return;
  }

  Logger.info(DB_SCOPE, 'Rebuilding mistakes table to support collected status.');
  const createMigrationTableSql = CREATE_MISTAKES_TABLE_SQL.replace(
    'CREATE TABLE IF NOT EXISTS mistakes',
    'CREATE TABLE IF NOT EXISTS mistakes_new',
  );

  await db.execAsync(`
PRAGMA foreign_keys = OFF;
DROP TABLE IF EXISTS mistakes_new;
${createMigrationTableSql}
INSERT INTO mistakes_new (
  id,
  subject,
  module,
  title,
  error_reason,
  difficulty,
  note,
  note_highlights,
  review_count,
  status,
  created_at,
  updated_at,
  next_review_at,
  last_review_at,
  last_review_result,
  is_pinned,
  last_viewed_at
)
SELECT
  id,
  subject,
  module,
  title,
  error_reason,
  difficulty,
  note,
  note_highlights,
  review_count,
  status,
  created_at,
  updated_at,
  next_review_at,
  last_review_at,
  last_review_result,
  is_pinned,
  last_viewed_at
FROM mistakes;
DROP TABLE mistakes;
ALTER TABLE mistakes_new RENAME TO mistakes;
PRAGMA foreign_keys = ON;
`);
  await applyBaseSchema(db);
}

async function ensureBackwardCompatibleColumns(db: SQLite.SQLiteDatabase): Promise<void> {
  await ensureReviewRecordsVoiceNoteColumn(db);
  await ensureTextHighlightColumns(db);
  await ensureLibraryColumns(db);
  await ensureMistakesCollectedStatusSupport(db);
}

async function rebuildDomainSchema(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
PRAGMA foreign_keys = OFF;
DROP TABLE IF EXISTS mistake_images;
DROP TABLE IF EXISTS review_records;
DROP TABLE IF EXISTS review_sheet_items;
DROP TABLE IF EXISTS review_sheets;
DROP TABLE IF EXISTS mistake_relations;
DROP TABLE IF EXISTS mistake_tags;
DROP TABLE IF EXISTS mistakes;
DROP TABLE IF EXISTS module_question_counters;
DROP TABLE IF EXISTS custom_modules;
DROP TABLE IF EXISTS custom_error_reasons;
PRAGMA foreign_keys = ON;
`);
  await applyBaseSchema(db);
}

async function runMigrationToCurrentVersion(
  db: SQLite.SQLiteDatabase,
  currentVersion: number,
): Promise<void> {
  if (currentVersion > DATABASE_VERSION) {
    Logger.warn(
      DB_SCOPE,
      `Database user_version (${currentVersion}) is newer than app version (${DATABASE_VERSION}).`,
    );
    return;
  }

  if (currentVersion === DATABASE_VERSION) {
    await applyBaseSchema(db);
    await ensureBackwardCompatibleColumns(db);
    return;
  }

  Logger.info(DB_SCOPE, 'Running database migration.', {
    from: currentVersion,
    to: DATABASE_VERSION,
  });

  if (currentVersion <= 0) {
    await rebuildDomainSchema(db);
    await ensureBackwardCompatibleColumns(db);
  } else {
    await ensureBackwardCompatibleColumns(db);
    await applyBaseSchema(db);
  }
  await setUserVersion(db, DATABASE_VERSION);
}

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (databaseInstance) {
    return databaseInstance;
  }

  if (openingDatabasePromise) {
    return openingDatabasePromise;
  }

  openingDatabasePromise = SQLite.openDatabaseAsync(DATABASE_NAME)
    .then((db) => {
      databaseInstance = db;
      Logger.info(DB_SCOPE, `Database opened: ${DATABASE_NAME}`);
      return db;
    })
    .catch((error) => {
      Logger.error(DB_SCOPE, 'Failed to open database.', error);
      throw error;
    })
    .finally(() => {
      openingDatabasePromise = null;
    });

  return openingDatabasePromise;
}

export async function withDatabaseTransaction<T>(
  callback: DatabaseTransactionCallback<T>,
): Promise<T> {
  const db = await getDatabase();
  const transactionDatabase = db as TransactionCapableDatabase;

  if (typeof transactionDatabase.withTransactionAsync === 'function') {
    let hasResult = false;
    let result!: T;

    try {
      await transactionDatabase.withTransactionAsync(async () => {
        result = await callback(db);
        hasResult = true;
      });
    } catch (error) {
      Logger.error(DB_SCOPE, 'Transaction failed via withTransactionAsync.', error);
      throw error;
    }

    if (!hasResult) {
      const missingResultError = new Error('Transaction callback completed without a result.');
      Logger.error(DB_SCOPE, 'Transaction result is missing after withTransactionAsync.', missingResultError);
      throw missingResultError;
    }

    return result;
  }

  // Fallback for environments where withTransactionAsync is unavailable.
  try {
    await db.execAsync('BEGIN IMMEDIATE;');
  } catch (error) {
    Logger.error(DB_SCOPE, 'Failed to begin fallback transaction.', error);
    throw error;
  }

  try {
    const result = await callback(db);
    await db.execAsync('COMMIT;');
    return result;
  } catch (error) {
    try {
      await db.execAsync('ROLLBACK;');
    } catch (rollbackError) {
      Logger.error(DB_SCOPE, 'Failed to rollback fallback transaction.', rollbackError);
    }
    Logger.error(DB_SCOPE, 'Transaction failed in fallback mode.', error);
    throw error;
  }
}

export async function initDatabase(): Promise<void> {
  try {
    const db = await getDatabase();

    await db.execAsync('PRAGMA foreign_keys = ON;');
    await db.execAsync('PRAGMA journal_mode = WAL;');

    const currentVersion = await readUserVersion(db);
    await runMigrationToCurrentVersion(db, currentVersion);
    await ensureBackwardCompatibleColumns(db);

    const finalVersion = await readUserVersion(db);
    Logger.info(DB_SCOPE, 'Database initialized.', {
      currentVersion,
      finalVersion,
      targetVersion: DATABASE_VERSION,
    });
  } catch (error) {
    Logger.error(DB_SCOPE, 'Database initialization failed.', error);
    throw error;
  }
}

export async function getDatabaseVersion(): Promise<number> {
  try {
    const db = await getDatabase();
    return await readUserVersion(db);
  } catch (error) {
    Logger.error(DB_SCOPE, 'Failed to read database version.', error);
    throw error;
  }
}

export async function resetDatabaseForDev(): Promise<void> {
  try {
    const db = await getDatabase();

    await db.execAsync(`
PRAGMA foreign_keys = OFF;
DROP TABLE IF EXISTS review_records;
DROP TABLE IF EXISTS mistake_images;
DROP TABLE IF EXISTS review_sheet_items;
DROP TABLE IF EXISTS review_sheets;
DROP TABLE IF EXISTS mistake_relations;
DROP TABLE IF EXISTS mistake_tags;
DROP TABLE IF EXISTS mistakes;
DROP TABLE IF EXISTS module_question_counters;
DROP TABLE IF EXISTS custom_modules;
DROP TABLE IF EXISTS custom_error_reasons;
PRAGMA user_version = 0;
PRAGMA foreign_keys = ON;
`);

    Logger.warn(DB_SCOPE, 'Database reset for development has been executed.');
    await initDatabase();
  } catch (error) {
    Logger.error(DB_SCOPE, 'Failed to reset database for development.', error);
    throw error;
  }
}

export async function checkDatabaseHealth(): Promise<DatabaseHealthReport> {
  try {
    const db = await getDatabase();
    const version = await readUserVersion(db);

    const tableRows = await db.getAllAsync<TableRow>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('mistakes', 'mistake_images', 'review_records', 'review_sheets', 'review_sheet_items', 'module_question_counters', 'custom_modules', 'custom_error_reasons', 'mistake_relations', 'mistake_tags')`,
    );
    const tables = tableRows.map((row) => row.name);

    const missingTables = REQUIRED_TABLES.filter((tableName) => !tables.includes(tableName));
    const versionMatched = version === DATABASE_VERSION;
    const ok = missingTables.length === 0 && versionMatched;

    const message = ok
      ? 'Database health check passed.'
      : `Database health check failed. Missing tables: ${
          missingTables.length > 0 ? missingTables.join(', ') : 'none'
        }; version: ${version}, expected: ${DATABASE_VERSION}.`;

    return {
      ok,
      version,
      tables,
      message,
    };
  } catch (error) {
    Logger.error(DB_SCOPE, 'Database health check failed with exception.', error);
    return {
      ok: false,
      version: -1,
      tables: [],
      message: 'Database health check failed due to runtime error.',
    };
  }
}

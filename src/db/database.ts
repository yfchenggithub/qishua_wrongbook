import * as SQLite from 'expo-sqlite';

import { DATABASE_NAME, DATABASE_VERSION } from '@/src/db/constants';
import { CREATE_SCHEMA_SQL } from '@/src/db/schema';
import { Logger } from '@/src/services/Logger';

const DB_SCOPE = 'DatabaseService';
const REQUIRED_TABLES = ['mistakes', 'mistake_images', 'review_records'] as const;

type UserVersionRow = {
  user_version: number;
};

type TableRow = {
  name: string;
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

async function rebuildDomainSchema(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
PRAGMA foreign_keys = OFF;
DROP TABLE IF EXISTS mistake_images;
DROP TABLE IF EXISTS review_records;
DROP TABLE IF EXISTS mistakes;
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
    return;
  }

  Logger.info(DB_SCOPE, 'Running database migration.', {
    from: currentVersion,
    to: DATABASE_VERSION,
  });

  // Development phase strategy:
  // For schema-breaking changes, rebuild domain tables directly instead of
  // carrying compatibility fields.
  await rebuildDomainSchema(db);
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
DROP TABLE IF EXISTS mistakes;
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
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('mistakes', 'mistake_images', 'review_records')`,
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

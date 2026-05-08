import { getDatabase, initDatabase } from '@/src/db';
import type { MistakeImageType } from '@/src/models/Mistake';
import type { CreateMistakeImageInput, MistakeImage } from '@/src/models/MistakeImage';
import { Logger } from '@/src/services/Logger';
import type * as SQLite from 'expo-sqlite';

const REPO_SCOPE = 'MistakeImageRepository';

const INSERT_MISTAKE_IMAGE_SQL = `
INSERT INTO mistake_images (
  id,
  mistake_id,
  type,
  uri,
  created_at
) VALUES (?, ?, ?, ?, ?);
`;

const SELECT_MISTAKE_IMAGE_FIELDS_SQL = `
SELECT
  id,
  mistake_id,
  type,
  uri,
  created_at
FROM mistake_images
`;

let databaseReady = false;
let databaseInitPromise: Promise<void> | null = null;

// The repository assumes app startup runs initDatabase().
// For safety, we still lazy-initialize here to prevent direct repository usage from failing.
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

function buildMistakeImageId(): string {
  const randomPart = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');
  return `IMG${Date.now()}${randomPart}`;
}

function mapMistakeImageRow(row: MistakeImage): MistakeImage {
  return {
    ...row,
    type: row.type as MistakeImageType,
  };
}

function buildMistakeImage(
  input: CreateMistakeImageInput & { id?: string; createdAt?: string },
): MistakeImage {
  return {
    id: input.id?.trim() || buildMistakeImageId(),
    mistake_id: input.mistake_id,
    type: input.type,
    uri: input.uri,
    created_at: input.createdAt ?? nowIso(),
  };
}

async function getImageByIdInternal(id: string): Promise<MistakeImage | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<MistakeImage>(
    `${SELECT_MISTAKE_IMAGE_FIELDS_SQL}
WHERE id = ?
LIMIT 1;`,
    id,
  );

  if (!row) {
    return null;
  }

  return mapMistakeImageRow(row);
}

export const MistakeImageRepository = {
  async createMistakeImage(input: CreateMistakeImageInput): Promise<MistakeImage> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const record = await MistakeImageRepository.createMistakeImageInTransaction(db, input);

      const created = await getImageByIdInternal(record.id);
      if (!created) {
        throw new Error('Failed to load the created mistake image record.');
      }

      return created;
    } catch (error) {
      Logger.error(REPO_SCOPE, 'createMistakeImage failed.', { input, error });
      throw error;
    }
  },

  async listImagesByMistakeId(mistakeId: string): Promise<MistakeImage[]> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const rows = await db.getAllAsync<MistakeImage>(
        `${SELECT_MISTAKE_IMAGE_FIELDS_SQL}
WHERE mistake_id = ?
ORDER BY created_at ASC;`,
        mistakeId,
      );

      return rows.map(mapMistakeImageRow);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'listImagesByMistakeId failed.', { mistakeId, error });
      throw error;
    }
  },

  async listImagesByType(mistakeId: string, type: MistakeImageType): Promise<MistakeImage[]> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const rows = await db.getAllAsync<MistakeImage>(
        `${SELECT_MISTAKE_IMAGE_FIELDS_SQL}
WHERE mistake_id = ?
  AND type = ?
ORDER BY created_at ASC;`,
        mistakeId,
        type,
      );

      return rows.map(mapMistakeImageRow);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'listImagesByType failed.', { mistakeId, type, error });
      throw error;
    }
  },

  async deleteImage(id: string): Promise<boolean> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const result = await db.runAsync('DELETE FROM mistake_images WHERE id = ?;', id);
      return result.changes > 0;
    } catch (error) {
      Logger.error(REPO_SCOPE, 'deleteImage failed.', { id, error });
      throw error;
    }
  },

  async deleteImagesByMistakeId(mistakeId: string): Promise<number> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const result = await db.runAsync('DELETE FROM mistake_images WHERE mistake_id = ?;', mistakeId);
      return result.changes;
    } catch (error) {
      Logger.error(REPO_SCOPE, 'deleteImagesByMistakeId failed.', { mistakeId, error });
      throw error;
    }
  },

  async createMistakeImageInTransaction(
    db: SQLite.SQLiteDatabase,
    input: CreateMistakeImageInput & { id?: string; createdAt?: string },
  ): Promise<MistakeImage> {
    try {
      const record = buildMistakeImage(input);
      await db.runAsync(
        INSERT_MISTAKE_IMAGE_SQL,
        record.id,
        record.mistake_id,
        record.type,
        record.uri,
        record.created_at,
      );

      return mapMistakeImageRow(record);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'createMistakeImageInTransaction failed.', { input, error });
      throw error;
    }
  },
} as const;

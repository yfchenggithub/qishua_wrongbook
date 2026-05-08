import { getDatabase, initDatabase } from '@/src/db';
import { MAX_REVIEW_COUNT, REVIEW_STATUS } from '@/src/constants/review';
import type {
  CreateMistakeInput,
  Mistake,
  MistakeStatus,
  UpdateMistakeInput,
} from '@/src/models/Mistake';
import { Logger } from '@/src/services/Logger';

const REPO_SCOPE = 'MistakeRepository';
const DEFAULT_SUBJECT = 'math';
const DEFAULT_DIFFICULTY = 3;

const INSERT_MISTAKE_SQL = `
INSERT INTO mistakes (
  id,
  subject,
  module,
  title,
  error_reason,
  difficulty,
  question_image_uri,
  answer_image_uri,
  note,
  review_count,
  status,
  created_at,
  updated_at,
  next_review_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
`;

const SELECT_MISTAKE_FIELDS_SQL = `
SELECT
  id,
  subject,
  module,
  title,
  error_reason,
  difficulty,
  question_image_uri,
  answer_image_uri,
  note,
  review_count,
  status,
  created_at,
  updated_at,
  next_review_at
FROM mistakes
`;

export interface ListMistakesOptions {
  status?: MistakeStatus;
  module?: string;
  limit?: number;
  offset?: number;
}

export interface MistakeStats {
  total: number;
  active: number;
  mastered: number;
  dueToday: number;
}

export interface UpdateReviewProgressParams {
  mistakeId: string;
  reviewCount: number;
  nextReviewAt?: string | null;
  status?: MistakeStatus;
}

type MistakeStatsRow = {
  total: number | null;
  active: number | null;
  mastered: number | null;
  dueToday: number | null;
};

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

function buildMistakeId(): string {
  const randomPart = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');
  return `M${Date.now()}${randomPart}`;
}

function normalizeDifficulty(value?: number): number {
  if (value === undefined) {
    return DEFAULT_DIFFICULTY;
  }

  const normalized = Math.floor(value);
  if (normalized < 1 || normalized > 5) {
    throw new Error('difficulty must be an integer between 1 and 5.');
  }
  return normalized;
}

function normalizeReviewCount(value: number): number {
  const normalized = Math.floor(value);
  if (normalized < 0 || normalized > MAX_REVIEW_COUNT) {
    throw new Error(`review_count must be an integer between 0 and ${MAX_REVIEW_COUNT}.`);
  }
  return normalized;
}

function normalizeLimit(value?: number): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = Math.floor(value);
  if (normalized < 0) {
    throw new Error('limit must be a non-negative integer.');
  }
  return normalized;
}

function normalizeOffset(value?: number): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = Math.floor(value);
  if (normalized < 0) {
    throw new Error('offset must be a non-negative integer.');
  }
  return normalized;
}

function normalizeDueCutoff(todayIsoDate?: string): string {
  if (!todayIsoDate || todayIsoDate.trim().length === 0) {
    return nowIso();
  }

  const trimmed = todayIsoDate.trim();
  if (!trimmed.includes('T')) {
    return `${trimmed}T23:59:59.999Z`;
  }
  return trimmed;
}

function mapMistakeRow(row: Mistake): Mistake {
  return {
    ...row,
    difficulty: Number(row.difficulty),
    review_count: Number(row.review_count),
    status: row.status as MistakeStatus,
  };
}

async function getByIdInternal(id: string): Promise<Mistake | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<Mistake>(
    `${SELECT_MISTAKE_FIELDS_SQL}
WHERE id = ?
LIMIT 1;`,
    id,
  );

  if (!row) {
    return null;
  }

  return mapMistakeRow(row);
}

export const MistakeRepository = {
  async createMistake(input: CreateMistakeInput): Promise<Mistake> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();

      const createdAt = nowIso();
      const record: Mistake = {
        id: buildMistakeId(),
        subject: input.subject?.trim() || DEFAULT_SUBJECT,
        module: input.module,
        title: input.title ?? null,
        error_reason: input.error_reason ?? null,
        difficulty: normalizeDifficulty(input.difficulty),
        question_image_uri: input.question_image_uri ?? null,
        answer_image_uri: input.answer_image_uri ?? null,
        note: input.note ?? null,
        review_count: 0,
        status: REVIEW_STATUS.ACTIVE,
        created_at: createdAt,
        updated_at: createdAt,
        next_review_at: input.next_review_at === undefined ? createdAt : input.next_review_at,
      };

      await db.runAsync(
        INSERT_MISTAKE_SQL,
        record.id,
        record.subject,
        record.module,
        record.title ?? null,
        record.error_reason ?? null,
        record.difficulty,
        record.question_image_uri ?? null,
        record.answer_image_uri ?? null,
        record.note ?? null,
        record.review_count,
        record.status,
        record.created_at,
        record.updated_at,
        record.next_review_at ?? null,
      );

      const created = await getByIdInternal(record.id);
      if (!created) {
        throw new Error('Failed to load the created mistake record.');
      }

      return created;
    } catch (error) {
      Logger.error(REPO_SCOPE, 'createMistake failed.', error);
      throw error;
    }
  },

  async getMistakeById(id: string): Promise<Mistake | null> {
    try {
      await ensureDatabaseReady();
      return await getByIdInternal(id);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'getMistakeById failed.', { id, error });
      throw error;
    }
  },

  async listMistakes(options?: ListMistakesOptions): Promise<Mistake[]> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();

      const whereClauses: string[] = [];
      const bindParams: (string | number)[] = [];

      if (options?.status) {
        whereClauses.push('status = ?');
        bindParams.push(options.status);
      }

      if (options?.module) {
        whereClauses.push('module = ?');
        bindParams.push(options.module);
      }

      let sql = SELECT_MISTAKE_FIELDS_SQL;
      if (whereClauses.length > 0) {
        sql += `\nWHERE ${whereClauses.join(' AND ')}`;
      }

      sql += '\nORDER BY created_at DESC';

      const limit = normalizeLimit(options?.limit);
      const offset = normalizeOffset(options?.offset);
      if (limit !== undefined) {
        sql += '\nLIMIT ?';
        bindParams.push(limit);
      }
      if (offset !== undefined) {
        if (limit === undefined) {
          sql += '\nLIMIT -1';
        }
        sql += '\nOFFSET ?';
        bindParams.push(offset);
      }
      sql += ';';

      const rows = await db.getAllAsync<Mistake>(sql, ...bindParams);
      return rows.map(mapMistakeRow);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'listMistakes failed.', { options, error });
      throw error;
    }
  },

  async listDueMistakes(todayIsoDate?: string): Promise<Mistake[]> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const cutoff = normalizeDueCutoff(todayIsoDate);

      const rows = await db.getAllAsync<Mistake>(
        `${SELECT_MISTAKE_FIELDS_SQL}
WHERE status = ?
  AND next_review_at IS NOT NULL
  AND next_review_at <= ?
ORDER BY next_review_at ASC, created_at ASC;`,
        REVIEW_STATUS.ACTIVE,
        cutoff,
      );

      return rows.map(mapMistakeRow);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'listDueMistakes failed.', { todayIsoDate, error });
      throw error;
    }
  },

  async getMistakeStats(): Promise<MistakeStats> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const cutoff = nowIso();

      const row = await db.getFirstAsync<MistakeStatsRow>(
        `SELECT
  COUNT(*) AS total,
  SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS active,
  SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS mastered,
  SUM(CASE WHEN status = ? AND next_review_at IS NOT NULL AND next_review_at <= ? THEN 1 ELSE 0 END) AS dueToday
FROM mistakes;`,
        REVIEW_STATUS.ACTIVE,
        REVIEW_STATUS.MASTERED,
        REVIEW_STATUS.ACTIVE,
        cutoff,
      );

      return {
        total: Number(row?.total ?? 0),
        active: Number(row?.active ?? 0),
        mastered: Number(row?.mastered ?? 0),
        dueToday: Number(row?.dueToday ?? 0),
      };
    } catch (error) {
      Logger.error(REPO_SCOPE, 'getMistakeStats failed.', error);
      throw error;
    }
  },

  async updateMistake(id: string, input: UpdateMistakeInput): Promise<Mistake | null> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();

      const setClauses: string[] = [];
      const bindParams: (string | number | null)[] = [];
      const updatableFields: (keyof UpdateMistakeInput)[] = [
        'subject',
        'module',
        'title',
        'error_reason',
        'difficulty',
        'question_image_uri',
        'answer_image_uri',
        'note',
        'review_count',
        'status',
        'next_review_at',
      ];

      for (const field of updatableFields) {
        if (!Object.prototype.hasOwnProperty.call(input, field)) {
          continue;
        }

        const fieldValue = input[field];
        if (fieldValue === undefined) {
          continue;
        }

        if (field === 'difficulty') {
          setClauses.push(`${field} = ?`);
          bindParams.push(normalizeDifficulty(fieldValue as number));
          continue;
        }

        if (field === 'review_count') {
          setClauses.push(`${field} = ?`);
          bindParams.push(normalizeReviewCount(fieldValue as number));
          continue;
        }

        setClauses.push(`${field} = ?`);
        bindParams.push(fieldValue);
      }

      if (setClauses.length === 0) {
        return await getByIdInternal(id);
      }

      setClauses.push('updated_at = ?');
      bindParams.push(nowIso());
      bindParams.push(id);

      const result = await db.runAsync(
        `UPDATE mistakes
SET ${setClauses.join(', ')}
WHERE id = ?;`,
        ...bindParams,
      );

      if (result.changes <= 0) {
        return null;
      }

      return await getByIdInternal(id);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'updateMistake failed.', { id, input, error });
      throw error;
    }
  },

  async updateReviewProgress(params: UpdateReviewProgressParams): Promise<Mistake | null> {
    try {
      const input: UpdateMistakeInput = {
        review_count: normalizeReviewCount(params.reviewCount),
      };

      if (params.nextReviewAt !== undefined) {
        input.next_review_at = params.nextReviewAt;
      }

      if (params.status !== undefined) {
        input.status = params.status;
      }

      return await MistakeRepository.updateMistake(params.mistakeId, input);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'updateReviewProgress failed.', { params, error });
      throw error;
    }
  },

  async deleteMistake(id: string): Promise<boolean> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const result = await db.runAsync('DELETE FROM mistakes WHERE id = ?;', id);
      return result.changes > 0;
    } catch (error) {
      Logger.error(REPO_SCOPE, 'deleteMistake failed.', { id, error });
      throw error;
    }
  },
} as const;

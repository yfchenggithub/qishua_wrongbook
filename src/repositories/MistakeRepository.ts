import { getDatabase, initDatabase, withDatabaseTransaction } from '@/src/db';
import { MAX_REVIEW_COUNT, REVIEW_STATUS } from '@/src/constants/review';
import { MODULE_QUESTION_MAX_NUMBER, parseMistakeDisplayCode } from '@/src/constants/modules';
import type {
  CreateMistakeInput,
  Mistake,
  ReviewResult,
  MistakeStatus,
  UpdateMistakeInput,
} from '@/src/models/Mistake';
import { Logger } from '@/src/services/Logger';
import type * as SQLite from 'expo-sqlite';

const REPO_SCOPE = 'MistakeRepository';
const DEFAULT_SUBJECT = 'math';
const DEFAULT_DIFFICULTY = 3;
const REVIEW_RESULT_VALUES: ReviewResult[] = ['mastered', 'unsure', 'wrong'];

const INSERT_MISTAKE_SQL = `
INSERT INTO mistakes (
  id,
  subject,
  module,
  module_id,
  question_no,
  title,
  error_reason,
  error_reason_ids,
  difficulty,
  note,
  my_solution_text,
  answer_text,
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
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
`;

const SELECT_MISTAKE_FIELDS_SQL = `
SELECT
  id,
  subject,
  COALESCE(
    (SELECT module_lookup.name FROM modules module_lookup WHERE module_lookup.id = mistakes.module_id),
    module
  ) AS module,
  module_id,
  (SELECT module_lookup.display_code FROM modules module_lookup WHERE module_lookup.id = mistakes.module_id)
    AS module_display_code,
  question_no,
  title,
  error_reason,
  error_reason_ids,
  difficulty,
  note,
  my_solution_text,
  answer_text,
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
FROM mistakes
`;

export interface ListMistakesOptions {
  status?: MistakeStatus | 'all';
  module?: string | null;
  moduleId?: number | null;
  keyword?: string | null;
  tagKeys?: string[];
  dueOnly?: boolean;
  limit?: number | null;
  offset?: number;
  sortBy?: 'created_at' | 'updated_at' | 'next_review_at' | 'review_count' | 'last_viewed_at';
  sortOrder?: 'asc' | 'desc';
}

export interface MistakeStats {
  total: number;
  collected: number;
  active: number;
  mastered: number;
  dueToday: number;
}

export interface MistakeModuleCount {
  module: string;
  count: number;
}

export interface MistakeModuleIdCount {
  moduleId: number;
  count: number;
}

export interface MistakeTagCount {
  name: string;
  normalizedName: string;
  count: number;
  latestUpdatedAt?: string | null;
}

export interface TodayReviewQueueQuery {
  todayStartIso: string;
  todayEndIso: string;
  limit?: number;
  offset?: number;
}

export interface NextReviewRangeQuery {
  startInclusiveIso: string;
  endInclusiveIso: string;
  limit?: number;
  offset?: number;
}

export interface UpdateReviewProgressParams {
  mistakeId: string;
  reviewCount: number;
  nextReviewAt?: string | null;
  status?: MistakeStatus;
  lastReviewAt?: string | null;
  lastReviewResult?: ReviewResult | null;
}

export interface UpdateReviewProgressInTransactionParams {
  mistakeId: string;
  oldReviewCount: number;
  newReviewCount: number;
  newStatus: MistakeStatus;
  nextReviewAt?: string | null;
  lastReviewAt?: string | null;
  lastReviewResult?: ReviewResult | null;
  updatedAt: string;
}

export interface UpdateLastReviewResultInTransactionParams {
  mistakeId: string;
  lastReviewResult: ReviewResult | null;
  updatedAt: string;
}

export interface MoveMistakeToModuleParams {
  mistakeId: string;
  module: string;
  moduleId: number;
}

type MistakeStatsRow = {
  total: number | null;
  collected: number | null;
  active: number | null;
  mastered: number | null;
  dueToday: number | null;
};

type CountRow = {
  total: number | null;
};

type ModuleCountRow = {
  module: string | null;
  total: number | null;
};

type ModuleIdCountRow = {
  module_id: number;
  total: number | null;
};

type TagCountRow = {
  name: string | null;
  normalized_name: string | null;
  total: number | null;
  latest_updated_at: string | null;
};

type ModuleQuestionCounterRow = {
  last_question_no: number | null;
};

type MaxQuestionNoRow = {
  max_question_no: number | null;
};

type QueryConditions = {
  whereSql: string;
  bindParams: (string | number)[];
};

const DEFAULT_LIST_LIMIT = 50;
const DEFAULT_LIST_OFFSET = 0;
const DEFAULT_SORT_BY: NonNullable<ListMistakesOptions['sortBy']> = 'updated_at';
const DEFAULT_SORT_ORDER: NonNullable<ListMistakesOptions['sortOrder']> = 'desc';
const DEFAULT_RECENT_LIMIT = 10;
const DEFAULT_ACTIVE_LIMIT = 50;
const DEFAULT_MASTERED_LIMIT = 50;
const BULK_REVIEW_PLAN_ID_BATCH_SIZE = 400;

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

function normalizeListLimit(value?: number | null): number | null | undefined {
  if (value === null) {
    return null;
  }
  return normalizeLimit(value);
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

function normalizeLimitOrDefault(value: number | undefined, defaultValue: number): number {
  const normalized = normalizeLimit(value);
  return normalized ?? defaultValue;
}

function normalizePositiveInteger(value: number, fieldName: string): number {
  const normalized = Math.floor(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }
  return normalized;
}

function normalizeRequiredModuleId(value: number): number {
  const normalized = Math.floor(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw new Error('moduleId must be a positive integer.');
  }
  return normalized;
}

function normalizeQuestionNo(value: number): number {
  const normalized = Math.floor(value);
  if (!Number.isFinite(normalized) || normalized < 1 || normalized > MODULE_QUESTION_MAX_NUMBER) {
    throw new Error(`question_no must be an integer between 1 and ${MODULE_QUESTION_MAX_NUMBER}.`);
  }
  return normalized;
}

function normalizeReviewResultOrNull(value: ReviewResult | null): ReviewResult | null {
  if (value === null) {
    return null;
  }
  if (REVIEW_RESULT_VALUES.includes(value)) {
    return value;
  }
  throw new Error('lastReviewResult must be mastered / unsure / wrong / null.');
}

function normalizePinnedFlag(value: boolean | number | null | undefined): boolean {
  return value === true || value === 1;
}

function toPinnedInteger(value: boolean | number | null | undefined): number {
  return normalizePinnedFlag(value) ? 1 : 0;
}

async function resolveBootstrapLastQuestionNoByModule(
  db: SQLite.SQLiteDatabase,
  moduleId: number,
): Promise<number> {
  const row = await db.getFirstAsync<MaxQuestionNoRow>(
    `SELECT MAX(question_no) AS max_question_no
FROM mistakes
WHERE module_id = ?;`,
    moduleId,
  );
  return Math.max(0, Math.floor(Number(row?.max_question_no ?? 0)));
}

async function reserveQuestionNumbersByModuleInTransactionInternal(
  db: SQLite.SQLiteDatabase,
  moduleIdInput: number,
  countInput: number,
): Promise<number[]> {
  const moduleId = normalizeRequiredModuleId(moduleIdInput);
  const count = normalizePositiveInteger(countInput, 'count');
  const now = nowIso();

  const counterRow = await db.getFirstAsync<ModuleQuestionCounterRow>(
    `SELECT last_question_no
FROM module_question_counters
WHERE module_id = ?
LIMIT 1;`,
    moduleId,
  );

  let currentLastQuestionNo: number;
  if (counterRow && typeof counterRow.last_question_no === 'number') {
    currentLastQuestionNo = Math.max(0, Math.floor(counterRow.last_question_no));
  } else {
    currentLastQuestionNo = await resolveBootstrapLastQuestionNoByModule(db, moduleId);
  }

  const nextLastQuestionNo = currentLastQuestionNo + count;
  if (nextLastQuestionNo > MODULE_QUESTION_MAX_NUMBER) {
    throw new Error(`该模块最多只能录入 ${MODULE_QUESTION_MAX_NUMBER} 道错题。`);
  }
  await db.runAsync(
    `INSERT INTO module_question_counters (module_id, last_question_no, updated_at)
VALUES (?, ?, ?)
ON CONFLICT(module_id) DO UPDATE
SET last_question_no = excluded.last_question_no,
    updated_at = excluded.updated_at;`,
    moduleId,
    nextLastQuestionNo,
    now,
  );

  return Array.from({ length: count }, (_, index) => currentLastQuestionNo + index + 1);
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

function normalizeIsoDateTime(value: string, fieldName: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    throw new Error(`${fieldName} must be a non-empty ISO datetime string.`);
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${fieldName} must be a valid datetime string.`);
  }

  return trimmed;
}

function mapMistakeRow(row: Mistake): Mistake {
  return {
    ...row,
    module_id: Number(row.module_id),
    question_no: Number(row.question_no),
    difficulty: Number(row.difficulty),
    review_count: Number(row.review_count),
    status: row.status as MistakeStatus,
    is_pinned: normalizePinnedFlag(row.is_pinned as unknown as boolean | number | null | undefined),
    last_viewed_at: row.last_viewed_at ?? null,
  };
}

function buildTitleAfterModuleMove(
  currentTitle: string | null | undefined,
  currentModule: string,
  nextModule: string,
  nextQuestionNo: number,
): string | null {
  const normalizedTitle = typeof currentTitle === 'string' ? currentTitle.trim() : '';
  if (!normalizedTitle) {
    return currentTitle ?? null;
  }
  const canonicalPrefix = `${currentModule.trim()} · `;
  if (normalizedTitle.startsWith(canonicalPrefix)) {
    const suffix = normalizedTitle.slice(canonicalPrefix.length);
    if (/^第\s*\d+\s*题$/u.test(suffix)) {
      return `${nextModule} · 第 ${nextQuestionNo} 题`;
    }
  }
  return currentTitle ?? null;
}

async function getByIdInternal(
  db: SQLite.SQLiteDatabase,
  id: string,
): Promise<Mistake | null> {
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

async function createMistakeInDatabase(
  db: SQLite.SQLiteDatabase,
  input: CreateMistakeInput,
): Promise<Mistake> {
  const createdAt = nowIso();
  const inputId = input.id?.trim();
  const status = input.status ?? REVIEW_STATUS.COLLECTED;
  const nextReviewAt =
    input.next_review_at === undefined
      ? status === REVIEW_STATUS.ACTIVE
        ? createdAt
        : null
      : input.next_review_at;
  const record: Mistake = {
    id: inputId && inputId.length > 0 ? inputId : buildMistakeId(),
    subject: input.subject?.trim() || DEFAULT_SUBJECT,
    module: input.module,
    module_id: normalizeRequiredModuleId(input.module_id),
    question_no: normalizeQuestionNo(input.question_no),
    title: input.title ?? null,
    error_reason: input.error_reason ?? null,
    error_reason_ids: input.error_reason_ids ?? null,
    difficulty: normalizeDifficulty(input.difficulty),
    note: input.note ?? null,
    my_solution_text: input.my_solution_text ?? null,
    answer_text: input.answer_text ?? null,
    note_highlights: input.note_highlights ?? null,
    review_count: 0,
    status,
    created_at: createdAt,
    updated_at: createdAt,
    next_review_at: nextReviewAt,
    last_review_at: input.last_review_at ?? null,
    last_review_result: input.last_review_result ?? null,
    is_pinned: input.is_pinned ?? false,
    last_viewed_at: input.last_viewed_at ?? null,
  };

  await db.runAsync(
    INSERT_MISTAKE_SQL,
    record.id,
    record.subject,
    record.module,
    record.module_id,
    record.question_no,
    record.title ?? null,
    record.error_reason ?? null,
    record.error_reason_ids ?? null,
    record.difficulty,
    record.note ?? null,
    record.my_solution_text ?? null,
    record.answer_text ?? null,
    record.note_highlights ?? null,
    record.review_count,
    record.status,
    record.created_at,
    record.updated_at,
    record.next_review_at ?? null,
    record.last_review_at ?? null,
    record.last_review_result ?? null,
    toPinnedInteger(record.is_pinned),
    record.last_viewed_at ?? null,
  );

  const created = await getByIdInternal(db, record.id);
  if (!created) {
    throw new Error('Failed to load the created mistake record.');
  }

  return created;
}

function normalizeKeyword(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeModuleFilter(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeTagKeys(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const key = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLocaleLowerCase() : '';
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(key);
  }
  return normalized;
}

function normalizeStatusFilter(
  value: ListMistakesOptions['status'] | undefined,
): MistakeStatus | 'all' {
  if (
    value === REVIEW_STATUS.COLLECTED ||
    value === REVIEW_STATUS.ACTIVE ||
    value === REVIEW_STATUS.MASTERED ||
    value === REVIEW_STATUS.ARCHIVED ||
    value === 'all'
  ) {
    return value;
  }
  return 'all';
}

function normalizeSortBy(
  value: ListMistakesOptions['sortBy'] | undefined,
): NonNullable<ListMistakesOptions['sortBy']> {
  if (
    value === 'created_at' ||
    value === 'updated_at' ||
    value === 'next_review_at' ||
    value === 'review_count' ||
    value === 'last_viewed_at'
  ) {
    return value;
  }
  return DEFAULT_SORT_BY;
}

function normalizeSortOrder(
  value: ListMistakesOptions['sortOrder'] | undefined,
): NonNullable<ListMistakesOptions['sortOrder']> {
  if (value === 'asc' || value === 'desc') {
    return value;
  }
  return DEFAULT_SORT_ORDER;
}

function buildOrderByClause(options?: ListMistakesOptions): string {
  const sortBy = normalizeSortBy(options?.sortBy);
  const sortOrder = normalizeSortOrder(options?.sortOrder);
  const sortOrderSql = sortOrder === 'asc' ? 'ASC' : 'DESC';

  return `ORDER BY ${sortBy} ${sortOrderSql}`;
}

function buildListConditions(options?: ListMistakesOptions): QueryConditions {
  const whereClauses: string[] = [];
  const bindParams: (string | number)[] = [];
  const dueOnly = options?.dueOnly === true;

  if (dueOnly) {
    const todayIsoDate = new Date().toISOString().slice(0, 10);
    whereClauses.push('status = ?');
    bindParams.push(REVIEW_STATUS.ACTIVE);
    whereClauses.push('next_review_at IS NOT NULL');
    whereClauses.push('next_review_at <= ?');
    bindParams.push(normalizeDueCutoff(todayIsoDate));
  } else {
    const status = normalizeStatusFilter(options?.status);
    if (status !== 'all') {
      whereClauses.push('status = ?');
      bindParams.push(status);
    }
  }

  const moduleFilter = normalizeModuleFilter(options?.module);
  if (moduleFilter) {
    whereClauses.push(`module_id = (
  SELECT module_filter.id FROM modules module_filter WHERE module_filter.name = ? LIMIT 1
)`);
    bindParams.push(moduleFilter);
  }

  if (options?.moduleId !== null && options?.moduleId !== undefined) {
    if (!Number.isInteger(options.moduleId) || options.moduleId <= 0) {
      throw new Error('moduleId must be a positive integer.');
    }
    whereClauses.push('module_id = ?');
    bindParams.push(options.moduleId);
  }

  const keyword = normalizeKeyword(options?.keyword);
  if (keyword) {
    const parsedQuestionCode = parseMistakeDisplayCode(keyword);
    if (parsedQuestionCode) {
      whereClauses.push(`(
  question_no = ?
  AND EXISTS (
    SELECT 1 FROM modules module_code_search
    WHERE module_code_search.id = mistakes.module_id
      AND UPPER(module_code_search.display_code) = ?
  )
)`);
      bindParams.push(
        parsedQuestionCode.questionNo,
        parsedQuestionCode.moduleDisplayCode,
      );
    } else {
      const likeKeyword = `%${keyword}%`;
      const likeTagKeyword = `%${keyword.toLocaleLowerCase()}%`;
      whereClauses.push(`(
  title LIKE ?
  OR EXISTS (
    SELECT 1 FROM modules module_search
    WHERE module_search.id = mistakes.module_id AND module_search.name LIKE ?
  )
  OR error_reason LIKE ?
  OR note LIKE ?
  OR my_solution_text LIKE ?
  OR answer_text LIKE ?
  OR EXISTS (
    SELECT 1
    FROM review_records review_note_search
    WHERE review_note_search.mistake_id = mistakes.id
      AND review_note_search.note LIKE ?
  )
  OR EXISTS (
    SELECT 1
    FROM mistake_tags tag_search
    WHERE tag_search.mistake_id = mistakes.id
      AND (
        tag_search.name LIKE ?
        OR tag_search.normalized_name LIKE ?
      )
  )
)`);
      bindParams.push(
        likeKeyword,
        likeKeyword,
        likeKeyword,
        likeKeyword,
        likeKeyword,
        likeKeyword,
        likeKeyword,
        likeKeyword,
        likeTagKeyword,
      );
    }
  }

  const tagKeys = normalizeTagKeys(options?.tagKeys);
  tagKeys.forEach((tagKey, index) => {
    whereClauses.push(`EXISTS (
  SELECT 1
  FROM mistake_tags tag_filter_${index}
  WHERE tag_filter_${index}.mistake_id = mistakes.id
    AND tag_filter_${index}.normalized_name = ?
)`);
    bindParams.push(tagKey);
  });

  if (whereClauses.length === 0) {
    return {
      whereSql: '',
      bindParams,
    };
  }

  return {
    whereSql: `\nWHERE ${whereClauses.join('\n  AND ')}`,
    bindParams,
  };
}

function buildMistakesSubqueryWhere(conditions: QueryConditions, relationSql: string): string {
  if (!conditions.whereSql) {
    return `\nWHERE ${relationSql}`;
  }

  return `${conditions.whereSql}
  AND ${relationSql}`;
}

export const MistakeRepository = {
  async reserveNextQuestionNumbersByModule(
    moduleId: number,
    count = 1,
  ): Promise<number[]> {
    try {
      await ensureDatabaseReady();
      return await withDatabaseTransaction(async (db) =>
        reserveQuestionNumbersByModuleInTransactionInternal(db, moduleId, count),
      );
    } catch (error) {
      Logger.error(REPO_SCOPE, 'reserveNextQuestionNumbersByModule failed.', {
        moduleId,
        count,
        error,
      });
      throw error;
    }
  },

  async reserveNextQuestionNumbersByModuleInTransaction(
    db: SQLite.SQLiteDatabase,
    moduleId: number,
    count = 1,
  ): Promise<number[]> {
    try {
      return await reserveQuestionNumbersByModuleInTransactionInternal(db, moduleId, count);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'reserveNextQuestionNumbersByModuleInTransaction failed.', {
        moduleId,
        count,
        error,
      });
      throw error;
    }
  },

  async createMistake(input: CreateMistakeInput): Promise<Mistake> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      return await createMistakeInDatabase(db, input);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'createMistake failed.', error);
      throw error;
    }
  },

  async createMistakeInTransaction(
    db: SQLite.SQLiteDatabase,
    input: CreateMistakeInput,
  ): Promise<Mistake> {
    try {
      return await createMistakeInDatabase(db, input);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'createMistakeInTransaction failed.', error);
      throw error;
    }
  },

  async moveMistakeToModule(params: MoveMistakeToModuleParams): Promise<Mistake | null> {
    try {
      await ensureDatabaseReady();
      return await withDatabaseTransaction(async (db) => {
        const current = await getByIdInternal(db, params.mistakeId);
        if (!current) {
          return null;
        }
        const moduleId = normalizeRequiredModuleId(params.moduleId);
        const moduleName = params.module.trim();
        if (!moduleName) {
          throw new Error('module must be a non-empty string.');
        }
        if (current.module_id === moduleId) {
          await db.runAsync(
            `UPDATE mistakes
SET module = ?, updated_at = ?
WHERE id = ?;`,
            moduleName,
            nowIso(),
            params.mistakeId,
          );
          return getByIdInternal(db, params.mistakeId);
        }
        const [questionNo] = await reserveQuestionNumbersByModuleInTransactionInternal(
          db,
          moduleId,
          1,
        );
        const nextTitle = buildTitleAfterModuleMove(
          current.title,
          current.module,
          moduleName,
          questionNo,
        );
        await db.runAsync(
          `UPDATE mistakes
SET module = ?, module_id = ?, question_no = ?, title = ?, updated_at = ?
WHERE id = ?;`,
          moduleName,
          moduleId,
          questionNo,
          nextTitle,
          nowIso(),
          params.mistakeId,
        );
        return getByIdInternal(db, params.mistakeId);
      });
    } catch (error) {
      Logger.error(REPO_SCOPE, 'moveMistakeToModule failed.', { params, error });
      throw error;
    }
  },

  async getMistakeById(id: string): Promise<Mistake | null> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      return await getByIdInternal(db, id);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'getMistakeById failed.', { id, error });
      throw error;
    }
  },

  async listMistakes(options?: ListMistakesOptions): Promise<Mistake[]> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();

      const conditions = buildListConditions(options);
      const orderByClause = buildOrderByClause(options);
      const normalizedLimit = normalizeListLimit(options?.limit);
      const normalizedOffset = normalizeOffset(options?.offset);
      const paginationParams: number[] = [];
      let paginationSql = '';
      if (normalizedLimit === null) {
        if (normalizedOffset !== undefined) {
          paginationSql = '\nLIMIT -1\nOFFSET ?';
          paginationParams.push(normalizedOffset);
        }
      } else {
        paginationSql = '\nLIMIT ?\nOFFSET ?';
        paginationParams.push(
          normalizedLimit ?? DEFAULT_LIST_LIMIT,
          normalizedOffset ?? DEFAULT_LIST_OFFSET,
        );
      }

      const rows = await db.getAllAsync<Mistake>(
        `${SELECT_MISTAKE_FIELDS_SQL}${conditions.whereSql}
${orderByClause}
${paginationSql};`,
        ...conditions.bindParams,
        ...paginationParams,
      );

      return rows.map(mapMistakeRow);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'listMistakes failed.', { options, error });
      throw error;
    }
  },

  async countMistakes(options?: ListMistakesOptions): Promise<number> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const conditions = buildListConditions(options);

      const row = await db.getFirstAsync<CountRow>(
        `SELECT COUNT(*) AS total
FROM mistakes${conditions.whereSql};`,
        ...conditions.bindParams,
      );

      return Number(row?.total ?? 0);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'countMistakes failed.', { options, error });
      throw error;
    }
  },

  async countMistakesByModule(options?: ListMistakesOptions): Promise<MistakeModuleCount[]> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const conditions = buildListConditions(options);

      const rows = await db.getAllAsync<ModuleCountRow>(
        `SELECT COALESCE(module_lookup.name, mistakes.module) AS module, COUNT(*) AS total
FROM mistakes
LEFT JOIN modules module_lookup ON module_lookup.id = mistakes.module_id${conditions.whereSql}
GROUP BY mistakes.module_id, COALESCE(module_lookup.name, mistakes.module)
ORDER BY total DESC, module ASC;`,
        ...conditions.bindParams,
      );

      return rows.reduce<MistakeModuleCount[]>((moduleCounts, row) => {
        const moduleName = normalizeModuleFilter(row.module);
        if (!moduleName) {
          return moduleCounts;
        }
        moduleCounts.push({
          module: moduleName,
          count: Number(row.total ?? 0),
        });
        return moduleCounts;
      }, []);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'countMistakesByModule failed.', { options, error });
      throw error;
    }
  },

  async countMistakesByModuleId(): Promise<MistakeModuleIdCount[]> {
    try {
      await ensureDatabaseReady();
      const rows = await (await getDatabase()).getAllAsync<ModuleIdCountRow>(
        `SELECT module_id, COUNT(*) AS total
FROM mistakes
GROUP BY module_id
ORDER BY module_id ASC;`,
      );
      return rows.map((row) => ({
        moduleId: Number(row.module_id),
        count: Number(row.total ?? 0),
      }));
    } catch (error) {
      Logger.error(REPO_SCOPE, 'countMistakesByModuleId failed.', error);
      throw error;
    }
  },

  async countMistakeTags(options?: ListMistakesOptions): Promise<MistakeTagCount[]> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const conditions = buildListConditions(options);
      const subqueryWhere = buildMistakesSubqueryWhere(conditions, 'mistakes.id = tag.mistake_id');

      const rows = await db.getAllAsync<TagCountRow>(
        `SELECT
  tag.normalized_name,
  MIN(tag.name) AS name,
  COUNT(DISTINCT tag.mistake_id) AS total,
  MAX(tag.updated_at) AS latest_updated_at
FROM mistake_tags tag
WHERE EXISTS (
  SELECT 1
  FROM mistakes${subqueryWhere}
)
GROUP BY tag.normalized_name
ORDER BY total DESC, latest_updated_at DESC, name ASC;`,
        ...conditions.bindParams,
      );

      return rows.reduce<MistakeTagCount[]>((tagCounts, row) => {
        const normalizedName = normalizeModuleFilter(row.normalized_name);
        const name = normalizeModuleFilter(row.name);
        const count = Number(row.total ?? 0);
        if (!normalizedName || !name || count <= 0) {
          return tagCounts;
        }
        tagCounts.push({
          name,
          normalizedName,
          count,
          latestUpdatedAt: row.latest_updated_at ?? null,
        });
        return tagCounts;
      }, []);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'countMistakeTags failed.', { options, error });
      throw error;
    }
  },

  async listRecentMistakes(limit?: number): Promise<Mistake[]> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const normalizedLimit = normalizeLimitOrDefault(limit, DEFAULT_RECENT_LIMIT);

      const rows = await db.getAllAsync<Mistake>(
        `${SELECT_MISTAKE_FIELDS_SQL}
ORDER BY created_at DESC
LIMIT ?;`,
        normalizedLimit,
      );

      return rows.map(mapMistakeRow);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'listRecentMistakes failed.', { limit, error });
      throw error;
    }
  },

  async listActiveMistakes(limit?: number): Promise<Mistake[]> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const normalizedLimit = normalizeLimitOrDefault(limit, DEFAULT_ACTIVE_LIMIT);

      const rows = await db.getAllAsync<Mistake>(
        `${SELECT_MISTAKE_FIELDS_SQL}
WHERE status = ?
ORDER BY next_review_at ASC, created_at ASC
LIMIT ?;`,
        REVIEW_STATUS.ACTIVE,
        normalizedLimit,
      );

      return rows.map(mapMistakeRow);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'listActiveMistakes failed.', { limit, error });
      throw error;
    }
  },

  async listMasteredMistakes(limit?: number): Promise<Mistake[]> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const normalizedLimit = normalizeLimitOrDefault(limit, DEFAULT_MASTERED_LIMIT);

      const rows = await db.getAllAsync<Mistake>(
        `${SELECT_MISTAKE_FIELDS_SQL}
WHERE status = ?
ORDER BY updated_at DESC
LIMIT ?;`,
        REVIEW_STATUS.MASTERED,
        normalizedLimit,
      );

      return rows.map(mapMistakeRow);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'listMasteredMistakes failed.', { limit, error });
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

  async listTodayReviewQueue(query: TodayReviewQueueQuery): Promise<Mistake[]> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const normalizedStart = normalizeIsoDateTime(query.todayStartIso, 'todayStartIso');
      const normalizedEnd = normalizeIsoDateTime(query.todayEndIso, 'todayEndIso');
      const limit = normalizeLimit(query.limit);
      const offset = normalizeOffset(query.offset);
      let paginationSql = '';
      const paginationParams: number[] = [];
      if (limit !== undefined) {
        paginationSql = '\nLIMIT ?';
        paginationParams.push(limit);
        if (offset !== undefined) {
          paginationSql += '\nOFFSET ?';
          paginationParams.push(offset);
        }
      } else if (offset !== undefined) {
        paginationSql = '\nLIMIT -1\nOFFSET ?';
        paginationParams.push(offset);
      }

      const rows = await db.getAllAsync<Mistake>(
        `${SELECT_MISTAKE_FIELDS_SQL}
WHERE mistakes.status = ?
  AND mistakes.next_review_at IS NOT NULL
  AND mistakes.next_review_at <= ?
  AND NOT EXISTS (
    SELECT 1
    FROM review_records r
    WHERE r.mistake_id = mistakes.id
      AND r.created_at >= ?
      AND r.created_at <= ?
      AND r.review_index = CASE
        WHEN mistakes.review_count + 1 > ? THEN ?
        ELSE mistakes.review_count + 1
      END
  )
ORDER BY
  mistakes.next_review_at ASC,
  CASE mistakes.last_review_result
    WHEN 'wrong' THEN 0
    WHEN 'unsure' THEN 1
    ELSE 2
  END ASC,
  mistakes.created_at ASC${paginationSql};`,
        REVIEW_STATUS.ACTIVE,
        normalizedEnd,
        normalizedStart,
        normalizedEnd,
        MAX_REVIEW_COUNT,
        MAX_REVIEW_COUNT,
        ...paginationParams,
      );

      return rows.map(mapMistakeRow);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'listTodayReviewQueue failed.', { query, error });
      throw error;
    }
  },

  async listActiveMistakesByNextReviewRange(query: NextReviewRangeQuery): Promise<Mistake[]> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const normalizedStart = normalizeIsoDateTime(query.startInclusiveIso, 'startInclusiveIso');
      const normalizedEnd = normalizeIsoDateTime(query.endInclusiveIso, 'endInclusiveIso');
      const limit = normalizeLimit(query.limit);
      const offset = normalizeOffset(query.offset);
      let paginationSql = '';
      const paginationParams: number[] = [];
      if (limit !== undefined) {
        paginationSql = '\nLIMIT ?';
        paginationParams.push(limit);
        if (offset !== undefined) {
          paginationSql += '\nOFFSET ?';
          paginationParams.push(offset);
        }
      } else if (offset !== undefined) {
        paginationSql = '\nLIMIT -1\nOFFSET ?';
        paginationParams.push(offset);
      }

      const rows = await db.getAllAsync<Mistake>(
        `${SELECT_MISTAKE_FIELDS_SQL}
WHERE status = ?
  AND next_review_at IS NOT NULL
  AND next_review_at >= ?
  AND next_review_at <= ?
ORDER BY next_review_at ASC, created_at ASC
${paginationSql};`,
        REVIEW_STATUS.ACTIVE,
        normalizedStart,
        normalizedEnd,
        ...paginationParams,
      );

      return rows.map(mapMistakeRow);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'listActiveMistakesByNextReviewRange failed.', { query, error });
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
  SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS collected,
  SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS active,
  SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS mastered,
  SUM(CASE WHEN status = ? AND next_review_at IS NOT NULL AND next_review_at <= ? THEN 1 ELSE 0 END) AS dueToday
FROM mistakes;`,
        REVIEW_STATUS.COLLECTED,
        REVIEW_STATUS.ACTIVE,
        REVIEW_STATUS.MASTERED,
        REVIEW_STATUS.ACTIVE,
        cutoff,
      );

      return {
        total: Number(row?.total ?? 0),
        collected: Number(row?.collected ?? 0),
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
        'module_id',
        'question_no',
        'title',
        'error_reason',
        'error_reason_ids',
        'difficulty',
        'note',
        'my_solution_text',
        'answer_text',
        'note_highlights',
        'review_count',
        'status',
        'next_review_at',
        'last_review_at',
        'last_review_result',
        'is_pinned',
        'last_viewed_at',
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

        if (field === 'module_id') {
          setClauses.push(`${field} = ?`);
          bindParams.push(normalizeRequiredModuleId(fieldValue as number));
          continue;
        }

        if (field === 'question_no') {
          setClauses.push(`${field} = ?`);
          bindParams.push(normalizeQuestionNo(fieldValue as number));
          continue;
        }

        if (field === 'is_pinned') {
          setClauses.push(`${field} = ?`);
          bindParams.push(toPinnedInteger(fieldValue as boolean));
          continue;
        }

        setClauses.push(`${field} = ?`);
        bindParams.push(fieldValue as string | number | null);
      }

      if (setClauses.length === 0) {
        return await getByIdInternal(db, id);
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

      return await getByIdInternal(db, id);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'updateMistake failed.', { id, input, error });
      throw error;
    }
  },

  async setMistakePinned(id: string, isPinned: boolean): Promise<Mistake | null> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const result = await db.runAsync(
        `UPDATE mistakes
SET is_pinned = ?, updated_at = ?
WHERE id = ?;`,
        toPinnedInteger(isPinned),
        nowIso(),
        id,
      );

      if (result.changes <= 0) {
        return null;
      }

      return await getByIdInternal(db, id);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'setMistakePinned failed.', { id, isPinned, error });
      throw error;
    }
  },

  async joinMistakeReviewPlan(id: string, nextReviewAt = nowIso()): Promise<Mistake | null> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const updatedAt = nowIso();
      const normalizedNextReviewAt = normalizeIsoDateTime(nextReviewAt, 'nextReviewAt');
      const result = await db.runAsync(
        `UPDATE mistakes
SET review_count = 0,
  status = ?,
  next_review_at = ?,
  last_review_at = NULL,
  last_review_result = NULL,
  updated_at = ?
WHERE id = ? AND status = ?;`,
        REVIEW_STATUS.ACTIVE,
        normalizedNextReviewAt,
        updatedAt,
        id,
        REVIEW_STATUS.COLLECTED,
      );

      if (result.changes <= 0) {
        return null;
      }

      return await getByIdInternal(db, id);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'joinMistakeReviewPlan failed.', { id, nextReviewAt, error });
      throw error;
    }
  },

  async joinMistakesReviewPlan(
    ids: readonly string[],
    nextReviewAt = nowIso(),
  ): Promise<number> {
    const normalizedIds = Array.from(new Set(
      ids.map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean),
    ));
    if (normalizedIds.length <= 0) {
      return 0;
    }

    try {
      await ensureDatabaseReady();
      const normalizedNextReviewAt = normalizeIsoDateTime(nextReviewAt, 'nextReviewAt');
      const updatedAt = nowIso();

      return await withDatabaseTransaction(async (db) => {
        let joinedCount = 0;
        for (let start = 0; start < normalizedIds.length; start += BULK_REVIEW_PLAN_ID_BATCH_SIZE) {
          const batchIds = normalizedIds.slice(start, start + BULK_REVIEW_PLAN_ID_BATCH_SIZE);
          const placeholders = batchIds.map(() => '?').join(', ');
          const result = await db.runAsync(
            `UPDATE mistakes
SET review_count = 0,
  status = ?,
  next_review_at = ?,
  last_review_at = NULL,
  last_review_result = NULL,
  updated_at = ?
WHERE status = ? AND id IN (${placeholders});`,
            REVIEW_STATUS.ACTIVE,
            normalizedNextReviewAt,
            updatedAt,
            REVIEW_STATUS.COLLECTED,
            ...batchIds,
          );
          joinedCount += result.changes;
        }
        return joinedCount;
      });
    } catch (error) {
      Logger.error(REPO_SCOPE, 'joinMistakesReviewPlan failed.', {
        requestedCount: normalizedIds.length,
        nextReviewAt,
        error,
      });
      throw error;
    }
  },

  async updateLastViewedAt(id: string, viewedAt = nowIso()): Promise<boolean> {
    try {
      await ensureDatabaseReady();
      const db = await getDatabase();
      const result = await db.runAsync(
        `UPDATE mistakes
SET last_viewed_at = ?
WHERE id = ?;`,
        normalizeIsoDateTime(viewedAt, 'viewedAt'),
        id,
      );
      return result.changes > 0;
    } catch (error) {
      Logger.error(REPO_SCOPE, 'updateLastViewedAt failed.', { id, viewedAt, error });
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
      if (params.lastReviewAt !== undefined) {
        input.last_review_at = params.lastReviewAt;
      }
      if (params.lastReviewResult !== undefined) {
        input.last_review_result = params.lastReviewResult;
      }

      return await MistakeRepository.updateMistake(params.mistakeId, input);
    } catch (error) {
      Logger.error(REPO_SCOPE, 'updateReviewProgress failed.', { params, error });
      throw error;
    }
  },

  async updateReviewProgressInTransaction(
    db: SQLite.SQLiteDatabase,
    params: UpdateReviewProgressInTransactionParams,
  ): Promise<number> {
    try {
      const normalizedOldReviewCount = normalizeReviewCount(params.oldReviewCount);
      const normalizedNewReviewCount = normalizeReviewCount(params.newReviewCount);
      const nextReviewAt = params.nextReviewAt ?? null;
      const lastReviewAt = params.lastReviewAt ?? null;
      const lastReviewResult = params.lastReviewResult ?? null;

      const result = await db.runAsync(
        `UPDATE mistakes
SET review_count = ?, status = ?, next_review_at = ?, last_review_at = ?, last_review_result = ?, updated_at = ?
WHERE id = ? AND review_count = ? AND status = ?;`,
        normalizedNewReviewCount,
        params.newStatus,
        nextReviewAt,
        lastReviewAt,
        lastReviewResult,
        params.updatedAt,
        params.mistakeId,
        normalizedOldReviewCount,
        REVIEW_STATUS.ACTIVE,
      );

      return result.changes;
    } catch (error) {
      Logger.error(REPO_SCOPE, 'updateReviewProgressInTransaction failed.', { params, error });
      throw error;
    }
  },

  async updateLastReviewResultInTransaction(
    db: SQLite.SQLiteDatabase,
    params: UpdateLastReviewResultInTransactionParams,
  ): Promise<number> {
    try {
      const normalizedMistakeId = typeof params.mistakeId === 'string' ? params.mistakeId.trim() : '';
      if (!normalizedMistakeId) {
        throw new Error('mistakeId must be a non-empty string.');
      }

      const updatedAt = normalizeIsoDateTime(params.updatedAt, 'updatedAt');
      const lastReviewResult = normalizeReviewResultOrNull(params.lastReviewResult);
      const result = await db.runAsync(
        `UPDATE mistakes
SET last_review_result = ?, updated_at = ?
WHERE id = ?;`,
        lastReviewResult,
        updatedAt,
        normalizedMistakeId,
      );

      return result.changes;
    } catch (error) {
      Logger.error(REPO_SCOPE, 'updateLastReviewResultInTransaction failed.', { params, error });
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

import type * as SQLite from 'expo-sqlite';

import {
  CUSTOM_MODULE_ID_START,
  CUSTOM_MODULE_MAX_NUMBER,
  SYSTEM_MODULE_DEFINITIONS,
  UNCLASSIFIED_MODULE_DISPLAY_CODE,
  UNCLASSIFIED_MODULE_ID,
  UNCLASSIFIED_MODULE_NAME,
  formatCustomModuleDisplayCode,
  resolveSystemModuleByLegacyIdOrName,
} from '@/src/constants/modules';
import {
  CREATE_MISTAKES_TABLE_SQL,
  CREATE_MODULES_TABLE_SQL,
  CREATE_MODULE_QUESTION_COUNTERS_TABLE_SQL,
} from '@/src/db/schema';
import { BRAND_ACCENT } from '@/src/styles/tokens';

const DEFAULT_MODULE_ICON = 'label';

type TableColumnRow = {
  name: string;
};

type TableNameRow = {
  name: string;
};

type ForeignKeyViolationRow = {
  table: string;
  rowid: number | null;
  parent: string;
};

type LegacyCustomModuleRow = {
  id: string;
  name: string;
  icon: string;
  color: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type LegacyCounterRow = {
  module: string;
  last_question_no: number;
  updated_at: string;
};

type LegacyMistakeRow = {
  id: string;
  subject: string;
  module: string;
  module_id: string | number | null;
  title: string | null;
  error_reason: string | null;
  error_reason_ids: string | null;
  difficulty: number;
  note: string | null;
  my_solution_text: string | null;
  answer_text: string | null;
  note_highlights: string | null;
  review_count: number;
  status: string;
  created_at: string;
  updated_at: string;
  next_review_at: string | null;
  last_review_at: string | null;
  last_review_result: string | null;
  is_pinned: number;
  last_viewed_at: string | null;
};

type ModuleSeed = {
  id: number;
  type: 'system' | 'custom' | 'unclassified';
  name: string;
  displayCode: string;
  customNo: number | null;
  icon: string;
  color: string;
  sortOrder: number;
  isActive: number;
  createdAt: string;
  updatedAt: string;
  legacyIds: string[];
};

type MigratedMistake = LegacyMistakeRow & {
  permanentModuleId: number;
  questionNo: number;
};

function nowIso(): string {
  return new Date().toISOString();
}

async function tableExists(db: SQLite.SQLiteDatabase, tableName: string): Promise<boolean> {
  const row = await db.getFirstAsync<TableNameRow>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1;",
    tableName,
  );
  return row?.name === tableName;
}

export async function isPermanentModuleSchemaReady(db: SQLite.SQLiteDatabase): Promise<boolean> {
  if (!(await tableExists(db, 'modules')) || !(await tableExists(db, 'mistakes'))) {
    return false;
  }
  const mistakeColumns = await db.getAllAsync<TableColumnRow>('PRAGMA table_info(mistakes);');
  const counterColumns = await db.getAllAsync<TableColumnRow>(
    'PRAGMA table_info(module_question_counters);',
  );
  return mistakeColumns.some((row) => row.name === 'question_no')
    && counterColumns.some((row) => row.name === 'module_id');
}

async function insertModuleSeed(db: SQLite.SQLiteDatabase, seed: ModuleSeed): Promise<void> {
  await db.runAsync(
    `INSERT INTO modules (
  id, type, name, display_code, custom_no, icon, color,
  sort_order, is_active, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO NOTHING;`,
    seed.id,
    seed.type,
    seed.name,
    seed.displayCode,
    seed.customNo,
    seed.icon,
    seed.color,
    seed.sortOrder,
    seed.isActive,
    seed.createdAt,
    seed.updatedAt,
  );
}

export async function seedPermanentModules(db: SQLite.SQLiteDatabase): Promise<void> {
  const timestamp = nowIso();
  await db.execAsync(CREATE_MODULES_TABLE_SQL);
  for (const item of SYSTEM_MODULE_DEFINITIONS) {
    await insertModuleSeed(db, {
      id: item.id,
      type: 'system',
      name: item.name,
      displayCode: item.displayCode,
      customNo: null,
      icon: DEFAULT_MODULE_ICON,
      color: BRAND_ACCENT,
      sortOrder: item.sortOrder,
      isActive: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      legacyIds: [item.legacyId],
    });
  }
  await insertModuleSeed(db, {
    id: UNCLASSIFIED_MODULE_ID,
    type: 'unclassified',
    name: UNCLASSIFIED_MODULE_NAME,
    displayCode: UNCLASSIFIED_MODULE_DISPLAY_CODE,
    customNo: null,
    icon: DEFAULT_MODULE_ICON,
    color: BRAND_ACCENT,
    sortOrder: SYSTEM_MODULE_DEFINITIONS.length,
    isActive: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    legacyIds: [],
  });
}

function normalizeName(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseLegacyQuestionNo(title: string | null): number | null {
  const normalized = normalizeName(title);
  const matched = normalized.match(/第\s*(\d+)\s*题\s*$/u);
  if (!matched) {
    return null;
  }
  const parsed = Number.parseInt(matched[1], 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 999 ? parsed : null;
}

function buildModuleSeeds(
  legacyCustomModules: LegacyCustomModuleRow[],
  legacyMistakes: LegacyMistakeRow[],
): ModuleSeed[] {
  const timestamp = nowIso();
  const seeds: ModuleSeed[] = SYSTEM_MODULE_DEFINITIONS.map((item) => ({
    id: item.id,
    type: 'system',
    name: item.name,
    displayCode: item.displayCode,
    customNo: null,
    icon: DEFAULT_MODULE_ICON,
    color: BRAND_ACCENT,
    sortOrder: item.sortOrder,
    isActive: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    legacyIds: [item.legacyId],
  }));
  seeds.push({
    id: UNCLASSIFIED_MODULE_ID,
    type: 'unclassified',
    name: UNCLASSIFIED_MODULE_NAME,
    displayCode: UNCLASSIFIED_MODULE_DISPLAY_CODE,
    customNo: null,
    icon: DEFAULT_MODULE_ICON,
    color: BRAND_ACCENT,
    sortOrder: SYSTEM_MODULE_DEFINITIONS.length,
    isActive: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    legacyIds: [],
  });

  const customSeeds: ModuleSeed[] = [];
  const knownCustomNames = new Set<string>();
  legacyCustomModules.forEach((item) => {
    const name = normalizeName(item.name);
    if (!name || knownCustomNames.has(name)) {
      return;
    }
    knownCustomNames.add(name);
    customSeeds.push({
      id: CUSTOM_MODULE_ID_START + customSeeds.length,
      type: 'custom',
      name,
      displayCode: '',
      customNo: 0,
      icon: normalizeName(item.icon) || DEFAULT_MODULE_ICON,
      color: normalizeName(item.color) || BRAND_ACCENT,
      sortOrder: Number(item.sort_order) || 0,
      isActive: 1,
      createdAt: normalizeName(item.created_at) || timestamp,
      updatedAt: normalizeName(item.updated_at) || timestamp,
      legacyIds: [normalizeName(item.id), `custom:${normalizeName(item.id)}`].filter(Boolean),
    });
  });

  const orphanNames = new Set<string>();
  legacyMistakes.forEach((mistake) => {
    const name = normalizeName(mistake.module) || UNCLASSIFIED_MODULE_NAME;
    const legacyModuleId = typeof mistake.module_id === 'string' ? mistake.module_id.trim() : '';
    if (
      name === UNCLASSIFIED_MODULE_NAME
      || resolveSystemModuleByLegacyIdOrName(
        legacyModuleId,
        name,
      )
      || knownCustomNames.has(name)
      || (legacyModuleId && customSeeds.some((seed) => seed.legacyIds.includes(legacyModuleId)))
      || orphanNames.has(name)
    ) {
      return;
    }
    orphanNames.add(name);
    customSeeds.push({
      id: CUSTOM_MODULE_ID_START + customSeeds.length,
      type: 'custom',
      name,
      displayCode: '',
      customNo: 0,
      icon: DEFAULT_MODULE_ICON,
      color: BRAND_ACCENT,
      sortOrder: customSeeds.length,
      isActive: 0,
      createdAt: normalizeName(mistake.created_at) || timestamp,
      updatedAt: normalizeName(mistake.updated_at) || timestamp,
      legacyIds: legacyModuleId ? [legacyModuleId] : [],
    });
  });

  if (customSeeds.length > CUSTOM_MODULE_MAX_NUMBER) {
    throw new Error(`自定义模块数量超过 ${CUSTOM_MODULE_MAX_NUMBER}，无法迁移。`);
  }
  customSeeds.forEach((seed, index) => {
    const customNo = index + 1;
    seed.customNo = customNo;
    seed.displayCode = formatCustomModuleDisplayCode(customNo);
  });
  return [...seeds, ...customSeeds];
}

function resolvePermanentModuleId(mistake: LegacyMistakeRow, seeds: ModuleSeed[]): number {
  const rawModuleId = mistake.module_id;
  if (typeof rawModuleId === 'number' && Number.isInteger(rawModuleId)) {
    const existing = seeds.find((seed) => seed.id === rawModuleId);
    if (existing) {
      return existing.id;
    }
  }
  const legacyId = typeof rawModuleId === 'string' ? rawModuleId.trim() : '';
  const moduleName = normalizeName(mistake.module) || UNCLASSIFIED_MODULE_NAME;
  const system = resolveSystemModuleByLegacyIdOrName(legacyId, moduleName);
  if (system) {
    return system.id;
  }
  if (moduleName === UNCLASSIFIED_MODULE_NAME) {
    return UNCLASSIFIED_MODULE_ID;
  }
  const byLegacyId = legacyId
    ? seeds.find((seed) => seed.legacyIds.includes(legacyId))
    : null;
  if (byLegacyId) {
    return byLegacyId.id;
  }
  return seeds.find((seed) => seed.name === moduleName)?.id ?? UNCLASSIFIED_MODULE_ID;
}

function migrateMistakeNumbers(
  mistakes: LegacyMistakeRow[],
  seeds: ModuleSeed[],
  legacyCounters: LegacyCounterRow[],
): { mistakes: MigratedMistake[]; counters: Map<number, number> } {
  const migrated = mistakes.map((mistake) => ({
    ...mistake,
    permanentModuleId: resolvePermanentModuleId(mistake, seeds),
    questionNo: 0,
  }));
  const counters = new Map<number, number>();
  const counterByName = new Map<string, number>();
  legacyCounters.forEach((counter) => {
    const name = normalizeName(counter.module);
    counterByName.set(name, Math.max(
      counterByName.get(name) ?? 0,
      Math.max(0, Math.floor(Number(counter.last_question_no) || 0)),
    ));
  });

  const grouped = new Map<number, MigratedMistake[]>();
  migrated.forEach((mistake) => {
    const list = grouped.get(mistake.permanentModuleId) ?? [];
    list.push(mistake);
    grouped.set(mistake.permanentModuleId, list);
  });

  grouped.forEach((items, moduleId) => {
    items.sort((left, right) => (
      left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id)
    ));
    const used = new Set<number>();
    items.forEach((item) => {
      const parsed = parseLegacyQuestionNo(item.title);
      if (parsed && !used.has(parsed)) {
        item.questionNo = parsed;
        used.add(parsed);
      }
    });
    const moduleNames = new Set(items.map((item) => normalizeName(item.module)));
    let lastQuestionNo = Math.max(0, ...used);
    moduleNames.forEach((name) => {
      lastQuestionNo = Math.max(lastQuestionNo, counterByName.get(name) ?? 0);
    });
    if (lastQuestionNo > 999) {
      throw new Error(`模块 ${items[0]?.module ?? moduleId} 的历史题号超过 999，无法迁移。`);
    }
    items.forEach((item) => {
      if (item.questionNo > 0) {
        return;
      }
      do {
        lastQuestionNo += 1;
      } while (used.has(lastQuestionNo));
      if (lastQuestionNo > 999) {
        throw new Error(`模块 ${item.module} 的题号超过 999，无法迁移。`);
      }
      item.questionNo = lastQuestionNo;
      used.add(lastQuestionNo);
    });
    counters.set(moduleId, Math.max(lastQuestionNo, ...used));
  });

  legacyCounters.forEach((counter) => {
    const name = normalizeName(counter.module);
    const seed = seeds.find((item) => item.name === name);
    if (!seed) {
      return;
    }
    counters.set(seed.id, Math.max(
      counters.get(seed.id) ?? 0,
      Math.min(999, Math.max(0, Math.floor(Number(counter.last_question_no) || 0))),
    ));
  });
  return { mistakes: migrated, counters };
}

async function readLegacyCustomModules(db: SQLite.SQLiteDatabase): Promise<LegacyCustomModuleRow[]> {
  if (!(await tableExists(db, 'custom_modules'))) {
    return [];
  }
  return db.getAllAsync<LegacyCustomModuleRow>(
    `SELECT id, name, icon, color, sort_order, created_at, updated_at
FROM custom_modules
ORDER BY sort_order ASC, created_at ASC, id ASC;`,
  );
}

async function readLegacyCounters(db: SQLite.SQLiteDatabase): Promise<LegacyCounterRow[]> {
  if (!(await tableExists(db, 'module_question_counters'))) {
    return [];
  }
  const columns = await db.getAllAsync<TableColumnRow>(
    'PRAGMA table_info(module_question_counters);',
  );
  if (!columns.some((row) => row.name === 'module')) {
    return [];
  }
  return db.getAllAsync<LegacyCounterRow>(
    'SELECT module, last_question_no, updated_at FROM module_question_counters;',
  );
}

async function insertMigratedMistake(
  db: SQLite.SQLiteDatabase,
  mistake: MigratedMistake,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO mistakes_new (
  id, subject, module, module_id, question_no, title, error_reason, error_reason_ids,
  difficulty, note, my_solution_text, answer_text, note_highlights, review_count,
  status, created_at, updated_at, next_review_at, last_review_at, last_review_result,
  is_pinned, last_viewed_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    mistake.id,
    mistake.subject,
    mistake.module,
    mistake.permanentModuleId,
    mistake.questionNo,
    mistake.title,
    mistake.error_reason,
    mistake.error_reason_ids,
    mistake.difficulty,
    mistake.note,
    mistake.my_solution_text,
    mistake.answer_text,
    mistake.note_highlights,
    mistake.review_count,
    mistake.status,
    mistake.created_at,
    mistake.updated_at,
    mistake.next_review_at,
    mistake.last_review_at,
    mistake.last_review_result,
    mistake.is_pinned,
    mistake.last_viewed_at,
  );
}

export async function migrateLegacyModulesAndQuestionNumbers(
  db: SQLite.SQLiteDatabase,
): Promise<void> {
  if (await isPermanentModuleSchemaReady(db)) {
    await seedPermanentModules(db);
    return;
  }

  const legacyCustomModules = await readLegacyCustomModules(db);
  const legacyCounters = await readLegacyCounters(db);
  const legacyMistakes = await db.getAllAsync<LegacyMistakeRow>(
    `SELECT
  id, subject, module, module_id, title, error_reason, error_reason_ids, difficulty,
  note, my_solution_text, answer_text, note_highlights, review_count, status,
  created_at, updated_at, next_review_at, last_review_at, last_review_result,
  is_pinned, last_viewed_at
FROM mistakes;`,
  );
  const seeds = buildModuleSeeds(legacyCustomModules, legacyMistakes);
  const migrated = migrateMistakeNumbers(legacyMistakes, seeds, legacyCounters);
  const createMigrationTableSql = CREATE_MISTAKES_TABLE_SQL.replace(
    'CREATE TABLE IF NOT EXISTS mistakes',
    'CREATE TABLE mistakes_new',
  );

  await db.execAsync('PRAGMA foreign_keys = OFF;');
  await db.execAsync('BEGIN IMMEDIATE;');
  try {
    await db.execAsync('DROP TABLE IF EXISTS modules;');
    await db.execAsync(CREATE_MODULES_TABLE_SQL);
    for (const seed of seeds) {
      await insertModuleSeed(db, seed);
    }

    await db.execAsync('DROP TABLE IF EXISTS mistakes_new;');
    await db.execAsync(createMigrationTableSql);
    for (const mistake of migrated.mistakes) {
      await insertMigratedMistake(db, mistake);
    }
    await db.execAsync('DROP TABLE mistakes;');
    await db.execAsync('ALTER TABLE mistakes_new RENAME TO mistakes;');

    await db.execAsync('DROP TABLE IF EXISTS module_question_counters;');
    await db.execAsync(CREATE_MODULE_QUESTION_COUNTERS_TABLE_SQL);
    const timestamp = nowIso();
    for (const [moduleId, lastQuestionNo] of migrated.counters) {
      await db.runAsync(
        `INSERT INTO module_question_counters (module_id, last_question_no, updated_at)
VALUES (?, ?, ?);`,
        moduleId,
        lastQuestionNo,
        timestamp,
      );
    }
    await db.execAsync('DROP TABLE IF EXISTS custom_modules;');
    const foreignKeyViolation = await db.getFirstAsync<ForeignKeyViolationRow>(
      'PRAGMA foreign_key_check;',
    );
    if (foreignKeyViolation) {
      throw new Error(
        `模块迁移后外键检查失败：${foreignKeyViolation.table} -> ${foreignKeyViolation.parent}`,
      );
    }
    await db.execAsync('COMMIT;');
  } catch (error) {
    await db.execAsync('ROLLBACK;');
    throw error;
  } finally {
    await db.execAsync('PRAGMA foreign_keys = ON;');
  }
}

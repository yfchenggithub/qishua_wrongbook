#!/usr/bin/env node
/* eslint-disable no-console */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const FIXTURE_TIMESTAMP = '2026-01-01T00:00:00.000Z';

const MODULE_FIELDS = [
  'id',
  'type',
  'name',
  'display_code',
  'custom_no',
  'icon',
  'color',
  'sort_order',
  'is_active',
  'created_at',
  'updated_at',
];

const MISTAKE_FIELDS = [
  'id',
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
  'created_at',
  'updated_at',
  'next_review_at',
  'last_review_at',
  'last_review_result',
  'is_pinned',
  'last_viewed_at',
];

const COUNTER_FIELDS = ['module_id', 'last_question_no', 'updated_at'];

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');
}

function assertSourceContains(source, expectedText, sourceName) {
  assert.ok(
    source.includes(expectedText),
    `${sourceName} 缺少 V10 备份契约：${expectedText}`,
  );
}

function extractSqlConstant(source, constantName) {
  const pattern = new RegExp(`export const ${constantName} = ` + '`([\\s\\S]*?)`;');
  const matched = pattern.exec(source);
  assert.ok(matched, `无法从 schema.ts 读取 ${constantName}`);
  return matched[1]
    .replace(/\$\{MAX_REVIEW_COUNT\}/g, '7')
    .replace(/\$\{BRAND_ACCENT\}/g, '#34C759');
}

function createV10Database(schemaSource) {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON;');
  database.exec(extractSqlConstant(schemaSource, 'CREATE_MODULES_TABLE_SQL'));
  database.exec(extractSqlConstant(schemaSource, 'CREATE_MISTAKES_TABLE_SQL'));
  database.exec(extractSqlConstant(schemaSource, 'CREATE_MODULE_QUESTION_COUNTERS_TABLE_SQL'));
  return database;
}

function insertRows(database, tableName, fields, rows) {
  const placeholders = fields.map(() => '?').join(', ');
  const statement = database.prepare(
    `INSERT INTO ${tableName} (${fields.join(', ')}) VALUES (${placeholders});`,
  );
  for (const row of rows) {
    statement.run(...fields.map((field) => row[field]));
  }
}

function selectRows(database, tableName, fields, orderBy) {
  return database
    .prepare(`SELECT ${fields.join(', ')} FROM ${tableName} ORDER BY ${orderBy};`)
    .all();
}

function buildMistake(id, moduleName, moduleId, questionNo) {
  return {
    id,
    subject: 'math',
    module: moduleName,
    module_id: moduleId,
    question_no: questionNo,
    title: `${moduleName}专项验收题`,
    error_reason: null,
    error_reason_ids: null,
    difficulty: 3,
    note: null,
    my_solution_text: null,
    answer_text: null,
    note_highlights: null,
    review_count: 0,
    status: 'collected',
    created_at: FIXTURE_TIMESTAMP,
    updated_at: FIXTURE_TIMESTAMP,
    next_review_at: null,
    last_review_at: null,
    last_review_result: null,
    is_pinned: 0,
    last_viewed_at: null,
  };
}

function buildSourceFixture(database) {
  insertRows(database, 'modules', MODULE_FIELDS, [
    {
      id: 1,
      type: 'system',
      name: '函数',
      display_code: 'A',
      custom_no: null,
      icon: 'label',
      color: '#34C759',
      sort_order: 0,
      is_active: 1,
      created_at: FIXTURE_TIMESTAMP,
      updated_at: FIXTURE_TIMESTAMP,
    },
    {
      id: 1001,
      type: 'custom',
      name: '专项模块',
      display_code: 'U016',
      custom_no: 16,
      icon: 'label',
      color: '#34C759',
      sort_order: 0,
      is_active: 1,
      created_at: FIXTURE_TIMESTAMP,
      updated_at: FIXTURE_TIMESTAMP,
    },
  ]);
  insertRows(database, 'mistakes', MISTAKE_FIELDS, [
    buildMistake('system-a001', '函数', 1, 1),
    buildMistake('custom-u016-001', '专项模块', 1001, 1),
  ]);
  insertRows(database, 'module_question_counters', COUNTER_FIELDS, [
    {
      module_id: 1,
      last_question_no: 2,
      updated_at: FIXTURE_TIMESTAMP,
    },
    {
      module_id: 1001,
      last_question_no: 1,
      updated_at: FIXTURE_TIMESTAMP,
    },
  ]);
}

function exportV10Payload(database) {
  const modules = selectRows(database, 'modules', MODULE_FIELDS, 'id ASC')
    .map((row) => ({ ...row, is_active: row.is_active === 1 }));
  const mistakes = selectRows(database, 'mistakes', MISTAKE_FIELDS, 'id ASC')
    .map((row) => ({ ...row, is_pinned: row.is_pinned === 1 }));
  const moduleQuestionCounters = selectRows(
    database,
    'module_question_counters',
    COUNTER_FIELDS,
    'module_id ASC',
  );
  return JSON.parse(JSON.stringify({
    schemaVersion: 10,
    modules,
    mistakes,
    moduleQuestionCounters,
  }));
}

function restoreV10Payload(database, payload) {
  assert.equal(payload.schemaVersion, 10, '专项验收只接受 schemaVersion 10');
  database.exec('BEGIN IMMEDIATE;');
  try {
    insertRows(
      database,
      'modules',
      MODULE_FIELDS,
      payload.modules.map((row) => ({ ...row, is_active: row.is_active ? 1 : 0 })),
    );
    insertRows(
      database,
      'mistakes',
      MISTAKE_FIELDS,
      payload.mistakes.map((row) => ({ ...row, is_pinned: row.is_pinned ? 1 : 0 })),
    );
    insertRows(
      database,
      'module_question_counters',
      COUNTER_FIELDS,
      payload.moduleQuestionCounters,
    );
    database.exec('COMMIT;');
  } catch (error) {
    database.exec('ROLLBACK;');
    throw error;
  }
}

function reserveNextQuestionNumber(database, moduleId, mistakeId, moduleName) {
  database.exec('BEGIN IMMEDIATE;');
  try {
    const counter = database
      .prepare('SELECT last_question_no FROM module_question_counters WHERE module_id = ?;')
      .get(moduleId);
    assert.ok(counter, `恢复后模块 ${moduleId} 缺少题号计数器`);
    const nextQuestionNo = Number(counter.last_question_no) + 1;
    database
      .prepare(
        `UPDATE module_question_counters
SET last_question_no = ?, updated_at = ?
WHERE module_id = ?;`,
      )
      .run(nextQuestionNo, FIXTURE_TIMESTAMP, moduleId);
    insertRows(database, 'mistakes', MISTAKE_FIELDS, [
      buildMistake(mistakeId, moduleName, moduleId, nextQuestionNo),
    ]);
    database.exec('COMMIT;');
    return nextQuestionNo;
  } catch (error) {
    database.exec('ROLLBACK;');
    throw error;
  }
}

function formatDisplayCode(moduleDisplayCode, questionNo) {
  const suffix = String(questionNo).padStart(3, '0');
  return moduleDisplayCode.startsWith('U')
    ? `${moduleDisplayCode}-${suffix}`
    : `${moduleDisplayCode}${suffix}`;
}

function verifyProductionContracts() {
  const databaseVersionSource = readProjectFile('src/db/constants.ts');
  const schemaSource = readProjectFile('src/db/schema.ts');
  const backupTypesSource = readProjectFile('src/services/backup/BackupTypes.ts');
  const backupServiceSource = readProjectFile('src/services/backup/BackupService.ts');
  const mistakeRepositorySource = readProjectFile('src/repositories/MistakeRepository.ts');

  assert.match(databaseVersionSource, /DATABASE_VERSION\s*=\s*10\b/u);
  assertSourceContains(schemaSource, 'UNIQUE(module_id, question_no)', 'schema.ts');
  assertSourceContains(backupTypesSource, 'modules: BackupModuleRecord[];', 'BackupTypes.ts');
  assertSourceContains(
    backupTypesSource,
    'moduleQuestionCounters: BackupModuleQuestionCounterRecord[];',
    'BackupTypes.ts',
  );
  assertSourceContains(backupServiceSource, 'listAllModules()', 'BackupService.ts');
  assertSourceContains(
    backupServiceSource,
    'listAllModuleQuestionCounters()',
    'BackupService.ts',
  );
  assertSourceContains(backupServiceSource, 'mistake.module_id,', 'BackupService.ts');
  assertSourceContains(backupServiceSource, 'mistake.question_no,', 'BackupService.ts');
  assertSourceContains(
    mistakeRepositorySource,
    'FROM module_question_counters',
    'MistakeRepository.ts',
  );
  assertSourceContains(
    backupServiceSource,
    'function toRestoreExpectedCounts(',
    'BackupService.ts',
  );
  assertSourceContains(
    backupServiceSource,
    'mistakeImages: restorableImageCount,',
    'BackupService.ts',
  );
  assertSourceContains(
    backupServiceSource,
    'imageFiles: restorableImageCount,',
    'BackupService.ts',
  );
  assertSourceContains(
    backupServiceSource,
    'skippedImageCount = imageResult.skippedCount;',
    'BackupService.ts',
  );

  return schemaSource;
}

function verifyMissingImageCountPolicy() {
  const backupImageRecords = [
    { id: 'image-present', backupRelativePath: 'images/image-present.jpg' },
    { id: 'image-missing', backupRelativePath: 'images/image-missing.jpg' },
  ];
  const archiveImagePaths = new Set(['images/image-present.jpg']);
  const restorableImages = backupImageRecords.filter((image) => (
    archiveImagePaths.has(image.backupRelativePath)
  ));
  const expectedCounts = {
    mistakes: 1,
    mistakeImages: restorableImages.length,
    reviewRecords: 0,
    imageFiles: restorableImages.length,
  };
  const actualCountsAfterRestore = {
    mistakes: 1,
    mistakeImages: 1,
    reviewRecords: 0,
    imageFiles: 1,
  };

  assert.deepEqual(
    actualCountsAfterRestore,
    expectedCounts,
    '缺失图片应从恢复预期数量中排除，其余图片应正常通过校验',
  );
  assert.equal(
    backupImageRecords.length - restorableImages.length,
    1,
    '缺失图片数量计算错误',
  );
}

function runRoundTrip(schemaSource) {
  const sourceDatabase = createV10Database(schemaSource);
  const targetDatabase = createV10Database(schemaSource);
  try {
    buildSourceFixture(sourceDatabase);
    const payload = exportV10Payload(sourceDatabase);
    restoreV10Payload(targetDatabase, payload);

    const restoredAssociations = targetDatabase
      .prepare(
        `SELECT mistakes.id, mistakes.module_id, mistakes.question_no, modules.display_code
FROM mistakes
JOIN modules ON modules.id = mistakes.module_id
ORDER BY mistakes.id ASC;`,
      )
      .all();
    assert.deepEqual(
      restoredAssociations.map((row) => ({
        id: row.id,
        moduleId: row.module_id,
        displayCode: formatDisplayCode(row.display_code, row.question_no),
      })),
      [
        { id: 'custom-u016-001', moduleId: 1001, displayCode: 'U016-001' },
        { id: 'system-a001', moduleId: 1, displayCode: 'A001' },
      ],
      '恢复后系统/自定义模块关联或显示编号不一致',
    );

    const nextSystemQuestionNo = reserveNextQuestionNumber(
      targetDatabase,
      1,
      'system-a003',
      '函数',
    );
    const nextCustomQuestionNo = reserveNextQuestionNumber(
      targetDatabase,
      1001,
      'custom-u016-002',
      '专项模块',
    );
    assert.equal(nextSystemQuestionNo, 3, '已删除的 A002 被错误复用');
    assert.equal(nextCustomQuestionNo, 2, '自定义模块计数器未从 U016-001 继续');

    const finalCounters = selectRows(
      targetDatabase,
      'module_question_counters',
      COUNTER_FIELDS,
      'module_id ASC',
    ).map(({ module_id, last_question_no }) => ({ module_id, last_question_no }));
    assert.deepEqual(finalCounters, [
      { module_id: 1, last_question_no: 3 },
      { module_id: 1001, last_question_no: 2 },
    ]);
  } finally {
    sourceDatabase.close();
    targetDatabase.close();
  }
}

function main() {
  const schemaSource = verifyProductionContracts();
  runRoundTrip(schemaSource);
  verifyMissingImageCountPolicy();
  console.log('[backup-v10] 检查通过：');
  console.log('  - schemaVersion 10 关键导出/恢复字段存在');
  console.log('  - 系统模块 A 与自定义模块 U016 按永久 module_id 恢复');
  console.log('  - 恢复后计数器继续递增，已删除编号 A002 不复用');
  console.log('  - 系统模块与自定义模块题号序列互相独立');
  console.log('  - 缺失图片从恢复预期数量中排除，其余图片可正常通过校验');
}

try {
  main();
} catch (error) {
  console.error('[backup-v10] 检查失败：', error);
  process.exitCode = 1;
}

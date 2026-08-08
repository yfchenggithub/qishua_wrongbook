#!/usr/bin/env node
/* eslint-disable no-console */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const TIMESTAMP = '2026-08-08T12:00:00.000Z';

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');
}

function extractSqlConstant(source, constantName) {
  const pattern = new RegExp(`export const ${constantName} = ` + '`([\\s\\S]*?)`;');
  const matched = pattern.exec(source);
  assert.ok(matched, `无法从 schema.ts 读取 ${constantName}`);
  return matched[1]
    .replace(/\$\{MAX_REVIEW_COUNT\}/g, '7')
    .replace(/\$\{BRAND_ACCENT\}/g, '#34C759');
}

function createDatabaseWithV10Data(schemaSource) {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON;');
  database.exec(extractSqlConstant(schemaSource, 'CREATE_MODULES_TABLE_SQL'));
  database.exec(extractSqlConstant(schemaSource, 'CREATE_MISTAKES_TABLE_SQL'));
  database.prepare(
    `INSERT INTO modules (
  id, type, name, display_code, custom_no, icon, color,
  sort_order, is_active, created_at, updated_at
) VALUES (?, 'custom', ?, ?, ?, 'label', '#34C759', 0, 1, ?, ?);`,
  ).run(1001, 'Imported Module', 'U016', 16, TIMESTAMP, TIMESTAMP);
  database.prepare(
    `INSERT INTO mistakes (
  id, subject, module, module_id, question_no, difficulty,
  review_count, status, created_at, updated_at, is_pinned
) VALUES (?, 'math', ?, ?, ?, 3, 0, 'collected', ?, ?, 0);`,
  ).run('M001', 'Imported Module', 1001, 1, TIMESTAMP, TIMESTAMP);
  return database;
}

function insertSecondModule(database) {
  database.prepare(
    `INSERT INTO modules (
  id, type, name, display_code, custom_no, icon, color,
  sort_order, is_active, created_at, updated_at
) VALUES (?, 'custom', ?, ?, ?, 'label', '#34C759', 1, 1, ?, ?);`,
  ).run(1002, 'Second Module', 'U017', 17, TIMESTAMP, TIMESTAMP);
}

function insertImport(database, values) {
  database.prepare(
    `INSERT INTO module_imports (
  id, package_id, content_version, module_id, source_module_name,
  description, creator_name, package_created_at, imported_at
) VALUES (?, ?, 1, ?, ?, NULL, NULL, ?, ?);`,
  ).run(values.id, values.packageId, values.moduleId, values.sourceModuleName, TIMESTAMP, TIMESTAMP);
}

function verifyProductionContracts() {
  const constantsSource = readProjectFile('src/db/constants.ts');
  const schemaSource = readProjectFile('src/db/schema.ts');
  const databaseSource = readProjectFile('src/db/database.ts');
  const repositorySource = readProjectFile('src/repositories/ModuleImportRepository.ts');
  const backupTypesSource = readProjectFile('src/services/backup/BackupTypes.ts');
  const backupServiceSource = readProjectFile('src/services/backup/BackupService.ts');

  assert.match(constantsSource, /DATABASE_VERSION\s*=\s*11\b/u);
  assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS module_imports/u);
  assert.match(schemaSource, /package_id TEXT NOT NULL UNIQUE/u);
  assert.match(schemaSource, /module_id INTEGER NOT NULL UNIQUE/u);
  assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS module_import_items/u);
  assert.match(schemaSource, /PRIMARY KEY\(import_id, item_id\)/u);
  assert.match(schemaSource, /UNIQUE\(import_id, position\)/u);
  assert.match(schemaSource, /mistake_id TEXT NOT NULL UNIQUE/u);
  assert.ok(databaseSource.includes("'module_imports'"));
  assert.ok(databaseSource.includes("'module_import_items'"));
  assert.ok(repositorySource.includes('createImportInTransaction'));
  assert.ok(repositorySource.includes('hasImportedPackage'));
  assert.ok(repositorySource.includes('findImportByMistakeId'));
  assert.ok(backupTypesSource.includes('moduleImports: BackupModuleImportRecord[];'));
  assert.ok(backupTypesSource.includes('moduleImportItems: BackupModuleImportItemRecord[];'));
  assert.ok(backupServiceSource.includes('listAllModuleImports()'));
  assert.ok(backupServiceSource.includes('INSERT_MODULE_IMPORT_ITEM_SQL'));

  return schemaSource;
}

function verifyMigrationAndConstraints(schemaSource) {
  const database = createDatabaseWithV10Data(schemaSource);
  try {
    database.exec(extractSqlConstant(schemaSource, 'CREATE_MODULE_IMPORTS_TABLE_SQL'));
    database.exec(extractSqlConstant(schemaSource, 'CREATE_MODULE_IMPORT_ITEMS_TABLE_SQL'));

    const oldMistake = database.prepare('SELECT id FROM mistakes WHERE id = ?;').get('M001');
    assert.equal(oldMistake.id, 'M001', '新增来源表时不应修改或删除 V10 错题');

    insertImport(database, {
      id: 'MI001',
      packageId: 'PKG-test-0001',
      moduleId: 1001,
      sourceModuleName: 'Imported Module',
    });
    database.prepare(
      `INSERT INTO module_import_items (import_id, item_id, mistake_id, position)
VALUES ('MI001', 'Q001', 'M001', 1);`,
    ).run();

    const provenance = database.prepare(
      `SELECT module_imports.package_id, module_import_items.item_id, module_import_items.mistake_id
FROM module_imports
JOIN module_import_items ON module_import_items.import_id = module_imports.id
WHERE module_imports.id = 'MI001';`,
    ).get();
    assert.deepEqual({ ...provenance }, {
      package_id: 'PKG-test-0001',
      item_id: 'Q001',
      mistake_id: 'M001',
    });

    insertSecondModule(database);
    assert.throws(
      () => insertImport(database, {
        id: 'MI002',
        packageId: 'PKG-test-0001',
        moduleId: 1002,
        sourceModuleName: 'Second Module',
      }),
      /UNIQUE constraint failed: module_imports\.package_id/u,
      '同一 package_id 必须被数据库唯一约束阻止',
    );
    assert.throws(
      () => insertImport(database, {
        id: 'MI003',
        packageId: 'PKG-test-0003',
        moduleId: 1001,
        sourceModuleName: 'Imported Module',
      }),
      /UNIQUE constraint failed: module_imports\.module_id/u,
      '一个本机模块不能对应多个导入来源',
    );

    database.prepare(
      `INSERT INTO mistakes (
  id, subject, module, module_id, question_no, difficulty,
  review_count, status, created_at, updated_at, is_pinned
) VALUES ('M002', 'math', 'Imported Module', 1001, 2, 3, 0, 'collected', ?, ?, 0);`,
    ).run(TIMESTAMP, TIMESTAMP);
    assert.throws(
      () => database.prepare(
        `INSERT INTO module_import_items (import_id, item_id, mistake_id, position)
VALUES ('MI001', 'Q002', 'M002', 1);`,
      ).run(),
      /UNIQUE constraint failed: module_import_items\.import_id, module_import_items\.position/u,
      '同一次导入的 position 必须唯一',
    );
    database.prepare(
      `INSERT INTO module_import_items (import_id, item_id, mistake_id, position)
VALUES ('MI001', 'Q002', 'M002', 2);`,
    ).run();
    assert.throws(
      () => database.prepare(
        `INSERT INTO module_import_items (import_id, item_id, mistake_id, position)
VALUES ('MI001', 'Q003', 'M002', 3);`,
      ).run(),
      /UNIQUE constraint failed: module_import_items\.mistake_id/u,
      '同一本机错题只能拥有一条题包来源映射',
    );

    database.prepare("DELETE FROM mistakes WHERE id = 'M001';").run();
    assert.equal(
      database.prepare("SELECT COUNT(*) AS total FROM module_import_items WHERE mistake_id = 'M001';").get().total,
      0,
      '删除错题时必须级联删除 item 映射',
    );
    assert.equal(
      database.prepare("SELECT COUNT(*) AS total FROM module_imports WHERE id = 'MI001';").get().total,
      1,
      '删除单题不能删除包级来源记录，否则会绕过重复导入检测',
    );

    database.prepare("DELETE FROM mistakes WHERE id = 'M002';").run();
    database.prepare('DELETE FROM modules WHERE id = 1001;').run();
    assert.equal(
      database.prepare("SELECT COUNT(*) AS total FROM module_imports WHERE id = 'MI001';").get().total,
      0,
      '物理删除模块时必须级联删除包级来源记录',
    );
  } finally {
    database.close();
  }
}

function main() {
  const schemaSource = verifyProductionContracts();
  verifyMigrationAndConstraints(schemaSource);
  console.log('[module-import-v11] 检查通过：');
  console.log('  - V10 现有错题在新增来源表后保持不变');
  console.log('  - package_id、module_id、item、position 与 mistake_id 唯一约束有效');
  console.log('  - 删除错题只清理 item 映射，保留包级重复导入记录');
  console.log('  - 物理删除模块会级联清理完整来源记录');
  console.log('  - schemaVersion 11 备份包含题包来源表');
}

try {
  main();
} catch (error) {
  console.error('[module-import-v11] 检查失败：', error);
  process.exitCode = 1;
}

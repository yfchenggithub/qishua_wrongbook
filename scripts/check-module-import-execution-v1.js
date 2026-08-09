#!/usr/bin/env node
/* eslint-disable no-console */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { fileURLToPath, pathToFileURL } = require('node:url');
const ts = require('typescript');
const { strToU8, zipSync } = require('fflate');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'qishua-module-import-execution-'));
const CACHE_ROOT = path.join(TEST_ROOT, 'cache');
const DOCUMENT_ROOT = path.join(TEST_ROOT, 'document');
const PACKAGE_ROOT = path.join(TEST_ROOT, 'packages');
const CREATED_AT = '2026-08-09T01:00:00.000Z';
const IMPORTED_AT = '2026-08-09T02:00:00.000Z';
const JPEG_ONE = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0xff, 0xd9]);
const JPEG_TWO = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x03, 0x04, 0xff, 0xd9]);
const JPEG_THREE = new Uint8Array([0xff, 0xd8, 0xff, 0xe2, 0x05, 0x06, 0xff, 0xd9]);
const JPEG_FOUR = new Uint8Array([0xff, 0xd8, 0xff, 0xe3, 0x07, 0x08, 0xff, 0xd9]);

fs.mkdirSync(CACHE_ROOT, { recursive: true });
fs.mkdirSync(DOCUMENT_ROOT, { recursive: true });
fs.mkdirSync(PACKAGE_ROOT, { recursive: true });

let database;
let databaseAdapter;

function normalizePathPart(value) {
  if (value instanceof NodeFile || value instanceof NodeDirectory) {
    return value.path;
  }
  if (typeof value !== 'string') {
    throw new TypeError('Unsupported file-system path input.');
  }
  return value.startsWith('file:') ? fileURLToPath(value) : value;
}

function joinPathParts(parts) {
  const normalized = parts.map(normalizePathPart);
  return normalized.length === 1 ? path.resolve(normalized[0]) : path.join(...normalized);
}

class NodeFileHandle {
  constructor(filePath) {
    this.fd = fs.openSync(filePath, 'r+');
    this.offset = 0;
  }

  close() {
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }

  readBytes(length) {
    const buffer = Buffer.alloc(length);
    const bytesRead = fs.readSync(this.fd, buffer, 0, length, this.offset);
    this.offset += bytesRead;
    return new Uint8Array(buffer.subarray(0, bytesRead));
  }

  writeBytes(bytes) {
    const buffer = Buffer.from(bytes);
    const bytesWritten = fs.writeSync(this.fd, buffer, 0, buffer.length, this.offset);
    this.offset += bytesWritten;
  }
}

class NodeDirectory {
  constructor(...parts) {
    this.path = joinPathParts(parts);
    this.uri = pathToFileURL(this.path).href;
  }

  get exists() {
    return fs.existsSync(this.path) && fs.statSync(this.path).isDirectory();
  }

  create(options = {}) {
    if (this.exists) {
      if (options.idempotent) {
        return;
      }
      throw new Error(`Directory already exists: ${this.path}`);
    }
    fs.mkdirSync(this.path, { recursive: options.intermediates === true });
  }

  delete() {
    fs.rmSync(this.path, { recursive: true, force: false });
  }
}

class NodeFile {
  constructor(...parts) {
    this.path = joinPathParts(parts);
    this.uri = pathToFileURL(this.path).href;
  }

  get exists() {
    return fs.existsSync(this.path) && fs.statSync(this.path).isFile();
  }

  get size() {
    return this.exists ? fs.statSync(this.path).size : 0;
  }

  info() {
    return { exists: this.exists, uri: this.uri, size: this.size };
  }

  create(options = {}) {
    if (options.intermediates) {
      fs.mkdirSync(path.dirname(this.path), { recursive: true });
    }
    const fd = fs.openSync(this.path, options.overwrite ? 'w' : 'wx');
    fs.closeSync(fd);
  }

  copy(destination) {
    fs.copyFileSync(this.path, normalizePathPart(destination), fs.constants.COPYFILE_EXCL);
  }

  delete() {
    fs.unlinkSync(this.path);
  }

  open() {
    return new NodeFileHandle(this.path);
  }
}

function normalizeSqlParameters(parameters) {
  return parameters.length === 1 && Array.isArray(parameters[0]) ? parameters[0] : parameters;
}

function createDatabaseAdapter(databaseInstance) {
  return {
    async execAsync(sql) {
      databaseInstance.exec(sql);
    },
    async runAsync(sql, ...parameters) {
      return databaseInstance.prepare(sql).run(...normalizeSqlParameters(parameters));
    },
    async getFirstAsync(sql, ...parameters) {
      return databaseInstance.prepare(sql).get(...normalizeSqlParameters(parameters)) ?? null;
    },
    async getAllAsync(sql, ...parameters) {
      return databaseInstance.prepare(sql).all(...normalizeSqlParameters(parameters));
    },
  };
}

async function withDatabaseTransaction(callback) {
  database.exec('BEGIN IMMEDIATE;');
  try {
    const result = await callback(databaseAdapter);
    database.exec('COMMIT;');
    return result;
  } catch (error) {
    database.exec('ROLLBACK;');
    throw error;
  }
}

function installTypeScriptLoader() {
  require.extensions['.ts'] = (loadedModule, filename) => {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      compilerOptions: {
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: filename,
    }).outputText;
    loadedModule._compile(output, filename);
  };

  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@/')) {
      const absoluteRequest = path.join(PROJECT_ROOT, request.slice(2));
      return originalResolveFilename.call(this, absoluteRequest, parent, isMain, options);
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };

  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === 'expo-file-system') {
      return {
        Directory: NodeDirectory,
        File: NodeFile,
        Paths: {
          cache: new NodeDirectory(CACHE_ROOT),
          document: new NodeDirectory(DOCUMENT_ROOT),
        },
      };
    }
    if (request === '@/src/db') {
      return {
        async getDatabase() {
          return databaseAdapter;
        },
        async initDatabase() {},
        withDatabaseTransaction,
      };
    }
    if (request === '@/src/services/Logger') {
      return { Logger: { info() {}, warn() {}, error() {} } };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
}

function buildPayload(packageId, moduleName) {
  return {
    manifest: {
      format: 'qishua_module',
      formatVersion: 1,
      packageId,
      contentVersion: 1,
      appName: '七刷错题本',
      appVersion: '1.0.0',
      createdAt: CREATED_AT,
      creator: { displayName: '小七' },
      module: {
        name: moduleName,
        description: '正式导入事务测试',
        subject: 'math',
        icon: 'label',
        color: '#34C759',
      },
      counts: { questions: 2, images: 4, relations: 1 },
      warnings: ['作者身份未经认证'],
    },
    data: {
      questions: [
        {
          itemId: 'Q001',
          position: 1,
          subject: 'math',
          title: '函数零点',
          difficulty: 4,
          errorReasons: [
            { kind: 'builtin', key: 'builtin:reason:careless', name: '粗心' },
            { kind: 'custom', name: '符号错误' },
          ],
          note: '重点步骤',
          noteHighlights: [{ start: 0, end: 2, color: 'yellow' }],
          mySolutionText: null,
          answerText: '标准答案一',
          tags: ['函数', '零点'],
          images: [
            {
              assetId: 'ASSET0001',
              type: 'question',
              sortOrder: 0,
              relativePath: 'images/Q001/question_001.jpg',
            },
            {
              assetId: 'ASSET0002',
              type: 'answer',
              sortOrder: 0,
              relativePath: 'images/Q001/answer_001.jpg',
            },
          ],
        },
        {
          itemId: 'Q002',
          position: 2,
          subject: 'math',
          title: '函数单调性',
          difficulty: 3,
          errorReasons: [],
          note: null,
          noteHighlights: [],
          mySolutionText: '我的做法',
          answerText: null,
          tags: ['函数'],
          images: [
            {
              assetId: 'ASSET0003',
              type: 'question',
              sortOrder: 0,
              relativePath: 'images/Q002/question_001.jpg',
            },
            {
              assetId: 'ASSET0004',
              type: 'my_solution',
              sortOrder: 0,
              relativePath: 'images/Q002/my_solution_001.jpg',
            },
          ],
        },
      ],
      relations: [{ sourceItemId: 'Q001', targetItemId: 'Q002' }],
    },
  };
}

function writePackage(fileName, payload) {
  const filePath = path.join(PACKAGE_ROOT, fileName);
  fs.writeFileSync(filePath, zipSync({
    'manifest.json': strToU8(JSON.stringify(payload.manifest)),
    'module.json': strToU8(JSON.stringify(payload.data)),
    'images/': new Uint8Array(),
    'images/Q001/': new Uint8Array(),
    'images/Q001/question_001.jpg': JPEG_ONE,
    'images/Q001/answer_001.jpg': JPEG_TWO,
    'images/Q002/': new Uint8Array(),
    'images/Q002/question_001.jpg': JPEG_THREE,
    'images/Q002/my_solution_001.jpg': JPEG_FOUR,
  }, { level: 6 }));
  return {
    fileUri: pathToFileURL(filePath).href,
    fileName,
    fileSizeBytes: fs.statSync(filePath).size,
    importedAt: IMPORTED_AT,
  };
}

function listRelativeFiles(root) {
  if (!fs.existsSync(root)) {
    return [];
  }
  const results = [];
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else {
        results.push(path.relative(root, absolutePath).replace(/\\/g, '/'));
      }
    }
  }
  visit(root);
  return results.sort();
}

function countRows(tableName) {
  return Number(database.prepare(`SELECT COUNT(*) AS total FROM ${tableName};`).get().total);
}

function snapshotImportedTables() {
  return {
    modules: countRows('modules'),
    counters: countRows('module_question_counters'),
    mistakes: countRows('mistakes'),
    images: countRows('mistake_images'),
    tags: countRows('mistake_tags'),
    relations: countRows('mistake_relations'),
    imports: countRows('module_imports'),
    importItems: countRows('module_import_items'),
  };
}

function assertStagingIsEmpty() {
  const stagingRoot = path.join(CACHE_ROOT, 'qishua_module_imports');
  assert.deepEqual(
    fs.existsSync(stagingRoot) ? fs.readdirSync(stagingRoot) : [],
    [],
    '独立暂存目录应在执行结束后清空',
  );
}

function initializeDatabase() {
  database = new DatabaseSync(':memory:');
  databaseAdapter = createDatabaseAdapter(database);
  database.exec('PRAGMA foreign_keys = ON;');
  const { CREATE_SCHEMA_SQL } = require(path.join(PROJECT_ROOT, 'src/db/schema.ts'));
  database.exec(CREATE_SCHEMA_SQL);
  database.prepare(
    `INSERT INTO modules (
  id, type, name, display_code, custom_no, icon, color,
  sort_order, is_active, created_at, updated_at
) VALUES (1, 'system', '函数', 'A', NULL, 'functions', '#34C759', 0, 1, ?, ?);`,
  ).run(CREATED_AT, CREATED_AT);
  database.prepare(
    `INSERT INTO custom_error_reasons (
  id, name, icon, color, sort_order, created_at, updated_at
) VALUES ('CER_LOCAL', '符号错误', 'error-outline', '#F59E0B', 0, ?, ?);`,
  ).run(CREATED_AT, CREATED_AT);
}

async function verifySuccessfulImport(executeModuleImport) {
  const payload = buildPayload('PKG-execution-test-0001', '函数');
  const input = writePackage('success.qsm', payload);
  const { readModuleImportPreview } = require(
    path.join(PROJECT_ROOT, 'src/services/moduleTransfer/ModuleImportPreviewService.ts'),
  );
  const previewResult = await readModuleImportPreview(input);
  assert.equal(previewResult.ok, true, JSON.stringify(previewResult, null, 2));
  const progressEvents = [];
  const result = await executeModuleImport({
    ...input,
    onProgress(event) {
      progressEvents.push(event);
    },
  });
  assert.equal(result.ok, true, JSON.stringify(result, null, 2));
  assert.deepEqual(progressEvents.map((event) => event.stage), [
    'validating',
    'checking_duplicate',
    'staging_images',
    'committing_images',
    'writing_database',
    'cleaning_up',
    'completed',
  ]);
  assert.deepEqual(progressEvents.map((event) => event.percent), [5, 18, 32, 56, 72, 94, 100]);
  assert.equal(result.value.packageId, payload.manifest.packageId);
  assert.equal(result.value.moduleId, 1001);
  assert.equal(result.value.moduleName, '函数（导入）');
  assert.equal(result.value.moduleDisplayCode, 'U016');
  assert.equal(result.value.mistakeIds.length, 2);
  assert.equal(result.value.imageCount, 4);
  assert.equal(result.value.relationCount, 1);

  const moduleRow = database.prepare(
    'SELECT type, name, display_code, custom_no FROM modules WHERE id = 1001;',
  ).get();
  assert.deepEqual({ ...moduleRow }, {
    type: 'custom',
    name: '函数（导入）',
    display_code: 'U016',
    custom_no: 16,
  });

  const mistakes = database.prepare(
    `SELECT id, question_no, status, review_count, next_review_at, error_reason, error_reason_ids
FROM mistakes WHERE module_id = 1001 ORDER BY question_no;`,
  ).all();
  assert.equal(mistakes.length, 2);
  assert.deepEqual(mistakes.map((row) => row.question_no), [1, 2]);
  assert.ok(mistakes.every((row) => (
    row.status === 'collected' && row.review_count === 0 && row.next_review_at === null
  )));
  assert.equal(mistakes[0].error_reason, '粗心、符号错误');
  assert.deepEqual(JSON.parse(mistakes[0].error_reason_ids), [
    'builtin:reason:careless',
    'custom:CER_LOCAL',
  ]);

  const tags = database.prepare(
    'SELECT name, normalized_name, sort_order FROM mistake_tags ORDER BY mistake_id, sort_order;',
  ).all();
  assert.deepEqual(tags.map((row) => row.name), ['函数', '零点', '函数']);
  assert.ok(tags.every((row) => row.name.toLocaleLowerCase() === row.normalized_name));

  const relation = database.prepare(
    'SELECT source_mistake_id, target_mistake_id, source FROM mistake_relations;',
  ).get();
  assert.deepEqual({ ...relation }, {
    source_mistake_id: result.value.mistakeIds[0],
    target_mistake_id: result.value.mistakeIds[1],
    source: 'manual',
  });

  const importRow = database.prepare(
    `SELECT package_id, module_id, source_module_name, imported_at
FROM module_imports WHERE package_id = ?;`,
  ).get(payload.manifest.packageId);
  assert.deepEqual({ ...importRow }, {
    package_id: payload.manifest.packageId,
    module_id: 1001,
    source_module_name: '函数',
    imported_at: IMPORTED_AT,
  });
  const importItems = database.prepare(
    'SELECT item_id, mistake_id, position FROM module_import_items ORDER BY position;',
  ).all();
  assert.deepEqual(importItems.map((row) => row.item_id), ['Q001', 'Q002']);
  assert.deepEqual(importItems.map((row) => row.mistake_id), result.value.mistakeIds);

  const imageRows = database.prepare(
    'SELECT mistake_id, type, uri, sort_order FROM mistake_images ORDER BY mistake_id, type;',
  ).all();
  assert.equal(imageRows.length, 4);
  for (const imageRow of imageRows) {
    const imagePath = fileURLToPath(imageRow.uri);
    assert.ok(fs.existsSync(imagePath), `正式图片应存在：${imagePath}`);
    assert.equal(fs.readFileSync(imagePath).at(0), 0xff);
  }
  assertStagingIsEmpty();
}

async function verifyDuplicateIsRejected(executeModuleImport) {
  const before = snapshotImportedTables();
  const filesBefore = listRelativeFiles(DOCUMENT_ROOT);
  const duplicateInput = writePackage(
    'duplicate.qsm',
    buildPayload('PKG-execution-test-0001', '函数'),
  );
  const result = await executeModuleImport(duplicateInput);
  assert.deepEqual(result, {
    ok: false,
    code: 'already_imported',
    message: '该题包已经导入，不能重复导入。',
  });
  assert.deepEqual(snapshotImportedTables(), before);
  assert.deepEqual(listRelativeFiles(DOCUMENT_ROOT), filesBefore);
  assertStagingIsEmpty();
}

async function verifyRollbackAndCleanup(executeModuleImport) {
  const { MistakeRelationRepository } = require(
    path.join(PROJECT_ROOT, 'src/repositories/MistakeRelationRepository.ts'),
  );
  const originalCreateRelation = MistakeRelationRepository.createRelationInTransaction;
  const before = snapshotImportedTables();
  const filesBefore = listRelativeFiles(DOCUMENT_ROOT);
  const rollbackInput = writePackage(
    'rollback.qsm',
    buildPayload('PKG-execution-test-0002', '数列'),
  );
  MistakeRelationRepository.createRelationInTransaction = async () => {
    throw new Error('Injected relation failure.');
  };
  try {
    const result = await executeModuleImport(rollbackInput);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'transaction_failed');
    assert.equal(result.cleanupWarning, undefined);
  } finally {
    MistakeRelationRepository.createRelationInTransaction = originalCreateRelation;
  }
  assert.deepEqual(snapshotImportedTables(), before, '失败事务不应留下任何新增记录');
  assert.deepEqual(
    listRelativeFiles(DOCUMENT_ROOT),
    filesBefore,
    '失败事务对应的最终图片目录应被补偿清理',
  );
  assertStagingIsEmpty();
}

async function main() {
  installTypeScriptLoader();
  initializeDatabase();
  try {
    const { executeModuleImport } = require(
      path.join(PROJECT_ROOT, 'src/services/moduleTransfer/ModuleImportExecutionService.ts'),
    );
    await verifySuccessfulImport(executeModuleImport);
    await verifyDuplicateIsRejected(executeModuleImport);
    await verifyRollbackAndCleanup(executeModuleImport);
    console.log('[module-import-execution-v1] 检查通过：');
    console.log('  - packageId 在正式暂存前完成重复导入拦截');
    console.log('  - 图片安全解压到独立缓存目录，并复制到各错题正式目录');
    console.log('  - 模块、题号、错题、标签、图片、关系和来源记录在同一事务写入');
    console.log('  - 同名模块自动生成“（导入）”名称，自定义错因映射本机稳定 ID');
    console.log('  - 注入事务故障后数据库全部回滚，正式图片和暂存目录均已清理');
  } finally {
    database.close();
  }
}

main()
  .catch((error) => {
    console.error('[module-import-execution-v1] 检查失败：', error);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

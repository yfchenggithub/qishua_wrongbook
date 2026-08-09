#!/usr/bin/env node
/* eslint-disable no-console */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CREATED_AT = '2026-08-08T12:00:00.000Z';

let imageFixture;
let moduleReadCount = 0;

const mistakes = [
  {
    id: 'M002',
    subject: 'math',
    module: '圆锥精选',
    module_id: 12,
    question_no: 2,
    title: '第二题',
    error_reason: '不会',
    error_reason_ids: '{broken-json',
    difficulty: 3,
    note: null,
    my_solution_text: '先设参数',
    answer_text: null,
    note_highlights: null,
    review_count: 4,
    status: 'active',
    created_at: '2026-08-02T00:00:00.000Z',
    updated_at: '2026-08-02T00:00:00.000Z',
    is_pinned: true,
  },
  {
    id: 'M001',
    subject: 'math',
    module: '圆锥精选',
    module_id: 12,
    question_no: 1,
    title: '  第一道题  ',
    error_reason: '粗心、符号错误',
    error_reason_ids: JSON.stringify(['builtin:reason:careless', 'custom:42']),
    difficulty: 4,
    note: '注意定义域',
    my_solution_text: null,
    answer_text: '答案文字',
    note_highlights: JSON.stringify([{ start: 0, end: 2, color: 'yellow' }]),
    review_count: 7,
    status: 'mastered',
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    is_pinned: false,
  },
];

function makeImageFixture() {
  return new Map([
    ['M001', [
      {
        id: 'IMG-REVIEW',
        mistake_id: 'M001',
        review_record_id: 'R001',
        type: 'review_solution',
        uri: 'file:///review.jpg',
        sort_order: 0,
        created_at: CREATED_AT,
      },
      {
        id: 'IMG-ANSWER-BLANK',
        mistake_id: 'M001',
        type: 'answer',
        uri: '   ',
        sort_order: 0,
        created_at: CREATED_AT,
      },
      {
        id: 'IMG-Q1-BLANK',
        mistake_id: 'M001',
        type: 'question',
        uri: '',
        sort_order: 1,
        created_at: CREATED_AT,
      },
      {
        id: 'IMG-Q1',
        mistake_id: 'M001',
        type: 'question',
        uri: 'file:///question-1.jpg',
        sort_order: 0,
        created_at: CREATED_AT,
      },
    ]],
    ['M002', [
      {
        id: 'IMG-SOLUTION-2',
        mistake_id: 'M002',
        type: 'my_solution',
        uri: 'file:///solution-2.jpg',
        sort_order: 0,
        created_at: CREATED_AT,
      },
      {
        id: 'IMG-Q2',
        mistake_id: 'M002',
        type: 'question',
        uri: 'file:///question-2.jpg',
        sort_order: 0,
        created_at: CREATED_AT,
      },
    ]],
  ]);
}

const repositoryMocks = {
  ModuleRepository: {
    async listAllModules() {
      return [
        {
          id: 1,
          type: 'system',
          name: '函数',
          display_code: 'A',
          custom_no: null,
          icon: 'functions',
          color: '#34C759',
          sort_order: 0,
          is_active: true,
          created_at: CREATED_AT,
          updated_at: CREATED_AT,
        },
        {
          id: 11,
          type: 'unclassified',
          name: '未分类',
          display_code: 'Z',
          custom_no: null,
          icon: 'help-outline',
          color: '#8E8E93',
          sort_order: 10,
          is_active: true,
          created_at: CREATED_AT,
          updated_at: CREATED_AT,
        },
        {
          id: 12,
          type: 'custom',
          name: '圆锥精选',
          display_code: 'U001',
          custom_no: 1,
          icon: 'label',
          color: '#34C759',
          sort_order: 0,
          is_active: true,
          created_at: CREATED_AT,
          updated_at: CREATED_AT,
        },
        {
          id: 13,
          type: 'custom',
          name: '停用模块',
          display_code: 'U002',
          custom_no: 2,
          icon: 'label',
          color: '#34C759',
          sort_order: 1,
          is_active: false,
          created_at: CREATED_AT,
          updated_at: CREATED_AT,
        },
      ];
    },
    async getModuleById(moduleId) {
      moduleReadCount += 1;
      assert.equal(moduleId, 12);
      return {
        id: 12,
        type: 'custom',
        name: '圆锥精选',
        display_code: 'U001',
        custom_no: 1,
        icon: 'label',
        color: '#34C759',
        sort_order: 0,
        is_active: true,
        created_at: CREATED_AT,
        updated_at: CREATED_AT,
      };
    },
  },
  MistakeRepository: {
    async countMistakesByModuleId() {
      return [
        { moduleId: 1, count: 0 },
        { moduleId: 11, count: 1 },
        { moduleId: 12, count: 2 },
        { moduleId: 13, count: 3 },
      ];
    },
    async listMistakes(options) {
      assert.deepEqual(options, { status: 'all', moduleId: 12, limit: null });
      return mistakes;
    },
  },
  MistakeImageRepository: {
    async getImagesByMistakeIds(ids) {
      assert.deepEqual(ids, ['M001', 'M002']);
      return imageFixture;
    },
  },
  MistakeTagRepository: {
    async listTagsByMistakeIds(ids) {
      assert.deepEqual(ids, ['M001', 'M002']);
      return new Map([
        ['M001', [
          { id: 'T1', mistake_id: 'M001', name: '椭圆', normalized_name: '椭圆', sort_order: 0 },
        ]],
        ['M002', [
          { id: 'T2', mistake_id: 'M002', name: '参数法', normalized_name: '参数法', sort_order: 0 },
        ]],
      ]);
    },
  },
  MistakeRelationRepository: {
    async listRelationsWithinModule(moduleId) {
      assert.equal(moduleId, 12);
      return [{
        id: 'REL1',
        source_mistake_id: 'M002',
        target_mistake_id: 'M001',
        source: 'manual',
        created_at: CREATED_AT,
      }];
    },
  },
  CustomErrorReasonRepository: {
    async listCustomErrorReasons() {
      return [{
        id: '42',
        name: '符号错误',
        icon: 'error-outline',
        color: '#F59E0B',
        sort_order: 0,
        created_at: CREATED_AT,
        updated_at: CREATED_AT,
      }];
    },
  },
};

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
    if (request === '@/src/repositories') {
      return repositoryMocks;
    }
    if (request === '@/src/services/Logger') {
      return { Logger: { info() {}, warn() {}, error() {} } };
    }
    if (request === 'expo-constants') {
      return {
        __esModule: true,
        default: { expoConfig: { name: '七刷错题本', version: '1.0.0' } },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
}

function verifyReadOnlyBoundary() {
  const source = fs.readFileSync(
    path.join(PROJECT_ROOT, 'src/services/moduleTransfer/ModuleExportService.ts'),
    'utf8',
  );
  assert.doesNotMatch(source, /expo-file-system|expo-sharing/u);
  assert.doesNotMatch(source, /\b(?:runAsync|execAsync|withDatabaseTransaction)\b/u);
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE)\b/u);
}

async function verifyMapping() {
  imageFixture = makeImageFixture();
  const { prepareModuleExportPayload } = require(
    path.join(PROJECT_ROOT, 'src/services/moduleTransfer/ModuleExportService.ts'),
  );

  const invalid = await prepareModuleExportPayload({ moduleId: 0 });
  assert.deepEqual(invalid, {
    ok: false,
    code: 'invalid_input',
    message: 'moduleId 必须是正整数。',
  });
  assert.equal(moduleReadCount, 0, '非法输入不应读取数据库');

  const result = await prepareModuleExportPayload({
    moduleId: 12,
    packageId: 'PKG-test-0001',
    createdAt: CREATED_AT,
    creatorName: ' 小七 ',
    description: ' 二轮复习 ',
  });
  assert.equal(result.ok, true);
  const prepared = result.value;
  assert.equal(prepared.sourceModuleId, 12);
  assert.deepEqual(prepared.payload.manifest.counts, {
    questions: 2,
    images: 3,
    relations: 1,
  });
  assert.equal(prepared.payload.manifest.creator.displayName, '小七');
  assert.equal(prepared.payload.manifest.module.description, '二轮复习');
  assert.deepEqual(
    prepared.payload.data.questions.map((question) => question.itemId),
    ['Q001', 'Q002'],
  );
  assert.equal(prepared.payload.data.questions[0].title, '第一道题');
  assert.deepEqual(prepared.payload.data.questions[0].errorReasons, [
    { kind: 'builtin', key: 'builtin:reason:careless', name: '粗心' },
    { kind: 'custom', name: '符号错误' },
  ]);
  assert.deepEqual(prepared.payload.data.questions[1].errorReasons, [
    { kind: 'builtin', key: 'builtin:reason:unknown', name: '不会' },
  ]);
  assert.deepEqual(prepared.payload.data.relations, [
    { sourceItemId: 'Q001', targetItemId: 'Q002' },
  ]);
  assert.deepEqual(
    prepared.assets.map(({ assetId, type, relativePath }) => ({ assetId, type, relativePath })),
    [
      { assetId: 'ASSET0001', type: 'question', relativePath: 'images/Q001/question_001.jpg' },
      { assetId: 'ASSET0002', type: 'question', relativePath: 'images/Q002/question_001.jpg' },
      { assetId: 'ASSET0003', type: 'my_solution', relativePath: 'images/Q002/my_solution_001.jpg' },
    ],
  );
  assert.ok(prepared.assets.every((asset) => asset.sourceImageId !== 'IMG-REVIEW'));
  assert.deepEqual(
    prepared.warnings.map(({ code, count }) => ({ code, count })),
    [
      { code: 'invalid_error_reason_ids', count: 1 },
      { code: 'ignored_invalid_question_image_uri', count: 1 },
      { code: 'ignored_optional_image_uri', count: 1 },
    ],
  );

  imageFixture = new Map([
    ['M001', []],
    ['M002', makeImageFixture().get('M002')],
  ]);
  const missingQuestion = await prepareModuleExportPayload({ moduleId: 12 });
  assert.equal(missingQuestion.ok, false);
  assert.equal(missingQuestion.code, 'missing_question_image');
}

async function verifyCandidateListing() {
  const { listModuleExportCandidates } = require(
    path.join(PROJECT_ROOT, 'src/services/moduleTransfer/ModuleExportService.ts'),
  );
  const result = await listModuleExportCandidates();
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, [
    {
      moduleId: 1,
      name: '函数',
      displayCode: 'A',
      type: 'system',
      icon: 'functions',
      color: '#34C759',
      questionCount: 0,
    },
    {
      moduleId: 12,
      name: '圆锥精选',
      displayCode: 'U001',
      type: 'custom',
      icon: 'label',
      color: '#34C759',
      questionCount: 2,
    },
  ]);
}

async function main() {
  verifyReadOnlyBoundary();
  installTypeScriptLoader();
  await verifyCandidateListing();
  await verifyMapping();
  console.log('[module-export-v1] 检查通过：');
    console.log('  - 服务不写数据库、不读写文件、不调用系统分享');
    console.log('  - 可导出模块候选包含题数，并排除未分类与停用模块');
  console.log('  - manifest/module payload 通过真实 V1 校验器');
  console.log('  - 题目、图片、错因、标签与内部关联映射稳定');
  console.log('  - 复做图片被排除，缺少必需题目图时导出失败');
}

main().catch((error) => {
  console.error('[module-export-v1] 检查失败：', error);
  process.exitCode = 1;
});

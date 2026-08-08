#!/usr/bin/env node
/* eslint-disable no-console */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const ts = require('typescript');
const { strToU8, Zip, ZipDeflate, ZipPassThrough, zipSync } = require('fflate');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'qishua-module-preview-'));
const CREATED_AT = '2026-08-09T01:00:00.000Z';
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0xff, 0xd9]);
const NOT_JPEG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

function toFilePath(uriOrPath) {
  return uriOrPath.startsWith('file:') ? fileURLToPath(uriOrPath) : uriOrPath;
}

class NodeFileHandle {
  constructor(filePath) {
    this.fd = fs.openSync(filePath, 'r');
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
}

class NodeFile {
  constructor(uriOrPath) {
    this.path = path.resolve(toFilePath(uriOrPath));
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

  open() {
    return new NodeFileHandle(this.path);
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
      return { File: NodeFile };
    }
    if (request === '@/src/services/Logger') {
      return { Logger: { info() {}, warn() {}, error() {} } };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
}

function buildPayload(format = 'qishua_module') {
  return {
    manifest: {
      format,
      formatVersion: 1,
      packageId: 'PKG-preview-test-0001',
      contentVersion: 1,
      appName: '七刷错题本',
      appVersion: '1.0.0',
      createdAt: CREATED_AT,
      creator: { displayName: '小七' },
      module: {
        name: '函数精选',
        description: '导入预览测试',
        subject: 'math',
        icon: 'label',
        color: '#34C759',
      },
      counts: { questions: 1, images: 1, relations: 0 },
      warnings: ['作者身份未经认证'],
    },
    data: {
      questions: [{
        itemId: 'Q001',
        position: 1,
        subject: 'math',
        title: '函数零点',
        difficulty: 3,
        errorReasons: [],
        note: null,
        noteHighlights: [],
        mySolutionText: null,
        answerText: '答案内容',
        tags: ['函数'],
        images: [{
          assetId: 'ASSET0001',
          type: 'question',
          sortOrder: 0,
          relativePath: 'images/Q001/question_001.jpg',
        }],
      }],
      relations: [],
    },
  };
}

function buildArchiveEntries(payload, imageBytes = JPEG_BYTES, extras = {}) {
  return {
    'manifest.json': strToU8(JSON.stringify(payload.manifest)),
    'module.json': strToU8(JSON.stringify(payload.data)),
    'images/Q001/question_001.jpg': imageBytes,
    ...extras,
  };
}

function writeArchive(fileName, entries) {
  const filePath = path.join(TEST_ROOT, fileName);
  fs.writeFileSync(filePath, zipSync(entries, { level: 6 }));
  return {
    filePath,
    fileUri: pathToFileURL(filePath).href,
    sizeBytes: fs.statSync(filePath).size,
  };
}

function writeStreamingArchive(fileName, entries) {
  const chunks = [];
  let streamError = null;
  let finalized = false;
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      streamError = error;
      return;
    }
    if (chunk.byteLength > 0) {
      chunks.push(Buffer.from(chunk));
    }
    finalized = final;
  });
  for (const [relativePath, bytes] of Object.entries(entries)) {
    const entry = relativePath.endsWith('.json')
      ? new ZipDeflate(relativePath, { level: 6 })
      : new ZipPassThrough(relativePath);
    zip.add(entry);
    entry.push(bytes, true);
  }
  zip.end();
  assert.equal(streamError, null);
  assert.equal(finalized, true);
  const filePath = path.join(TEST_ROOT, fileName);
  fs.writeFileSync(filePath, Buffer.concat(chunks));
  return {
    filePath,
    fileUri: pathToFileURL(filePath).href,
    sizeBytes: fs.statSync(filePath).size,
  };
}

function verifyReadOnlyBoundary() {
  const source = fs.readFileSync(
    path.join(PROJECT_ROOT, 'src/services/moduleTransfer/ModuleImportPreviewService.ts'),
    'utf8',
  );
  assert.doesNotMatch(source, /\b(?:Directory|create|delete|write|runAsync|execAsync)\b/u);
  assert.doesNotMatch(source, /repositories|expo-sharing|expo-router/u);
}

async function verifyPreviewService() {
  const { readModuleImportPreview } = require(
    path.join(PROJECT_ROOT, 'src/services/moduleTransfer/ModuleImportPreviewService.ts'),
  );
  const payload = buildPayload();
  const valid = writeStreamingArchive('valid.qsm', buildArchiveEntries(payload));
  const result = await readModuleImportPreview({
    fileUri: valid.fileUri,
    fileName: 'valid.qsm',
    fileSizeBytes: valid.sizeBytes,
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.preview.packageId, payload.manifest.packageId);
  assert.equal(result.value.preview.module.name, '函数精选');
  assert.equal(result.value.preview.creatorName, '小七');
  assert.deepEqual(result.value.preview.counts, { questions: 1, images: 1, relations: 0 });
  assert.equal(result.value.preview.questions[0].hasAnswer, true);
  assert.equal(result.value.preview.questions[0].hasMySolution, false);
  assert.deepEqual(result.value.preview.warnings, ['作者身份未经认证']);
  assert.equal(result.value.entries.length, 3);
  assert.equal(result.value.images.length, 1);
  assert.equal(result.value.images[0].relativePath, 'images/Q001/question_001.jpg');
  assert.equal(result.value.images[0].sizeBytes, JPEG_BYTES.byteLength);
  assert.deepEqual(result.value.payload, payload);

  const wrongExtension = await readModuleImportPreview({
    fileUri: valid.fileUri,
    fileName: 'backup.qsbk',
    fileSizeBytes: valid.sizeBytes,
  });
  assert.equal(wrongExtension.ok, false);
  assert.equal(wrongExtension.code, 'invalid_extension');

  const invalidImage = writeArchive(
    'invalid-image.qsm',
    buildArchiveEntries(payload, NOT_JPEG_BYTES),
  );
  const invalidImageResult = await readModuleImportPreview({
    fileUri: invalidImage.fileUri,
    fileName: 'invalid-image.qsm',
  });
  assert.equal(invalidImageResult.ok, false);
  assert.equal(invalidImageResult.code, 'image_invalid');

  const missingImageEntries = buildArchiveEntries(payload);
  delete missingImageEntries['images/Q001/question_001.jpg'];
  const missingImage = writeArchive('missing-image.qsm', missingImageEntries);
  const missingImageResult = await readModuleImportPreview({
    fileUri: missingImage.fileUri,
    fileName: 'missing-image.qsm',
  });
  assert.equal(missingImageResult.ok, false);
  assert.equal(missingImageResult.code, 'archive_invalid');
  assert.ok(missingImageResult.validationIssues.some((issue) => issue.code === 'missing_file'));

  const unsafe = writeArchive(
    'unsafe.qsm',
    buildArchiveEntries(payload, JPEG_BYTES, { '../escape.jpg': JPEG_BYTES }),
  );
  const unsafeResult = await readModuleImportPreview({
    fileUri: unsafe.fileUri,
    fileName: 'unsafe.qsm',
  });
  assert.equal(unsafeResult.ok, false);
  assert.equal(unsafeResult.code, 'unsafe_entry_path');

  const duplicatePath = writeArchive(
    'duplicate-path.qsm',
    buildArchiveEntries(payload, JPEG_BYTES, {
      'Manifest.JSON': strToU8(JSON.stringify(payload.manifest)),
    }),
  );
  const duplicatePathResult = await readModuleImportPreview({
    fileUri: duplicatePath.fileUri,
    fileName: 'duplicate-path.qsm',
  });
  assert.equal(duplicatePathResult.ok, false);
  assert.equal(duplicatePathResult.code, 'duplicate_entry');

  const oversizedManifest = writeArchive('oversized.qsm', {
    'manifest.json': strToU8(' '.repeat(1024 * 1024 + 1)),
    'module.json': strToU8('{}'),
  });
  assert.ok(oversizedManifest.sizeBytes < 10000, '夹具应模拟高压缩比 JSON 条目');
  const oversizedResult = await readModuleImportPreview({
    fileUri: oversizedManifest.fileUri,
    fileName: 'oversized.qsm',
  });
  assert.equal(oversizedResult.ok, false);
  assert.equal(oversizedResult.code, 'entry_size_limit_exceeded');

  const wrongFormatPayload = buildPayload('qishua_backup');
  const wrongFormat = writeArchive(
    'wrong-format.qsm',
    buildArchiveEntries(wrongFormatPayload),
  );
  const wrongFormatResult = await readModuleImportPreview({
    fileUri: wrongFormat.fileUri,
    fileName: 'wrong-format.qsm',
  });
  assert.equal(wrongFormatResult.ok, false);
  assert.equal(wrongFormatResult.code, 'invalid_format');
}

async function main() {
  try {
    verifyReadOnlyBoundary();
    installTypeScriptLoader();
    await verifyPreviewService();
    console.log('[module-preview-v1] 检查通过：');
    console.log('  - 真实 .qsm 可流式解析为校验后的 payload 与只读预览');
    console.log('  - 图片条目、大小、JPEG 内容和 JSON 文件均已校验');
    console.log('  - 缺图、错误扩展名、错误格式与路径穿越会被拒绝');
    console.log('  - 高压缩超限条目在 JSON 解析前被阻断');
    console.log('  - 服务不写文件、不写数据库、不接页面或系统分享');
  } finally {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('[module-preview-v1] 检查失败：', error);
  process.exitCode = 1;
});

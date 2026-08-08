#!/usr/bin/env node
/* eslint-disable no-console */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const ts = require('typescript');
const { strFromU8, unzipSync } = require('fflate');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'qishua-module-archive-'));
const CREATED_AT = '2026-08-08T12:00:00.000Z';
const COPIED_JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0xff, 0xd9]);
const CONVERTED_JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x03, 0x04, 0xff, 0xd9]);
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let conversionCount = 0;
const convertedPaths = [];

function normalizePart(value) {
  if (value instanceof NodeFile || value instanceof NodeDirectory) {
    return value.path;
  }
  if (typeof value !== 'string') {
    throw new Error('Unsupported path input.');
  }
  return value.startsWith('file:') ? fileURLToPath(value) : value;
}

function joinParts(parts) {
  const normalized = parts.map(normalizePart);
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
    const target = Buffer.alloc(length);
    const bytesRead = fs.readSync(this.fd, target, 0, length, this.offset);
    this.offset += bytesRead;
    return new Uint8Array(target.subarray(0, bytesRead));
  }

  writeBytes(bytes) {
    const source = Buffer.from(bytes);
    const bytesWritten = fs.writeSync(this.fd, source, 0, source.length, this.offset);
    this.offset += bytesWritten;
  }

  get size() {
    return fs.fstatSync(this.fd).size;
  }
}

class NodeDirectory {
  constructor(...parts) {
    this.path = joinParts(parts);
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
      throw new Error('Directory already exists.');
    }
    fs.mkdirSync(this.path, { recursive: options.intermediates === true });
  }
}

class NodeFile {
  constructor(...parts) {
    this.path = joinParts(parts);
    this.uri = pathToFileURL(this.path).href;
  }

  get exists() {
    return fs.existsSync(this.path) && fs.statSync(this.path).isFile();
  }

  get size() {
    return this.exists ? fs.statSync(this.path).size : 0;
  }

  info() {
    return {
      exists: this.exists,
      uri: this.uri,
      size: this.size,
    };
  }

  create(options = {}) {
    if (options.intermediates) {
      fs.mkdirSync(path.dirname(this.path), { recursive: true });
    }
    const flag = options.overwrite ? 'w' : 'wx';
    const fd = fs.openSync(this.path, flag);
    fs.closeSync(fd);
  }

  delete() {
    fs.unlinkSync(this.path);
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
      return {
        Directory: NodeDirectory,
        File: NodeFile,
        Paths: { cache: new NodeDirectory(TEST_ROOT) },
      };
    }
    if (request === 'expo-image-manipulator') {
      return {
        SaveFormat: { JPEG: 'jpeg' },
        async manipulateAsync(sourceUri, actions, options) {
          assert.deepEqual(actions, []);
          assert.equal(options.format, 'jpeg');
          assert.equal(options.base64, false);
          assert.ok(options.compress > 0 && options.compress <= 1);
          assert.ok(fs.existsSync(fileURLToPath(sourceUri)));
          conversionCount += 1;
          const outputPath = path.join(TEST_ROOT, `converted-${conversionCount}.jpg`);
          fs.writeFileSync(outputPath, CONVERTED_JPEG_BYTES);
          convertedPaths.push(outputPath);
          return { uri: pathToFileURL(outputPath).href, width: 1, height: 1 };
        },
      };
    }
    if (request === '@/src/services/Logger') {
      return { Logger: { info() {}, warn() {}, error() {} } };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
}

function buildPreparedExport(copiedJpegUri, pngUri) {
  return {
    sourceModuleId: 12,
    payload: {
      manifest: {
        format: 'qishua_module',
        formatVersion: 1,
        packageId: 'PKG-test-archive-0001',
        contentVersion: 1,
        appName: '七刷错题本',
        appVersion: '1.0.0',
        createdAt: CREATED_AT,
        creator: { displayName: '小七' },
        module: {
          name: '圆锥精选',
          description: '归档测试',
          subject: 'math',
          icon: 'label',
          color: '#34C759',
        },
        counts: { questions: 1, images: 2, relations: 0 },
        warnings: [],
      },
      data: {
        questions: [{
          itemId: 'Q001',
          position: 1,
          subject: 'math',
          title: '椭圆离心率',
          difficulty: 4,
          errorReasons: [],
          note: null,
          noteHighlights: [],
          mySolutionText: null,
          answerText: null,
          tags: ['椭圆'],
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
        }],
        relations: [],
      },
    },
    assets: [
      {
        assetId: 'ASSET0001',
        sourceImageId: 'IMG001',
        sourceMistakeId: 'M001',
        sourceUri: copiedJpegUri,
        type: 'question',
        relativePath: 'images/Q001/question_001.jpg',
      },
      {
        assetId: 'ASSET0002',
        sourceImageId: 'IMG002',
        sourceMistakeId: 'M001',
        sourceUri: pngUri,
        type: 'answer',
        relativePath: 'images/Q001/answer_001.jpg',
      },
    ],
    warnings: [],
  };
}

function verifyNoPageOrShareDependency() {
  const source = fs.readFileSync(
    path.join(PROJECT_ROOT, 'src/services/moduleTransfer/ModulePackageArchiveService.ts'),
    'utf8',
  );
  assert.doesNotMatch(source, /expo-sharing|expo-router|\/app\//u);
}

async function verifyArchiveCreation() {
  const copiedJpegPath = path.join(TEST_ROOT, 'source-question.jpg');
  const pngPath = path.join(TEST_ROOT, 'source-answer.png');
  fs.writeFileSync(copiedJpegPath, COPIED_JPEG_BYTES);
  fs.writeFileSync(pngPath, PNG_BYTES);
  const prepared = buildPreparedExport(
    pathToFileURL(copiedJpegPath).href,
    pathToFileURL(pngPath).href,
  );

  const { createModulePackageArchive } = require(
    path.join(PROJECT_ROOT, 'src/services/moduleTransfer/ModulePackageArchiveService.ts'),
  );
  const progress = [];
  const result = await createModulePackageArchive({
    prepared,
    fileName: '圆锥精选.qsm',
    onAssetPacked: (event) => progress.push(event),
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.fileName, '圆锥精选.qsm');
  assert.equal(result.value.copiedImageCount, 1);
  assert.equal(result.value.convertedImageCount, 1);
  assert.equal(result.value.entries.length, 4);
  assert.ok(result.value.sizeBytes > 0);
  assert.deepEqual(progress.map((item) => item.mode), ['copied', 'converted']);

  const archivePath = fileURLToPath(result.value.fileUri);
  const archive = unzipSync(new Uint8Array(fs.readFileSync(archivePath)));
  assert.deepEqual(Object.keys(archive).sort(), [
    'images/Q001/answer_001.jpg',
    'images/Q001/question_001.jpg',
    'manifest.json',
    'module.json',
  ]);
  assert.deepEqual(
    JSON.parse(strFromU8(archive['manifest.json'])),
    prepared.payload.manifest,
  );
  assert.deepEqual(
    JSON.parse(strFromU8(archive['module.json'])),
    prepared.payload.data,
  );
  assert.deepEqual(
    Buffer.from(archive['images/Q001/question_001.jpg']),
    COPIED_JPEG_BYTES,
  );
  assert.deepEqual(
    Buffer.from(archive['images/Q001/answer_001.jpg']),
    CONVERTED_JPEG_BYTES,
  );
  assert.equal(conversionCount, 1);
  assert.ok(convertedPaths.every((convertedPath) => !fs.existsSync(convertedPath)));

  const invalidMapping = {
    ...prepared,
    assets: prepared.assets.map((asset, index) => (
      index === 0 ? { ...asset, relativePath: 'images/Q001/wrong.jpg' } : asset
    )),
  };
  const mappingFailure = await createModulePackageArchive({ prepared: invalidMapping });
  assert.equal(mappingFailure.ok, false);
  assert.equal(mappingFailure.code, 'asset_mapping_invalid');

  const missingSource = {
    ...prepared,
    assets: prepared.assets.map((asset, index) => (
      index === 0
        ? { ...asset, sourceUri: pathToFileURL(path.join(TEST_ROOT, 'missing.jpg')).href }
        : asset
    )),
  };
  const missingFailure = await createModulePackageArchive({ prepared: missingSource });
  assert.equal(missingFailure.ok, false);
  assert.equal(missingFailure.code, 'source_image_missing');
  assert.equal(missingFailure.assetId, 'ASSET0001');

  const exportDirectory = path.join(TEST_ROOT, 'qishua_module_exports');
  assert.deepEqual(
    fs.readdirSync(exportDirectory).filter((name) => name.endsWith('.qsm')),
    ['圆锥精选.qsm'],
    '失败流程不应留下半成品题包',
  );
}

async function main() {
  try {
    verifyNoPageOrShareDependency();
    installTypeScriptLoader();
    await verifyArchiveCreation();
    console.log('[module-archive-v1] 检查通过：');
    console.log('  - 实际 ZIP 包含 manifest.json、module.json 和全部声明图片');
    console.log('  - JPEG 直接复制，非 JPEG 转换后以协议路径写入');
    console.log('  - 生成结果通过真实 V1 payload 与归档校验器');
    console.log('  - 临时转换图片与失败半成品均会清理');
    console.log('  - 服务未接页面或系统分享');
  } finally {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('[module-archive-v1] 检查失败：', error);
  process.exitCode = 1;
});

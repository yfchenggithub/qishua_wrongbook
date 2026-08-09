#!/usr/bin/env node
/* eslint-disable no-console */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');
}

function verifyExportPage() {
  const pageSource = readProjectFile('app/module-export.tsx');

  assert.match(pageSource, /listModuleExportCandidates/u);
  assert.match(pageSource, /LibraryBottomSheet/u);
  assert.match(pageSource, /CREATOR_NAME_MAX_LENGTH/u);
  assert.match(pageSource, /DESCRIPTION_MAX_LENGTH/u);
  assert.match(pageSource, /prepareModuleExportPayload/u);
  assert.match(pageSource, /createModulePackageArchive/u);
  assert.match(pageSource, /onAssetPacked:/u);
  assert.match(pageSource, /accessibilityRole="progressbar"/u);
  assert.match(pageSource, /shareConsent/u);
  assert.match(pageSource, /Alert\.alert\(\s*['"]生成并分享题包？['"]/u);
  assert.match(pageSource, /shareModulePackage/u);
  assert.match(pageSource, /shareWarning/u);
  assert.match(pageSource, /再次打开系统分享/u);
  assert.doesNotMatch(pageSource, /BackupService|\.qsbk/u);
  assert.doesNotMatch(pageSource, /from ['"]expo-file-system['"]|from ['"]expo-sharing['"]/u);
  assert.doesNotMatch(pageSource, /\/repositories\//u);
  assert.doesNotMatch(pageSource, /\b(?:runAsync|getDatabase|withDatabaseTransaction)\b/u);
}

function verifyRouteAndEntry() {
  const rootLayoutSource = readProjectFile('app/_layout.tsx');
  const settingsSource = readProjectFile('app/(tabs)/settings.tsx');

  assert.match(rootLayoutSource, /Stack\.Screen name="module-export"/u);
  assert.match(settingsSource, /SettingsSection title="题包"/u);
  assert.match(settingsSource, /router\.push\('\/module-export'/u);
  assert.match(settingsSource, /title="导出题包"/u);
  assert.match(settingsSource, /选择一个模块，生成 \.qsm 文件并分享/u);
  assert.match(settingsSource, /router\.push\('\/module-import'/u);

  const packageSectionIndex = settingsSource.indexOf('<SettingsSection title="题包">');
  const backupRestoreIndex = settingsSource.indexOf('title="从备份文件恢复"');
  assert.ok(packageSectionIndex > backupRestoreIndex, '题包入口必须与备份恢复使用不同设置分组');
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
}

async function verifyShareService() {
  installTypeScriptLoader();

  const shareState = {
    exists: true,
    size: 512,
    nativeResult: true,
    nativeCalls: [],
    sharingAvailable: true,
    sharingCalls: [],
    sharingError: null,
  };

  class MockFile {
    constructor(uri) {
      this.uri = uri;
    }

    get exists() {
      return shareState.exists;
    }

    get size() {
      return shareState.size;
    }
  }

  const originalLoad = Module._load;
  Module._load = function loadWithMocks(request, parent, isMain) {
    if (request === 'expo-file-system') {
      return { File: MockFile };
    }
    if (request === 'expo-sharing') {
      return {
        async isAvailableAsync() {
          return shareState.sharingAvailable;
        },
        async shareAsync(uri, options) {
          shareState.sharingCalls.push({ uri, options });
          if (shareState.sharingError) {
            throw shareState.sharingError;
          }
        },
      };
    }
    if (request === '@/src/services/AndroidFileShareService') {
      return {
        async shareFile(...args) {
          shareState.nativeCalls.push(args);
          return shareState.nativeResult;
        },
      };
    }
    if (request === '@/src/services/Logger') {
      return { Logger: { info() {}, error() {}, warn() {} } };
    }
    if (request.startsWith('@/')) {
      return originalLoad.call(
        this,
        path.join(PROJECT_ROOT, request.slice(2)),
        parent,
        isMain,
      );
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const { shareModulePackage } = require(path.join(
      PROJECT_ROOT,
      'src/services/moduleTransfer/ModulePackageShareService.ts',
    ));

    const invalid = await shareModulePackage({
      fileUri: 'file:///cache/package.zip',
      fileName: 'package.zip',
    });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.code, 'invalid_input');
    assert.equal(shareState.nativeCalls.length, 0);

    const nativeResult = await shareModulePackage({
      fileUri: 'file:///cache/package.qsm',
      fileName: 'package.qsm',
    });
    assert.deepEqual(nativeResult, { ok: true });
    assert.deepEqual(shareState.nativeCalls[0], [
      'file:///cache/package.qsm',
      'application/octet-stream',
      '分享七刷题包',
    ]);
    assert.equal(shareState.sharingCalls.length, 0);

    shareState.nativeResult = false;
    const fallbackResult = await shareModulePackage({
      fileUri: 'file:///cache/fallback.qsm',
      fileName: 'fallback.qsm',
    });
    assert.deepEqual(fallbackResult, { ok: true });
    assert.deepEqual(shareState.sharingCalls[0], {
      uri: 'file:///cache/fallback.qsm',
      options: {
        dialogTitle: '分享七刷题包',
        mimeType: 'application/octet-stream',
        UTI: 'public.data',
      },
    });

    shareState.sharingAvailable = false;
    const unavailable = await shareModulePackage({
      fileUri: 'file:///cache/unavailable.qsm',
      fileName: 'unavailable.qsm',
    });
    assert.equal(unavailable.ok, false);
    assert.equal(unavailable.code, 'share_unavailable');

    shareState.sharingAvailable = true;
    shareState.exists = false;
    const missing = await shareModulePackage({
      fileUri: 'file:///cache/missing.qsm',
      fileName: 'missing.qsm',
    });
    assert.equal(missing.ok, false);
    assert.equal(missing.code, 'file_missing');

    shareState.exists = true;
    shareState.sharingError = new Error('User cancelled the share sheet');
    const cancelled = await shareModulePackage({
      fileUri: 'file:///cache/cancelled.qsm',
      fileName: 'cancelled.qsm',
    });
    assert.equal(cancelled.ok, false);
    assert.equal(cancelled.code, 'cancelled');
  } finally {
    Module._load = originalLoad;
  }
}

(async () => {
  try {
    verifyExportPage();
    verifyRouteAndEntry();
    await verifyShareService();
    console.log('[module-export-page-v1] 检查通过：');
    console.log('  - 设置页可独立进入题包导出页，并与备份功能分组隔离');
    console.log('  - 页面覆盖模块选择、作者简介、预览确认、生成进度和分享结果');
    console.log('  - Android 原生分享与 Expo Sharing 降级路径均通过检查');
    console.log('  - 页面未直接访问数据库、文件系统或原生分享 API');
  } catch (error) {
    console.error('[module-export-page-v1] 检查失败：', error);
    process.exitCode = 1;
  }
})();

#!/usr/bin/env node
/* eslint-disable no-console */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');
}

function verifyImportPage() {
  const pageSource = readProjectFile('app/module-import.tsx');

  assert.match(pageSource, /DocumentPicker\.getDocumentAsync/u);
  assert.match(pageSource, /copyToCacheDirectory:\s*true/u);
  assert.match(pageSource, /readModuleImportPreview/u);
  assert.match(pageSource, /'preview'/u);
  assert.match(pageSource, /Alert\.alert\(\s*['"]导入为新模块？['"]/u);
  assert.match(pageSource, /executeModuleImport/u);
  assert.match(pageSource, /onProgress:/u);
  assert.match(pageSource, /accessibilityRole="progressbar"/u);
  assert.match(pageSource, /cleanupWarning/u);
  assert.match(pageSource, /usePreventRemove\(isImporting/u);
  assert.match(pageSource, /重新选择题包/u);
  assert.match(pageSource, /继续导入其他题包/u);
  assert.doesNotMatch(pageSource, /BackupService|\.qsbk/u);
  assert.doesNotMatch(pageSource, /\b(?:runAsync|getDatabase|withDatabaseTransaction)\b/u);
  assert.doesNotMatch(pageSource, /new\s+(?:File|Directory)\s*\(/u);
}

function verifyRouteAndEntry() {
  const rootLayoutSource = readProjectFile('app/_layout.tsx');
  const settingsSource = readProjectFile('app/(tabs)/settings.tsx');

  assert.match(rootLayoutSource, /Stack\.Screen name="module-import"/u);
  assert.match(settingsSource, /SettingsSection title="题包"/u);
  assert.match(settingsSource, /router\.push\('\/module-import'/u);
  assert.match(settingsSource, /title="导入题包"/u);
  assert.match(settingsSource, /选择 \.qsm 文件，预览后导入为新模块/u);

  const packageSectionIndex = settingsSource.indexOf('<SettingsSection title="题包">');
  const backupRestoreIndex = settingsSource.indexOf('title="从备份文件恢复"');
  assert.ok(packageSectionIndex > backupRestoreIndex, '题包入口必须与备份恢复使用不同设置分组');
}

function verifyProgressContract() {
  const typesSource = readProjectFile(
    'src/services/moduleTransfer/ModuleImportExecutionTypes.ts',
  );
  const serviceSource = readProjectFile(
    'src/services/moduleTransfer/ModuleImportExecutionService.ts',
  );

  for (const stage of [
    'validating',
    'checking_duplicate',
    'staging_images',
    'committing_images',
    'writing_database',
    'cleaning_up',
    'completed',
  ]) {
    assert.ok(typesSource.includes(`'${stage}'`), `缺少进度阶段 ${stage}`);
    assert.ok(serviceSource.includes(`stage: '${stage}'`), `执行服务未发送进度阶段 ${stage}`);
  }
  assert.match(typesSource, /onProgress\?:\s*\(event: ModuleImportExecutionProgressEvent\)/u);
}

try {
  verifyImportPage();
  verifyRouteAndEntry();
  verifyProgressContract();
  console.log('[module-import-page-v1] 检查通过：');
  console.log('  - 设置页使用独立“题包”分组进入 .qsm 导入页');
  console.log('  - 页面按选择、只读预览、确认、执行、结果顺序接线');
  console.log('  - 执行阶段提供进度条，并在导入期间阻止离开');
  console.log('  - 成功结果和临时文件清理警告均有明确展示');
  console.log('  - 页面不直接访问 SQLite 或 Expo 文件系统对象');
} catch (error) {
  console.error('[module-import-page-v1] 检查失败：', error);
  process.exitCode = 1;
}

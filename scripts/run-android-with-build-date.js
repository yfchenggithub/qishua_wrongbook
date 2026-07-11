const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve('.');
const appConstantsPath = path.join(repoRoot, 'src', 'constants', 'app.ts');

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatBuildDate(date) {
  return `${pad2(date.getFullYear() % 100)}.${pad2(date.getMonth() + 1)}.${pad2(date.getDate())}`;
}

function updateBuildDate(content, buildDate) {
  const buildDatePattern = /export const APP_BUILD_DATE = '[0-9]{2}\.[0-9]{2}\.[0-9]{2}';/;
  if (buildDatePattern.test(content)) {
    return content.replace(buildDatePattern, `export const APP_BUILD_DATE = '${buildDate}';`);
  }

  const legacyVersionPattern = /export const APP_VERSION = '[0-9]{2}\.[0-9]{2}\.[0-9]{2}';/;
  if (legacyVersionPattern.test(content)) {
    return content.replace(
      legacyVersionPattern,
      `export const APP_BUILD_DATE = '${buildDate}';\nexport const APP_VERSION = APP_BUILD_DATE;`,
    );
  }

  throw new Error('Cannot find APP_BUILD_DATE in src/constants/app.ts.');
}

function restoreOriginalFile(originalContent) {
  fs.writeFileSync(appConstantsPath, originalContent, 'utf8');
}

const originalContent = fs.readFileSync(appConstantsPath, 'utf8');
const buildDate = formatBuildDate(new Date());
const nextContent = updateBuildDate(originalContent, buildDate);
if (nextContent !== originalContent) {
  fs.writeFileSync(appConstantsPath, nextContent, 'utf8');
  console.log(`[build-date] Updated APP_BUILD_DATE to ${buildDate}.`);
} else {
  console.log(`[build-date] APP_BUILD_DATE already ${buildDate}.`);
}

const command = path.join(
  repoRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'expo.cmd' : 'expo',
);
const args = ['run:android'];
const child = spawn(command, args, {
  cwd: repoRoot,
  env: process.env,
  stdio: 'inherit',
});

child.on('error', (error) => {
  restoreOriginalFile(originalContent);
  console.error('[build-date] Android build failed to start. Build date restored.');
  console.error(error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (code === 0) {
    console.log(`[build-date] Android build succeeded. Build date kept as ${buildDate}.`);
    process.exit(0);
  }

  restoreOriginalFile(originalContent);
  if (signal) {
    console.error(`[build-date] Android build stopped by ${signal}. Build date restored.`);
    process.exit(1);
  }

  console.error(`[build-date] Android build failed with code ${code}. Build date restored.`);
  process.exit(code || 1);
});

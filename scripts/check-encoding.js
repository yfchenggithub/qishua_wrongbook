#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const STAGED_FLAG = '--staged';
const ALL_FLAG = '--all';
const STDIN_FLAG = '--stdin';

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.txt',
  '.yml',
  '.yaml',
  '.xml',
  '.html',
  '.css',
  '.scss',
  '.less',
  '.sql',
  '.sh',
  '.ps1',
  '.bat',
  '.cmd',
  '.gradle',
  '.java',
  '.kt',
  '.kts',
  '.c',
  '.cc',
  '.cpp',
  '.h',
  '.hpp',
  '.env',
]);

const TEXT_FILENAMES = new Set([
  'package.json',
  'tsconfig.json',
  '.gitignore',
  '.gitattributes',
  '.npmrc',
  '.editorconfig',
]);

const SKIP_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  '.expo',
  '.next',
  'dist',
  'build',
  'out',
  'coverage',
]);

const EXCLUDED_RELATIVE_FILES = new Set([
  'scripts/check-encoding.js',
]);

const MOJIBAKE_SNIPPETS = [
  '鍙栨秷',
  '璇诲彇',
  '鏃犳晥',
  '澶辫触',
  '鍥剧墖',
  '杩斿洖',
  '鍒锋柊',
  '瑁佸壀',
  '姝ｅ湪',
  '棰樼洰',
  '澶嶅仛',
  '鏉冮檺',
  '鐩告満',
  '鐩稿唽',
  '宸叉洿鏂',
  '娣诲姞',
  '鏇挎崲',
  '鍒犻櫎',
  '纭',
  '闅惧害',
  '杩愯鏃ュ織',
  '鈫?',
  '锟',
];

function normalizeSlash(filePath) {
  return filePath.replace(/\\/g, '/');
}

function isExcludedFile(filePath) {
  const maybeRelative = path.isAbsolute(filePath)
    ? path.relative(process.cwd(), filePath)
    : filePath;
  const normalized = normalizeSlash(maybeRelative).replace(/^\.\//, '').toLowerCase();
  return EXCLUDED_RELATIVE_FILES.has(normalized);
}

function shouldCheckTextFile(filePath) {
  if (isExcludedFile(filePath)) {
    return false;
  }
  const base = path.basename(filePath);
  if (TEXT_FILENAMES.has(base)) {
    return true;
  }
  return TEXT_EXTENSIONS.has(path.extname(base).toLowerCase());
}

function hasPrivateUseChars(text) {
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code >= 0xe000 && code <= 0xf8ff) {
      return true;
    }
  }
  return false;
}

function hasTooManyNullBytes(bytes) {
  if (bytes.length === 0) {
    return false;
  }
  let nullCount = 0;
  for (const b of bytes) {
    if (b === 0) {
      nullCount += 1;
    }
  }
  return nullCount / bytes.length > 0.1;
}

function collectFilesRecursively(rootDir) {
  const result = [];

  function walk(currentDir) {
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absPath = path.join(currentDir, entry.name);
      const relPath = normalizeSlash(path.relative(process.cwd(), absPath));
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) {
          continue;
        }
        walk(absPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (!shouldCheckTextFile(relPath)) {
        continue;
      }
      result.push(relPath);
    }
  }

  walk(rootDir);
  return result;
}

function getStagedFiles() {
  try {
    const output = execSync('git diff --cached --name-only --diff-filter=ACMR', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output
      .split(/\r?\n/g)
      .map((line) => normalizeSlash(line.trim()))
      .filter(Boolean)
      .filter((filePath) => shouldCheckTextFile(filePath));
  } catch {
    return [];
  }
}

function getGitOutput(command) {
  try {
    return execSync(command, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
}

function getChangedFiles() {
  const changedOutput = getGitOutput('git diff --name-only --diff-filter=ACMR');
  const untrackedOutput = getGitOutput('git ls-files --others --exclude-standard');
  const merged = `${changedOutput}\n${untrackedOutput}`;
  return merged
    .split(/\r?\n/g)
    .map((line) => normalizeSlash(line.trim()))
    .filter(Boolean)
    .filter((filePath) => shouldCheckTextFile(filePath));
}

function getDefaultFiles() {
  const roots = ['app', 'src'];
  const files = [];

  for (const root of roots) {
    const absRoot = path.resolve(process.cwd(), root);
    if (!fs.existsSync(absRoot)) {
      continue;
    }
    files.push(...collectFilesRecursively(absRoot));
  }

  for (const topFile of TEXT_FILENAMES) {
    if (topFile.includes('/')) {
      continue;
    }
    if (!fs.existsSync(path.resolve(process.cwd(), topFile))) {
      continue;
    }
    files.push(topFile);
  }

  return Array.from(new Set(files));
}

function decodeUtf8(bytes) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  return decoder.decode(bytes);
}

function checkFile(filePath) {
  const absPath = path.resolve(process.cwd(), filePath);
  const errors = [];

  if (!fs.existsSync(absPath)) {
    return errors;
  }

  let bytes;
  try {
    bytes = fs.readFileSync(absPath);
  } catch (error) {
    return [`读取文件失败: ${error instanceof Error ? error.message : String(error)}`];
  }

  if (hasTooManyNullBytes(bytes)) {
    errors.push('检测到过多空字节，文件可能是 UTF-16/二进制，不是 UTF-8 文本');
    return errors;
  }

  let text;
  try {
    text = decodeUtf8(bytes);
  } catch {
    errors.push('文件不是有效 UTF-8 编码');
    return errors;
  }

  if (text.includes('\uFFFD')) {
    errors.push('检测到替换字符 U+FFFD，可能已经发生编码损坏');
  }

  if (hasPrivateUseChars(text)) {
    errors.push('检测到私有区字符（PUA），常见于乱码污染');
  }

  for (const token of MOJIBAKE_SNIPPETS) {
    if (text.includes(token)) {
      errors.push(`检测到疑似乱码片段: ${token}`);
      break;
    }
  }

  return errors;
}

function parseCliFiles(rawArgs) {
  return rawArgs
    .filter((arg) => !arg.startsWith('-'))
    .map((p) => normalizeSlash(p))
    .filter((p) => shouldCheckTextFile(p));
}

function readStdinFiles() {
  try {
    const content = fs.readFileSync(0, 'utf8');
    return content
      .split(/\r?\n/g)
      .map((line) => normalizeSlash(line.trim()))
      .filter(Boolean)
      .filter((filePath) => shouldCheckTextFile(filePath));
  } catch {
    return [];
  }
}

function main() {
  const rawArgs = process.argv.slice(2);
  const useStaged = rawArgs.includes(STAGED_FLAG);
  const useAll = rawArgs.includes(ALL_FLAG);
  const useStdin = rawArgs.includes(STDIN_FLAG);
  const explicitFiles = parseCliFiles(rawArgs);

  let filesToCheck = [];
  if (explicitFiles.length > 0) {
    filesToCheck = explicitFiles;
  } else if (useStdin) {
    filesToCheck = readStdinFiles();
  } else if (useStaged) {
    filesToCheck = getStagedFiles();
  } else if (useAll) {
    filesToCheck = getDefaultFiles();
  } else {
    filesToCheck = getChangedFiles();
    if (filesToCheck.length === 0) {
      filesToCheck = getDefaultFiles();
    }
  }

  filesToCheck = Array.from(new Set(filesToCheck)).sort();

  if (filesToCheck.length === 0) {
    console.log('[encoding-guard] 没有可检查的文本文件。');
    process.exit(0);
  }

  let hasError = false;
  for (const filePath of filesToCheck) {
    const errors = checkFile(filePath);
    if (errors.length === 0) {
      continue;
    }

    hasError = true;
    console.error(`\n[encoding-guard] ${filePath}`);
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
  }

  if (hasError) {
    console.error('\n[encoding-guard] 检查失败：发现编码或乱码问题，已阻止继续。');
    process.exit(1);
  }

  console.log(`[encoding-guard] 检查通过，共扫描 ${filesToCheck.length} 个文件。`);
}

main();

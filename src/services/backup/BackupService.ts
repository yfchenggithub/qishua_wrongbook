import Constants from 'expo-constants';
import { Directory, File, Paths, type FileHandle } from 'expo-file-system';
import { strFromU8, Unzip, UnzipInflate } from 'fflate';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { withDatabaseTransaction } from '@/src/db';
import { DATABASE_VERSION } from '@/src/db/constants';
import {
  CUSTOM_MODULE_ID_START,
  CUSTOM_MODULE_MAX_NUMBER,
  SYSTEM_MODULE_DEFINITIONS,
  UNCLASSIFIED_MODULE_DISPLAY_CODE,
  UNCLASSIFIED_MODULE_ID,
  UNCLASSIFIED_MODULE_NAME,
  formatCustomModuleDisplayCode,
  resolveSystemModuleByLegacyIdOrName,
} from '@/src/constants/modules';
import type { Mistake } from '@/src/models/Mistake';
import type { MistakeImage } from '@/src/models/MistakeImage';
import type { MistakeTag } from '@/src/models/MistakeTag';
import type { ModuleRecord } from '@/src/models/Module';
import type { ReviewRecord, ReviewRecordVoiceNote } from '@/src/models/ReviewRecord';
import {
  CustomErrorReasonRepository,
  CustomModuleRepository,
  MistakeImageRepository,
  MistakeRelationRepository,
  MistakeRepository,
  MistakeTagRepository,
  ModuleRepository,
  ReviewRecordRepository,
} from '@/src/repositories';
import { ensureMistakeImageDir } from '@/src/services/ImageStorageService';
import { Logger } from '@/src/services/Logger';
import { BRAND_ACCENT } from '@/src/styles/tokens';
import {
  BACKUP_DATA_FILE_NAME,
  BACKUP_IMAGES_DIR_NAME,
  BACKUP_MANIFEST_FILE_NAME,
  BACKUP_VOICE_FILES_DIR_NAME,
  BACKUP_VOICE_NOTES_FILE_NAME,
  createBackupManifest,
  validateBackupManifest,
} from '@/src/services/backup/BackupManifest';
import {
  BackupRestoreError,
  type BackupRestoreErrorCode,
  createNotImplementedBackupError,
  getBackupErrorUserMessage,
  normalizeBackupError,
} from '@/src/services/backup/BackupRestoreError';
import {
  ensureBackupImageRelativePath,
  ensureBackupVoiceFileRelativePath,
  FflateBackupZipAdapter,
  type BackupZipAdapter,
} from '@/src/services/backup/BackupZipAdapter';
import {
  BACKUP_FILE_EXTENSION,
  BACKUP_FILE_NAME_PREFIX,
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  type BackupCounts,
  type BackupDataPayload,
  type BackupDevicePlatform,
  type BackupCustomErrorReasonRecord,
  type BackupCustomModuleRecord,
  type BackupImageArchiveFile,
  type BackupManifest,
  type BackupModuleQuestionCounterRecord,
  type BackupModuleRecord,
  type BackupMistakeImageRecord,
  type BackupMistakeRelationRecord,
  type BackupMistakeTagRecord,
  type BackupProgressEvent,
  type BackupProgressStage,
  type BackupVoiceNoteRecord,
  type CreateBackupOptions,
  type CreateBackupServiceResult,
  type InspectBackupResult,
  type RestoreProgressEvent,
  type RestoreProgressStage,
  type RestoreFromBackupOptions,
  type RestoreFromBackupResult,
} from '@/src/services/backup/BackupTypes';
import {
  appendError,
  appendWarning,
  buildRestoreError,
  createEmptyDurations,
  createRestoreSessionId,
  firstItems,
  getUriScheme,
  logRestoreEvent,
  nowMs,
  safeError,
  shortFileInfo,
  shortPath,
  type RestoreDurations,
  type RestoreErrorItem,
  type RestoreStage,
  type RestoreWarningItem,
} from '@/src/services/backup/restoreDiagnostics';

const SERVICE_SCOPE = 'BackupService';
const BACKUP_QUERY_PAGE_SIZE = 200;
const RESTORE_TEMP_DIR_NAME = 'qishua_wrongbook_restore_tmp';
const RESTORE_IMAGE_EXTENSION_FALLBACK = 'jpg';
const RESTORE_VOICE_EXTENSION_FALLBACK = 'm4a';
const VOICE_NOTES_DIR_NAME = 'voice-notes';
const SUPPORTED_SCHEMA_VERSIONS = [3, 4, 5, 6, 7, 8, 9, DATABASE_VERSION];
const DB_IMPORT_PROGRESS_INTERVAL = 50;
const IMAGE_RESTORE_PROGRESS_INTERVAL = 10;
const BACKUP_IMAGE_PROGRESS_INTERVAL = 10;
const BACKUP_PROGRESS_RENDER_DELAY_MS = 0;
const RESTORE_ARCHIVE_STREAM_CHUNK_BYTES = 512 * 1024;
const RESTORE_MANIFEST_MAX_BYTES = 1024 * 1024;

const INSERT_MISTAKE_SQL = `
INSERT INTO mistakes (
  id,
  subject,
  module,
  module_id,
  question_no,
  title,
  error_reason,
  error_reason_ids,
  difficulty,
  note,
  my_solution_text,
  answer_text,
  note_highlights,
  review_count,
  status,
  created_at,
  updated_at,
  next_review_at,
  last_review_at,
  last_review_result,
  is_pinned,
  last_viewed_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
`;

const INSERT_MODULE_SQL = `
INSERT INTO modules (
  id,
  type,
  name,
  display_code,
  custom_no,
  icon,
  color,
  sort_order,
  is_active,
  created_at,
  updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
`;

const INSERT_MODULE_QUESTION_COUNTER_SQL = `
INSERT INTO module_question_counters (
  module_id,
  last_question_no,
  updated_at
) VALUES (?, ?, ?);
`;

const INSERT_REVIEW_RECORD_SQL = `
INSERT INTO review_records (
  id,
  mistake_id,
  review_index,
  result,
  note,
  note_highlights,
  voice_note,
  created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
`;

const INSERT_MISTAKE_IMAGE_SQL = `
INSERT INTO mistake_images (
  id,
  mistake_id,
  review_record_id,
  type,
  uri,
  sort_order,
  created_at
) VALUES (?, ?, ?, ?, ?, ?, ?);
`;

const INSERT_MISTAKE_RELATION_SQL = `
INSERT INTO mistake_relations (
  id,
  source_mistake_id,
  target_mistake_id,
  source,
  created_at
) VALUES (?, ?, ?, ?, ?);
`;

const INSERT_MISTAKE_TAG_SQL = `
INSERT INTO mistake_tags (
  id,
  mistake_id,
  name,
  normalized_name,
  sort_order,
  created_at,
  updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?);
`;

const INSERT_CUSTOM_ERROR_REASON_SQL = `
INSERT INTO custom_error_reasons (
  id,
  name,
  icon,
  color,
  sort_order,
  created_at,
  updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?);
`;

type BackupCollectContext = {
  counts: BackupCounts;
  warningCount: number;
};

type RestoreFailureContext = {
  restoreSessionId: string;
  stage: RestoreStage;
  step: string;
  errorCode: BackupRestoreErrorCode;
  startedAt: number;
  fileShortInfo: string;
  countsParsed: BackupCounts;
  countsImported: BackupCounts;
  currentCounts: BackupCounts;
  warningCount: number;
  warnings: RestoreWarningItem[];
  errors: RestoreErrorItem[];
  hasBeforeRestoreBackup: boolean;
  rollbackAttempted: boolean;
  rollbackSuccess: boolean;
  durations: RestoreDurations;
  rootCause?: unknown;
};

type ExtractedBackupArchive = {
  tempArchiveFile: File;
  tempArchiveSizeBytes: number;
  tempDirectory: Directory;
  manifest: BackupManifest;
  manifestWarnings: string[];
  data: BackupDataPayload;
  voiceNotes: BackupVoiceNoteRecord[];
  voiceParseWarnings: string[];
  archiveFileMap: Map<string, File>;
  imageTotalBytes: number;
  countsFromManifest: BackupCounts;
  appVersionInBackup: string;
  createdAtInBackup: string;
};

type StreamExtractResult = {
  archiveFileMap: Map<string, File>;
  imageTotalBytes: number;
  entryCount: number;
  fileCount: number;
  directoryCount: number;
  bytesRead: number;
};

type StreamManifestReadResult = {
  manifestBytes: Uint8Array;
  bytesRead: number;
};

type RestoreImageMaterializedResult = {
  restoredImages: RestoredMistakeImageInsert[];
  missingRelativePaths: string[];
  restoredFileBytes: number;
  failedCount: number;
  skippedCount: number;
  errorCount: number;
};

type BackupProgressEmitter = (
  stage: BackupProgressStage,
  message: string,
  current?: number,
  total?: number,
) => void;

type RestoreVoiceMaterializedResult = {
  resolvedVoiceNotesByReviewRecordId: Map<string, ReviewRecordVoiceNote>;
  voiceNoteCount: number;
  restoredVoiceFileCount: number;
};

type RestoreVerifyResult = {
  expectedCounts: BackupCounts;
  actualCounts: BackupCounts;
  mismatch: Record<keyof BackupCounts, boolean>;
  missingImageSamples: string[];
  orphanImageSamples: string[];
  imageFilesExpected: number;
  imageFilesActual: number;
};

type RestoredMistakeImageInsert = Omit<BackupMistakeImageRecord, 'backupRelativePath' | 'sourceUri'> & {
  uri: string;
};

const EMPTY_COUNTS: BackupCounts = {
  mistakes: 0,
  mistakeImages: 0,
  reviewRecords: 0,
  imageFiles: 0,
};

let zipAdapter: BackupZipAdapter = new FflateBackupZipAdapter();

function buildSessionId(prefix: 'backup' | 'restore'): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)
    .toString()
    .padStart(5, '0')}`;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toBackupDevicePlatform(): BackupDevicePlatform {
  if (Platform.OS === 'android' || Platform.OS === 'ios' || Platform.OS === 'web') {
    return Platform.OS;
  }
  return 'unknown';
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

export function buildBackupFileName(date: Date = new Date()): string {
  const datePart = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
  const timePart = `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
  return `${BACKUP_FILE_NAME_PREFIX}-${datePart}-${timePart}${BACKUP_FILE_EXTENSION}`;
}

function inferImageExtension(uri: string | null): string {
  if (!uri) {
    return RESTORE_IMAGE_EXTENSION_FALLBACK;
  }
  const matched = uri.match(/\.([a-zA-Z0-9]{1,8})(?:$|[?#])/);
  if (!matched) {
    return RESTORE_IMAGE_EXTENSION_FALLBACK;
  }
  return matched[1].toLowerCase();
}

export function mapImageUriForBackup(imageId: string, sourceUri: string | null): string {
  const safeImageId = imageId.trim();
  const extension = inferImageExtension(sourceUri);
  return ensureBackupImageRelativePath(`${BACKUP_IMAGES_DIR_NAME}/${safeImageId}.${extension}`);
}

function inferArchiveExtension(path: string): string {
  const matched = path.match(/\.([a-zA-Z0-9]{1,8})$/);
  if (!matched) {
    return RESTORE_IMAGE_EXTENSION_FALLBACK;
  }
  return matched[1].toLowerCase();
}

function sanitizeFileNameSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function normalizeRequiredText(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function isValidIsoDateTime(value: string): boolean {
  if (!value.trim()) {
    return false;
  }
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

function inferVoiceExtension(uri: string | null, fileName: string | null): string {
  const fileNameNormalized = normalizeOptionalText(fileName);
  if (fileNameNormalized) {
    const matchedFromName = fileNameNormalized.match(/\.([a-zA-Z0-9]{1,8})$/);
    if (matchedFromName) {
      return matchedFromName[1].toLowerCase();
    }
  }

  if (!uri) {
    return RESTORE_VOICE_EXTENSION_FALLBACK;
  }
  const matchedFromUri = uri.match(/\.([a-zA-Z0-9]{1,8})(?:$|[?#])/);
  if (!matchedFromUri) {
    return RESTORE_VOICE_EXTENSION_FALLBACK;
  }
  return matchedFromUri[1].toLowerCase();
}

function buildBackupVoiceFileName(voiceNoteId: string, fileName: string | null, sourceUri: string | null): string {
  const safeVoiceId = sanitizeFileNameSegment(voiceNoteId.trim());
  const extension = inferVoiceExtension(sourceUri, fileName);
  return `voice_note_${safeVoiceId}.${extension}`;
}

function mapVoiceFilePathForBackup(fileName: string): string {
  return ensureBackupVoiceFileRelativePath(`${BACKUP_VOICE_FILES_DIR_NAME}/${fileName}`);
}

function normalizeBackupVoiceFileName(fileName: string | null | undefined): string | null {
  const normalized = normalizeRequiredText(fileName);
  if (!normalized) {
    return null;
  }
  if (normalized.includes('/') || normalized.includes('\\') || normalized.includes('..')) {
    return null;
  }
  return normalized;
}

function toIsoStringOrNull(timestampMs: number | null | undefined): string | null {
  if (typeof timestampMs !== 'number' || !Number.isFinite(timestampMs) || timestampMs <= 0) {
    return null;
  }
  return new Date(timestampMs).toISOString();
}

function normalizeReviewRecordVoiceNoteForBackup(
  value: ReviewRecord['voice_note'],
): ReviewRecordVoiceNote | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const id = normalizeRequiredText(value.id);
  const fileUri = normalizeRequiredText(value.fileUri);
  const fileName = normalizeRequiredText(value.fileName);
  const createdAt = normalizeRequiredText(value.createdAt);
  const durationMs = ensureNonNegativeNumber(value.durationMs) ? Math.floor(value.durationMs) : NaN;
  const sizeBytes = ensureNonNegativeNumber(value.sizeBytes) ? Math.floor(value.sizeBytes) : NaN;

  if (!id || !fileUri || !fileName || !createdAt) {
    return null;
  }
  if (!Number.isFinite(durationMs) || !Number.isFinite(sizeBytes)) {
    return null;
  }
  if (!isValidIsoDateTime(createdAt)) {
    return null;
  }

  return {
    id,
    fileUri,
    fileName,
    durationMs,
    sizeBytes,
    createdAt,
  };
}

function getVoiceNotesDirectory(): Directory {
  return new Directory(Paths.document, VOICE_NOTES_DIR_NAME);
}

function resolveVoiceSourceFileForBackup(voiceNote: ReviewRecordVoiceNote): File | null {
  const normalizedFileName = normalizeBackupVoiceFileName(voiceNote.fileName);
  if (normalizedFileName) {
    const fileInVoiceNotesDirectory = new File(getVoiceNotesDirectory(), normalizedFileName);
    if (fileInVoiceNotesDirectory.exists) {
      return fileInVoiceNotesDirectory;
    }
  }

  const fileFromUri = new File(voiceNote.fileUri);
  if (fileFromUri.exists) {
    return fileFromUri;
  }

  return null;
}

async function yieldToBackupProgressFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, BACKUP_PROGRESS_RENDER_DELAY_MS);
  });
}

export function mapImageUriForRestore(image: BackupMistakeImageRecord): string {
  const safeType = sanitizeFileNameSegment(image.type);
  const safeId = sanitizeFileNameSegment(image.id);
  const safeOrder = Number.isFinite(image.sort_order)
    ? Math.max(0, Math.floor(image.sort_order)).toString().padStart(3, '0')
    : '000';
  const extension = inferArchiveExtension(image.backupRelativePath);
  return `${safeType}_${safeOrder}_${safeId}.${extension}`;
}

function isUserCancelledShare(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  const name = error.name.toLowerCase();
  return (
    message.includes('cancel') ||
    message.includes('canceled') ||
    message.includes('cancelled') ||
    message.includes('dismiss') ||
    message.includes('did not share') ||
    name.includes('abort')
  );
}

function resolveAppMeta(): { appName: string; appVersion: string } {
  const appName = normalizeOptionalText(Constants.expoConfig?.name) ?? 'Qishua Wrongbook';
  const appVersion = normalizeOptionalText(Constants.expoConfig?.version) ?? 'unknown';
  return {
    appName,
    appVersion,
  };
}

function ensureNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function ensureManifestRequiredFields(manifest: BackupManifest): BackupManifest {
  if (!manifest.appName || !manifest.appVersion || !manifest.createdAt) {
    throw new BackupRestoreError(
      'CORRUPTED_BACKUP_FILE',
      getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
    );
  }

  const counts = manifest.counts;
  if (
    !counts ||
    !ensureNonNegativeNumber(counts.mistakes) ||
    !ensureNonNegativeNumber(counts.mistakeImages) ||
    !ensureNonNegativeNumber(counts.reviewRecords) ||
    !ensureNonNegativeNumber(counts.imageFiles)
  ) {
    throw new BackupRestoreError(
      'CORRUPTED_BACKUP_FILE',
      getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
    );
  }

  return manifest;
}

export function validateBackupDataPayload(raw: unknown): BackupDataPayload {
  if (!raw || typeof raw !== 'object') {
    throw new BackupRestoreError(
      'CORRUPTED_BACKUP_FILE',
      getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
    );
  }

  const input = raw as Partial<BackupDataPayload>;
  if (!Array.isArray(input.mistakes) || !Array.isArray(input.mistakeImages) || !Array.isArray(input.reviewRecords)) {
    throw new BackupRestoreError(
      'CORRUPTED_BACKUP_FILE',
      getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
    );
  }

  return {
    mistakes: input.mistakes as BackupDataPayload['mistakes'],
    mistakeImages: input.mistakeImages as BackupDataPayload['mistakeImages'],
    reviewRecords: input.reviewRecords as BackupDataPayload['reviewRecords'],
    mistakeRelations: Array.isArray(input.mistakeRelations)
      ? input.mistakeRelations as BackupDataPayload['mistakeRelations']
      : [],
    mistakeTags: Array.isArray(input.mistakeTags)
      ? input.mistakeTags as BackupDataPayload['mistakeTags']
      : [],
    modules: Array.isArray(input.modules)
      ? input.modules as BackupDataPayload['modules']
      : [],
    moduleQuestionCounters: Array.isArray(input.moduleQuestionCounters)
      ? input.moduleQuestionCounters as BackupDataPayload['moduleQuestionCounters']
      : [],
    customModules: Array.isArray(input.customModules)
      ? input.customModules as BackupDataPayload['customModules']
      : [],
    customErrorReasons: Array.isArray(input.customErrorReasons)
      ? input.customErrorReasons as BackupDataPayload['customErrorReasons']
      : [],
    extra: input.extra && typeof input.extra === 'object' ? input.extra : {},
  };
}

function ensureRecordId(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length <= 0) {
    throw new BackupRestoreError(
      'CORRUPTED_BACKUP_FILE',
      getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
    );
  }
  return value.trim();
}

function ensureOptionalRecordId(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new BackupRestoreError(
      'CORRUPTED_BACKUP_FILE',
      getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
    );
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

type LegacyBackupCustomModuleShape = {
  id?: unknown;
  name?: unknown;
  icon?: unknown;
  color?: unknown;
  sort_order?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
};

function toLegacyText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildBackupSystemModules(timestamp: string): ModuleRecord[] {
  const systemModules: ModuleRecord[] = SYSTEM_MODULE_DEFINITIONS.map((item) => ({
    id: item.id,
    type: 'system',
    name: item.name,
    display_code: item.displayCode,
    custom_no: null,
    icon: 'label',
    color: BRAND_ACCENT,
    sort_order: item.sortOrder,
    is_active: true,
    created_at: timestamp,
    updated_at: timestamp,
  }));
  systemModules.push({
    id: UNCLASSIFIED_MODULE_ID,
    type: 'unclassified',
    name: UNCLASSIFIED_MODULE_NAME,
    display_code: UNCLASSIFIED_MODULE_DISPLAY_CODE,
    custom_no: null,
    icon: 'label',
    color: BRAND_ACCENT,
    sort_order: SYSTEM_MODULE_DEFINITIONS.length,
    is_active: true,
    created_at: timestamp,
    updated_at: timestamp,
  });
  return systemModules;
}

function parseBackupLegacyQuestionNo(title: unknown): number | null {
  const matched = toLegacyText(title).match(/第\s*(\d+)\s*题\s*$/u);
  if (!matched) {
    return null;
  }
  const parsed = Number.parseInt(matched[1], 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 999 ? parsed : null;
}

function normalizeBackupModulesForCurrentSchema(
  data: BackupDataPayload,
  schemaVersion: number,
  timestamp: string,
): BackupDataPayload {
  if (schemaVersion >= 10 && data.modules.length > 0) {
    if (data.moduleQuestionCounters.length === 0) {
      const maxByModule = new Map<number, number>();
      data.mistakes.forEach((mistake) => {
        maxByModule.set(
          Number(mistake.module_id),
          Math.max(maxByModule.get(Number(mistake.module_id)) ?? 0, Number(mistake.question_no)),
        );
      });
      data.moduleQuestionCounters = Array.from(maxByModule, ([module_id, last_question_no]) => ({
        module_id,
        last_question_no,
        updated_at: timestamp,
      }));
    }
    return data;
  }

  const modules = buildBackupSystemModules(timestamp);
  const legacyIdToPermanentId = new Map<string, number>();
  const moduleNameToPermanentId = new Map<string, number>(
    modules.map((item) => [item.name, item.id]),
  );
  const legacyCustomRows = (data.customModules as unknown as LegacyBackupCustomModuleShape[])
    .slice()
    .sort((left, right) => (
      Number(left.sort_order ?? 0) - Number(right.sort_order ?? 0)
      || toLegacyText(left.created_at).localeCompare(toLegacyText(right.created_at))
      || toLegacyText(left.id).localeCompare(toLegacyText(right.id))
    ));

  legacyCustomRows.forEach((legacyRow) => {
    const name = toLegacyText(legacyRow.name);
    if (!name || moduleNameToPermanentId.has(name)) {
      return;
    }
    const customNo = modules.filter((item) => item.type === 'custom').length + 1;
    if (customNo > CUSTOM_MODULE_MAX_NUMBER) {
      throw new BackupRestoreError(
        'CORRUPTED_BACKUP_FILE',
        `备份中的自定义模块超过 ${CUSTOM_MODULE_MAX_NUMBER} 个。`,
      );
    }
    const id = CUSTOM_MODULE_ID_START + customNo - 1;
    const legacyId = toLegacyText(legacyRow.id);
    modules.push({
      id,
      type: 'custom',
      name,
      display_code: formatCustomModuleDisplayCode(customNo),
      custom_no: customNo,
      icon: toLegacyText(legacyRow.icon) || 'label',
      color: toLegacyText(legacyRow.color) || BRAND_ACCENT,
      sort_order: Number(legacyRow.sort_order ?? customNo - 1),
      is_active: true,
      created_at: toLegacyText(legacyRow.created_at) || timestamp,
      updated_at: toLegacyText(legacyRow.updated_at) || timestamp,
    });
    moduleNameToPermanentId.set(name, id);
    if (legacyId) {
      legacyIdToPermanentId.set(legacyId, id);
      legacyIdToPermanentId.set(`custom:${legacyId}`, id);
    }
  });

  const legacyMistakes = data.mistakes as unknown as (Omit<Mistake, 'module_id' | 'question_no'> & {
    module_id?: string | number | null;
    question_no?: number;
  })[];
  legacyMistakes.forEach((mistake) => {
    const moduleName = toLegacyText(mistake.module) || UNCLASSIFIED_MODULE_NAME;
    const legacyModuleId = typeof mistake.module_id === 'string' ? mistake.module_id.trim() : '';
    const system = resolveSystemModuleByLegacyIdOrName(legacyModuleId, moduleName);
    if (
      system
      || moduleName === UNCLASSIFIED_MODULE_NAME
      || moduleNameToPermanentId.has(moduleName)
      || (legacyModuleId && legacyIdToPermanentId.has(legacyModuleId))
    ) {
      return;
    }
    const customNo = modules.filter((item) => item.type === 'custom').length + 1;
    if (customNo > CUSTOM_MODULE_MAX_NUMBER) {
      throw new BackupRestoreError(
        'CORRUPTED_BACKUP_FILE',
        `备份中的自定义模块超过 ${CUSTOM_MODULE_MAX_NUMBER} 个。`,
      );
    }
    const id = CUSTOM_MODULE_ID_START + customNo - 1;
    modules.push({
      id,
      type: 'custom',
      name: moduleName,
      display_code: formatCustomModuleDisplayCode(customNo),
      custom_no: customNo,
      icon: 'label',
      color: BRAND_ACCENT,
      sort_order: customNo - 1,
      is_active: false,
      created_at: mistake.created_at || timestamp,
      updated_at: mistake.updated_at || timestamp,
    });
    moduleNameToPermanentId.set(moduleName, id);
    if (legacyModuleId) {
      legacyIdToPermanentId.set(legacyModuleId, id);
    }
  });

  const normalizedMistakes = legacyMistakes.map((mistake) => {
    const moduleName = toLegacyText(mistake.module) || UNCLASSIFIED_MODULE_NAME;
    const rawModuleId = mistake.module_id;
    const numericModuleId = typeof rawModuleId === 'number' && modules.some((item) => item.id === rawModuleId)
      ? rawModuleId
      : null;
    const legacyModuleId = typeof rawModuleId === 'string' ? rawModuleId.trim() : '';
    const system = resolveSystemModuleByLegacyIdOrName(legacyModuleId, moduleName);
    const moduleId = numericModuleId
      ?? system?.id
      ?? legacyIdToPermanentId.get(legacyModuleId)
      ?? moduleNameToPermanentId.get(moduleName)
      ?? UNCLASSIFIED_MODULE_ID;
    return {
      ...mistake,
      module_id: moduleId,
      question_no: 0,
    } as Mistake;
  });

  const grouped = new Map<number, Mistake[]>();
  normalizedMistakes.forEach((mistake) => {
    const list = grouped.get(mistake.module_id) ?? [];
    list.push(mistake);
    grouped.set(mistake.module_id, list);
  });
  const moduleQuestionCounters: BackupModuleQuestionCounterRecord[] = [];
  grouped.forEach((mistakes, moduleId) => {
    mistakes.sort((left, right) => (
      left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id)
    ));
    const used = new Set<number>();
    mistakes.forEach((mistake) => {
      const parsed = parseBackupLegacyQuestionNo(mistake.title);
      if (parsed && !used.has(parsed)) {
        mistake.question_no = parsed;
        used.add(parsed);
      }
    });
    let lastQuestionNo = Math.max(0, ...used);
    mistakes.forEach((mistake) => {
      if (mistake.question_no > 0) {
        return;
      }
      do {
        lastQuestionNo += 1;
      } while (used.has(lastQuestionNo));
      if (lastQuestionNo > 999) {
        throw new BackupRestoreError('CORRUPTED_BACKUP_FILE', '备份中的模块题号超过 999。');
      }
      mistake.question_no = lastQuestionNo;
      used.add(lastQuestionNo);
    });
    moduleQuestionCounters.push({
      module_id: moduleId,
      last_question_no: Math.max(lastQuestionNo, ...used),
      updated_at: timestamp,
    });
  });

  return {
    ...data,
    mistakes: normalizedMistakes,
    modules,
    moduleQuestionCounters,
    customModules: modules
      .filter((item): item is ModuleRecord & { type: 'custom'; custom_no: number } => (
        item.type === 'custom' && item.custom_no !== null && item.is_active
      ))
      .map((item) => ({
        id: item.id,
        name: item.name,
        display_code: item.display_code,
        custom_no: item.custom_no,
        icon: item.icon,
        color: item.color,
        sort_order: item.sort_order,
        is_active: item.is_active,
        created_at: item.created_at,
        updated_at: item.updated_at,
      })),
  };
}

function ensureBackupPayloadRelations(data: BackupDataPayload): void {
  const moduleIds = new Set<number>();
  const moduleDisplayCodes = new Set<string>();
  for (const moduleItem of data.modules) {
    const moduleId = Number(moduleItem.id);
    const displayCode = normalizeRequiredText(moduleItem.display_code);
    if (
      !Number.isInteger(moduleId)
      || moduleId <= 0
      || moduleIds.has(moduleId)
      || moduleDisplayCodes.has(displayCode)
    ) {
      throw new BackupRestoreError(
        'CORRUPTED_BACKUP_FILE',
        getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
      );
    }
    moduleIds.add(moduleId);
    moduleDisplayCodes.add(displayCode);
  }

  const mistakeIds = new Set<string>();
  const questionKeys = new Set<string>();
  for (const mistake of data.mistakes) {
    mistakeIds.add(ensureRecordId((mistake as Partial<Mistake>).id));
    const moduleId = Number((mistake as Partial<Mistake>).module_id);
    const questionNo = Number((mistake as Partial<Mistake>).question_no);
    const questionKey = `${moduleId}:${questionNo}`;
    if (
      !moduleIds.has(moduleId)
      || !Number.isInteger(questionNo)
      || questionNo < 1
      || questionNo > 999
      || questionKeys.has(questionKey)
    ) {
      throw new BackupRestoreError(
        'CORRUPTED_BACKUP_FILE',
        getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
      );
    }
    questionKeys.add(questionKey);
  }

  for (const counter of data.moduleQuestionCounters) {
    const moduleId = Number(counter.module_id);
    const lastQuestionNo = Number(counter.last_question_no);
    if (
      !moduleIds.has(moduleId)
      || !Number.isInteger(lastQuestionNo)
      || lastQuestionNo < 0
      || lastQuestionNo > 999
    ) {
      throw new BackupRestoreError(
        'CORRUPTED_BACKUP_FILE',
        getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
      );
    }
  }

  const reviewIds = new Set<string>();
  for (const reviewRecord of data.reviewRecords) {
    const reviewId = ensureRecordId((reviewRecord as Partial<ReviewRecord>).id);
    const mistakeId = ensureRecordId((reviewRecord as Partial<ReviewRecord>).mistake_id);
    if (!mistakeIds.has(mistakeId)) {
      throw new BackupRestoreError(
        'CORRUPTED_BACKUP_FILE',
        getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
      );
    }
    reviewIds.add(reviewId);
  }

  for (const image of data.mistakeImages) {
    const mistakeId = ensureRecordId((image as Partial<BackupMistakeImageRecord>).mistake_id);
    if (!mistakeIds.has(mistakeId)) {
      throw new BackupRestoreError(
        'CORRUPTED_BACKUP_FILE',
        getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
      );
    }

    const reviewRecordId = ensureOptionalRecordId(
      (image as Partial<BackupMistakeImageRecord>).review_record_id,
    );
    if (reviewRecordId && !reviewIds.has(reviewRecordId)) {
      throw new BackupRestoreError(
        'CORRUPTED_BACKUP_FILE',
        getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
      );
    }
  }

  for (const relation of data.mistakeRelations) {
    const sourceMistakeId = ensureRecordId(
      (relation as Partial<BackupMistakeRelationRecord>).source_mistake_id,
    );
    const targetMistakeId = ensureRecordId(
      (relation as Partial<BackupMistakeRelationRecord>).target_mistake_id,
    );
    const relationSource = normalizeRequiredText(
      (relation as Partial<BackupMistakeRelationRecord>).source,
    );
    if (
      sourceMistakeId === targetMistakeId
      || !mistakeIds.has(sourceMistakeId)
      || !mistakeIds.has(targetMistakeId)
      || (relationSource !== 'system' && relationSource !== 'manual')
    ) {
      throw new BackupRestoreError(
        'CORRUPTED_BACKUP_FILE',
        getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
      );
    }
  }

  for (const tag of data.mistakeTags) {
    const tagId = ensureRecordId((tag as Partial<BackupMistakeTagRecord>).id);
    const mistakeId = ensureRecordId((tag as Partial<BackupMistakeTagRecord>).mistake_id);
    const tagName = normalizeRequiredText((tag as Partial<BackupMistakeTagRecord>).name);
    const normalizedTagName = normalizeRequiredText(
      (tag as Partial<BackupMistakeTagRecord>).normalized_name,
    );
    if (!tagId || !mistakeIds.has(mistakeId) || !tagName || !normalizedTagName) {
      throw new BackupRestoreError(
        'CORRUPTED_BACKUP_FILE',
        getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
      );
    }
  }

  for (const customModule of data.customModules) {
    const customModuleId = ensureRecordId((customModule as Partial<BackupCustomModuleRecord>).id);
    const customModuleName = normalizeRequiredText((customModule as Partial<BackupCustomModuleRecord>).name);
    if (!customModuleId || !customModuleName) {
      throw new BackupRestoreError(
        'CORRUPTED_BACKUP_FILE',
        getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
      );
    }
  }

  for (const customErrorReason of data.customErrorReasons) {
    const customErrorReasonId = ensureRecordId(
      (customErrorReason as Partial<BackupCustomErrorReasonRecord>).id,
    );
    const customErrorReasonName = normalizeRequiredText(
      (customErrorReason as Partial<BackupCustomErrorReasonRecord>).name,
    );
    if (!customErrorReasonId || !customErrorReasonName) {
      throw new BackupRestoreError(
        'CORRUPTED_BACKUP_FILE',
        getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
      );
    }
  }
}

function normalizeArchiveEntryPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '').trim();
  const isDirectoryPath = normalized.endsWith('/');
  const normalizedWithoutTrailingSlash = isDirectoryPath ? normalized.slice(0, -1) : normalized;

  if (!normalizedWithoutTrailingSlash) {
    throw new BackupRestoreError(
      'CORRUPTED_BACKUP_FILE',
      getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
    );
  }

  const segments = normalizedWithoutTrailingSlash.split('/');
  if (segments.some((segment) => segment.length <= 0 || segment === '..')) {
    throw new BackupRestoreError(
      'CORRUPTED_BACKUP_FILE',
      getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
    );
  }
  return isDirectoryPath ? `${normalizedWithoutTrailingSlash}/` : normalizedWithoutTrailingSlash;
}

function isArchiveDirectoryEntry(path: string): boolean {
  return normalizeArchiveEntryPath(path).endsWith('/');
}

function concatUint8Chunks(chunks: Uint8Array[], totalLength: number): Uint8Array {
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function closeFileHandleBestEffort(handle: FileHandle | null): void {
  if (!handle) {
    return;
  }
  try {
    handle.close();
  } catch {
    // Best-effort cleanup only.
  }
}

function resolveReadableFileSize(file: File, fallbackSizeBytes?: number | null): number {
  if (ensureNonNegativeNumber(fallbackSizeBytes)) {
    return Math.floor(fallbackSizeBytes);
  }

  const info = file.info();
  if (ensureNonNegativeNumber(info.size)) {
    return Math.floor(info.size);
  }

  if (ensureNonNegativeNumber(file.size)) {
    return Math.floor(file.size);
  }

  return 0;
}

function ensureExtractParentDirectory(extractDirectory: Directory, normalizedPath: string): void {
  const slashIndex = normalizedPath.lastIndexOf('/');
  if (slashIndex < 0) {
    return;
  }

  const parentPath = normalizedPath.slice(0, slashIndex);
  if (parentPath.trim().length <= 0) {
    return;
  }

  const parentDir = new Directory(extractDirectory, parentPath);
  parentDir.create({ intermediates: true, idempotent: true });
}

function streamFileIntoUnzip(options: {
  archiveFile: File;
  archiveSizeBytes?: number | null;
  unzipper: Unzip;
  getStreamError?: () => unknown | null;
  shouldStop?: () => boolean;
  allowPartialRead?: boolean;
}): number {
  const {
    archiveFile,
    archiveSizeBytes,
    unzipper,
    getStreamError,
    shouldStop,
    allowPartialRead = false,
  } = options;
  const totalSizeBytes = resolveReadableFileSize(archiveFile, archiveSizeBytes);
  if (totalSizeBytes <= 0) {
    throw new Error('Backup archive is empty or unreadable.');
  }

  let handle: FileHandle | null = null;
  let bytesRead = 0;
  try {
    handle = archiveFile.open();

    while (bytesRead < totalSizeBytes) {
      const remainingBytes = totalSizeBytes - bytesRead;
      const readLength = Math.min(RESTORE_ARCHIVE_STREAM_CHUNK_BYTES, remainingBytes);
      const chunk = handle.readBytes(readLength);
      if (chunk.byteLength <= 0) {
        break;
      }

      bytesRead += chunk.byteLength;
      unzipper.push(chunk, bytesRead >= totalSizeBytes);

      const streamError = getStreamError?.();
      if (streamError) {
        throw streamError;
      }

      if (shouldStop?.()) {
        return bytesRead;
      }
    }
  } finally {
    closeFileHandleBestEffort(handle);
  }

  if (!allowPartialRead && bytesRead < totalSizeBytes) {
    throw new Error('Backup archive ended before all bytes were read.');
  }

  return bytesRead;
}

function copyFileInChunks(sourceFile: File, targetFile: File, sourceSizeBytes?: number | null): number {
  const totalSizeBytes = resolveReadableFileSize(sourceFile, sourceSizeBytes);
  if (totalSizeBytes <= 0) {
    throw new Error('Source backup file is empty or unreadable.');
  }

  if (targetFile.exists) {
    targetFile.delete();
  }
  targetFile.create({ intermediates: true, overwrite: true });

  let sourceHandle: FileHandle | null = null;
  let targetHandle: FileHandle | null = null;
  let copiedBytes = 0;
  try {
    sourceHandle = sourceFile.open();
    targetHandle = targetFile.open();

    while (copiedBytes < totalSizeBytes) {
      const remainingBytes = totalSizeBytes - copiedBytes;
      const readLength = Math.min(RESTORE_ARCHIVE_STREAM_CHUNK_BYTES, remainingBytes);
      const chunk = sourceHandle.readBytes(readLength);
      if (chunk.byteLength <= 0) {
        break;
      }
      targetHandle.writeBytes(chunk);
      copiedBytes += chunk.byteLength;
    }
  } finally {
    closeFileHandleBestEffort(sourceHandle);
    closeFileHandleBestEffort(targetHandle);
  }

  if (copiedBytes < totalSizeBytes) {
    throw new Error('Source backup file ended before copy completed.');
  }

  return copiedBytes;
}

function readManifestBytesFromArchiveStream(
  archiveFile: File,
  archiveSizeBytes?: number | null,
): StreamManifestReadResult {
  let manifestBytes: Uint8Array | null = null;
  let streamError: unknown | null = null;

  const unzipper = new Unzip((entry) => {
    let normalizedPath = '';
    try {
      normalizedPath = normalizeArchiveEntryPath(entry.name);
    } catch (error) {
      streamError = error;
      return;
    }

    if (isArchiveDirectoryEntry(entry.name)) {
      return;
    }

    if (normalizedPath !== BACKUP_MANIFEST_FILE_NAME) {
      entry.ondata = (error) => {
        if (error) {
          streamError = error;
        }
      };
      try {
        entry.start();
      } catch (error) {
        streamError = error;
      }
      return;
    }

    const chunks: Uint8Array[] = [];
    let totalLength = 0;
    entry.ondata = (error, chunk, final) => {
      if (error) {
        streamError = error;
        return;
      }
      if (chunk.byteLength > 0) {
        totalLength += chunk.byteLength;
        if (totalLength > RESTORE_MANIFEST_MAX_BYTES) {
          streamError = new Error('Backup manifest is too large.');
          return;
        }
        chunks.push(new Uint8Array(chunk));
      }
      if (final) {
        manifestBytes = concatUint8Chunks(chunks, totalLength);
      }
    };

    try {
      entry.start();
    } catch (error) {
      streamError = error;
    }
  });
  unzipper.register(UnzipInflate);

  const bytesRead = streamFileIntoUnzip({
    archiveFile,
    archiveSizeBytes,
    unzipper,
    getStreamError: () => streamError,
    shouldStop: () => manifestBytes !== null,
    allowPartialRead: true,
  });

  if (streamError) {
    throw streamError;
  }
  if (!manifestBytes) {
    throw new BackupRestoreError(
      'RESTORE_MANIFEST_MISSING',
      getBackupErrorUserMessage('RESTORE_MANIFEST_MISSING'),
      {
        stage: 'package_read',
        step: 'ensure_manifest_exists',
      },
    );
  }

  return {
    manifestBytes,
    bytesRead,
  };
}

function extractArchiveToDirectoryStream(options: {
  archiveFile: File;
  archiveSizeBytes?: number | null;
  extractDirectory: Directory;
}): StreamExtractResult {
  const { archiveFile, archiveSizeBytes, extractDirectory } = options;
  const archiveFileMap = new Map<string, File>();
  const openHandles = new Set<FileHandle>();
  let streamError: unknown | null = null;
  let imageTotalBytes = 0;
  let entryCount = 0;
  let fileCount = 0;
  let directoryCount = 0;

  const unzipper = new Unzip((entry) => {
    try {
      const normalizedPath = normalizeArchiveEntryPath(entry.name);
      entryCount += 1;

      if (normalizedPath.endsWith('/')) {
        const directory = new Directory(extractDirectory, normalizedPath);
        directory.create({ intermediates: true, idempotent: true });
        directoryCount += 1;
        return;
      }

      ensureExtractParentDirectory(extractDirectory, normalizedPath);
      const extractedFile = new File(extractDirectory, normalizedPath);
      if (extractedFile.exists) {
        extractedFile.delete();
      }
      extractedFile.create({ intermediates: true, overwrite: true });

      let targetHandle: FileHandle | null = extractedFile.open();
      openHandles.add(targetHandle);
      let bytesWritten = 0;
      entry.ondata = (error, chunk, final) => {
        if (error) {
          streamError = error;
          if (targetHandle) {
            openHandles.delete(targetHandle);
            closeFileHandleBestEffort(targetHandle);
            targetHandle = null;
          }
          return;
        }

        try {
          if (chunk.byteLength > 0 && targetHandle) {
            targetHandle.writeBytes(chunk);
            bytesWritten += chunk.byteLength;
          }

          if (final && targetHandle) {
            openHandles.delete(targetHandle);
            closeFileHandleBestEffort(targetHandle);
            targetHandle = null;
            archiveFileMap.set(normalizedPath, extractedFile);
            fileCount += 1;
            if (normalizedPath.startsWith(`${BACKUP_IMAGES_DIR_NAME}/`)) {
              imageTotalBytes += bytesWritten;
            }
          }
        } catch (errorInHandler) {
          streamError = errorInHandler;
          if (targetHandle) {
            openHandles.delete(targetHandle);
            closeFileHandleBestEffort(targetHandle);
            targetHandle = null;
          }
        }
      };

      entry.start();
    } catch (error) {
      streamError = error;
    }
  });
  unzipper.register(UnzipInflate);

  try {
    const bytesRead = streamFileIntoUnzip({
      archiveFile,
      archiveSizeBytes,
      unzipper,
      getStreamError: () => streamError,
    });

    if (streamError) {
      throw streamError;
    }
    if (openHandles.size > 0) {
      throw new Error('Backup archive ended before all entries were extracted.');
    }

    return {
      archiveFileMap,
      imageTotalBytes,
      entryCount,
      fileCount,
      directoryCount,
      bytesRead,
    };
  } finally {
    for (const handle of openHandles) {
      closeFileHandleBestEffort(handle);
    }
    openHandles.clear();
  }
}

function getFileShortInfo(fileUri: string): string {
  try {
    return shortFileInfo({
      uri: fileUri,
      name: normalizeOptionalText(new File(fileUri).name),
    });
  } catch {
    return shortFileInfo({ uri: fileUri });
  }
}

function cloneCounts(counts: BackupCounts): BackupCounts {
  return {
    mistakes: counts.mistakes,
    mistakeImages: counts.mistakeImages,
    reviewRecords: counts.reviewRecords,
    imageFiles: counts.imageFiles,
  };
}

async function readCurrentDatabaseCounts(): Promise<BackupCounts> {
  const [mistakes, mistakeImages, reviewRecords] = await Promise.all([
    MistakeRepository.countMistakes(),
    MistakeImageRepository.countMistakeImages(),
    ReviewRecordRepository.countReviewRecords(),
  ]);
  return {
    mistakes,
    mistakeImages,
    reviewRecords,
    imageFiles: mistakeImages,
  };
}

function logBackupEvent(
  message: string,
  sessionId: string,
  durationMs: number,
  context?: Partial<BackupCollectContext> & {
    errorName?: string | null;
    errorMessage?: string | null;
    reason?: string | null;
  },
): void {
  Logger.info(SERVICE_SCOPE, message, {
    sessionId,
    counts: context?.counts ?? EMPTY_COUNTS,
    durationMs,
    warningCount: context?.warningCount ?? 0,
    errorName: context?.errorName ?? null,
    errorMessage: context?.errorMessage ?? null,
    reason: context?.reason ?? null,
  });
}

async function listAllMistakes(): Promise<Mistake[]> {
  const collected: Mistake[] = [];
  let offset = 0;

  while (true) {
    const page = await MistakeRepository.listMistakes({
      status: 'all',
      sortBy: 'created_at',
      sortOrder: 'asc',
      limit: BACKUP_QUERY_PAGE_SIZE,
      offset,
    });

    collected.push(...page);
    if (page.length < BACKUP_QUERY_PAGE_SIZE) {
      break;
    }
    offset += page.length;
  }

  return collected;
}

async function listAllMistakeImages(): Promise<MistakeImage[]> {
  const collected: MistakeImage[] = [];
  let offset = 0;

  while (true) {
    const page = await MistakeImageRepository.listAllMistakeImages({
      limit: BACKUP_QUERY_PAGE_SIZE,
      offset,
    });

    collected.push(...page);
    if (page.length < BACKUP_QUERY_PAGE_SIZE) {
      break;
    }
    offset += page.length;
  }

  return collected;
}

async function listAllReviewRecords(): Promise<ReviewRecord[]> {
  const collected: ReviewRecord[] = [];
  let offset = 0;

  while (true) {
    const page = await ReviewRecordRepository.listAllReviewRecords({
      limit: BACKUP_QUERY_PAGE_SIZE,
      offset,
    });

    collected.push(...page);
    if (page.length < BACKUP_QUERY_PAGE_SIZE) {
      break;
    }
    offset += page.length;
  }

  return collected;
}

async function listAllMistakeRelations(): Promise<BackupMistakeRelationRecord[]> {
  const collected: BackupMistakeRelationRecord[] = [];
  let offset = 0;

  while (true) {
    const page = await MistakeRelationRepository.listAllRelations({
      limit: BACKUP_QUERY_PAGE_SIZE,
      offset,
    });

    collected.push(...page);
    if (page.length < BACKUP_QUERY_PAGE_SIZE) {
      break;
    }
    offset += page.length;
  }

  return collected;
}

async function listAllMistakeTags(): Promise<MistakeTag[]> {
  const collected: MistakeTag[] = [];
  let offset = 0;

  while (true) {
    const page = await MistakeTagRepository.listAllTags({
      limit: BACKUP_QUERY_PAGE_SIZE,
      offset,
    });

    collected.push(...page);
    if (page.length < BACKUP_QUERY_PAGE_SIZE) {
      break;
    }
    offset += page.length;
  }

  return collected;
}

async function listAllCustomModules(): Promise<BackupCustomModuleRecord[]> {
  return CustomModuleRepository.listCustomModules();
}

async function listAllModules(): Promise<BackupModuleRecord[]> {
  return ModuleRepository.listAllModules();
}

async function listAllModuleQuestionCounters(): Promise<BackupModuleQuestionCounterRecord[]> {
  return ModuleRepository.listQuestionCounters();
}

async function listAllCustomErrorReasons(): Promise<BackupCustomErrorReasonRecord[]> {
  return CustomErrorReasonRepository.listCustomErrorReasons();
}

type CollectImageArtifactsResult = {
  backupMistakeImages: BackupMistakeImageRecord[];
  archiveImages: BackupImageArchiveFile[];
  warnings: string[];
  copiedImageCount: number;
};

type CollectVoiceArtifactsResult = {
  backupVoiceNotes: BackupVoiceNoteRecord[];
  archiveVoiceFiles: BackupImageArchiveFile[];
  warnings: string[];
  copiedVoiceFileCount: number;
};

async function collectImageArtifacts(
  mistakeImages: Awaited<ReturnType<typeof listAllMistakeImages>>,
  emitProgress?: BackupProgressEmitter,
): Promise<CollectImageArtifactsResult> {
  const backupMistakeImages: BackupMistakeImageRecord[] = [];
  const archiveImages: BackupImageArchiveFile[] = [];
  const warnings: string[] = [];
  let copiedImageCount = 0;
  const totalImages = mistakeImages.length;

  emitProgress?.(
    'collect_images',
    totalImages > 0 ? `正在整理图片 0 / ${totalImages}` : '没有需要整理的图片',
    0,
    totalImages,
  );

  for (let index = 0; index < mistakeImages.length; index += 1) {
    const image = mistakeImages[index];
    const current = index + 1;
    const shouldEmitImageProgress =
      current === 1 ||
      current % BACKUP_IMAGE_PROGRESS_INTERVAL === 0 ||
      totalImages - current < BACKUP_IMAGE_PROGRESS_INTERVAL;

    if (shouldEmitImageProgress) {
      emitProgress?.('collect_images', `正在整理图片 ${current} / ${totalImages}`, index, totalImages);
    }

    const sourceUri = normalizeOptionalText(image.uri);
    const backupRelativePath = mapImageUriForBackup(image.id, sourceUri);

    backupMistakeImages.push({
      id: image.id,
      mistake_id: image.mistake_id,
      review_record_id: image.review_record_id ?? null,
      type: image.type,
      sort_order: image.sort_order,
      created_at: image.created_at,
      sourceUri: null,
      backupRelativePath,
    });

    if (!sourceUri) {
      warnings.push(`IMAGE_MISSING:imageId=${image.id},mistakeId=${image.mistake_id},type=${image.type}`);
      continue;
    }

    try {
      const sourceFile = new File(sourceUri);
      if (!sourceFile.exists) {
        warnings.push(`IMAGE_MISSING:imageId=${image.id},mistakeId=${image.mistake_id},type=${image.type}`);
        continue;
      }

      const sourceInfo = sourceFile.info();
      archiveImages.push({
        backupRelativePath,
        sourceUri: sourceFile.uri,
        sizeBytes: ensureNonNegativeNumber(sourceInfo.size) ? Math.floor(sourceInfo.size) : null,
      });
      copiedImageCount += 1;
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      warnings.push(
        `IMAGE_MISSING:imageId=${image.id},mistakeId=${image.mistake_id},type=${image.type},error=${errorName}`,
      );
    }

    if (shouldEmitImageProgress) {
      emitProgress?.('collect_images', `已整理图片 ${current} / ${totalImages}`, current, totalImages);
    }
  }

  return {
    backupMistakeImages,
    archiveImages,
    warnings,
    copiedImageCount,
  };
}

function countVoiceWarnings(warnings: RestoreWarningItem[]): number {
  let count = 0;
  for (const warning of warnings) {
    if (warning.code.startsWith('RESTORE_VOICE_')) {
      count += 1;
    }
  }
  return count;
}

function normalizeBackupVoiceNoteRecord(
  raw: unknown,
): BackupVoiceNoteRecord | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const input = raw as Partial<BackupVoiceNoteRecord>;
  const id = normalizeRequiredText(input.id);
  const mistakeId = normalizeRequiredText(input.mistakeId);
  const reviewRecordId = normalizeRequiredText(input.reviewRecordId);
  const fileName = normalizeBackupVoiceFileName(input.fileName);
  const durationMs = ensureNonNegativeNumber(input.durationMs) ? Math.floor(input.durationMs) : NaN;
  const sizeBytes = ensureNonNegativeNumber(input.sizeBytes) ? Math.floor(input.sizeBytes) : NaN;
  const createdAt = normalizeRequiredText(input.createdAt);
  const updatedAt = normalizeRequiredText(input.updatedAt);

  if (!id || !mistakeId || !reviewRecordId || !fileName) {
    return null;
  }
  if (!Number.isFinite(durationMs) || !Number.isFinite(sizeBytes)) {
    return null;
  }

  const fallbackIso = new Date().toISOString();
  const normalizedCreatedAt = isValidIsoDateTime(createdAt) ? createdAt : fallbackIso;
  const normalizedUpdatedAt = isValidIsoDateTime(updatedAt) ? updatedAt : normalizedCreatedAt;

  return {
    id,
    mistakeId,
    reviewRecordId,
    fileName,
    durationMs,
    sizeBytes,
    createdAt: normalizedCreatedAt,
    updatedAt: normalizedUpdatedAt,
  };
}

function validateBackupVoiceNotesPayload(raw: unknown): {
  voiceNotes: BackupVoiceNoteRecord[];
  warnings: string[];
} {
  if (raw === null || raw === undefined) {
    return {
      voiceNotes: [],
      warnings: [],
    };
  }

  if (!Array.isArray(raw)) {
    return {
      voiceNotes: [],
      warnings: ['VOICE_NOTES_INVALID:voiceNotes.json must be an array.'],
    };
  }

  const voiceNotes: BackupVoiceNoteRecord[] = [];
  const warnings: string[] = [];

  for (let index = 0; index < raw.length; index += 1) {
    const normalized = normalizeBackupVoiceNoteRecord(raw[index]);
    if (!normalized) {
      warnings.push(`VOICE_NOTES_INVALID:invalid voice note record at index=${index}`);
      continue;
    }
    voiceNotes.push(normalized);
  }

  return {
    voiceNotes,
    warnings,
  };
}

async function collectVoiceArtifacts(
  reviewRecords: Awaited<ReturnType<typeof listAllReviewRecords>>,
  emitProgress?: BackupProgressEmitter,
): Promise<CollectVoiceArtifactsResult> {
  const backupVoiceNotes: BackupVoiceNoteRecord[] = [];
  const archiveVoiceFiles: BackupImageArchiveFile[] = [];
  const warnings: string[] = [];
  let copiedVoiceFileCount = 0;
  const voiceReviewRecords = reviewRecords.filter((reviewRecord) =>
    normalizeReviewRecordVoiceNoteForBackup(reviewRecord.voice_note ?? null) !== null,
  );
  const totalVoiceFiles = voiceReviewRecords.length;

  emitProgress?.(
    'collect_voice',
    totalVoiceFiles > 0 ? `正在整理语音讲解 0 / ${totalVoiceFiles}` : '没有需要整理的语音讲解',
    0,
    totalVoiceFiles,
  );

  for (let index = 0; index < voiceReviewRecords.length; index += 1) {
    const reviewRecord = voiceReviewRecords[index];
    const current = index + 1;
    const normalizedVoiceNote = normalizeReviewRecordVoiceNoteForBackup(reviewRecord.voice_note ?? null);
    if (!normalizedVoiceNote) {
      continue;
    }

    const backupFileName = buildBackupVoiceFileName(
      normalizedVoiceNote.id,
      normalizedVoiceNote.fileName,
      normalizedVoiceNote.fileUri,
    );
    const backupRelativePath = mapVoiceFilePathForBackup(backupFileName);

    let sizeBytes = normalizedVoiceNote.sizeBytes;
    let updatedAt = normalizedVoiceNote.createdAt;

    emitProgress?.(
      'collect_voice',
      `正在读取语音讲解 ${current} / ${totalVoiceFiles}`,
      index,
      totalVoiceFiles,
    );

    try {
      const sourceFile = resolveVoiceSourceFileForBackup(normalizedVoiceNote);
      if (!sourceFile) {
        warnings.push(
          `VOICE_FILE_MISSING:voiceNoteId=${normalizedVoiceNote.id},reviewRecordId=${reviewRecord.id},mistakeId=${reviewRecord.mistake_id},fileName=${normalizedVoiceNote.fileName}`,
        );
      } else {
        const sourceInfo = sourceFile.info();
        archiveVoiceFiles.push({
          backupRelativePath,
          sourceUri: sourceFile.uri,
          sizeBytes: ensureNonNegativeNumber(sourceInfo.size) ? Math.floor(sourceInfo.size) : null,
        });
        copiedVoiceFileCount += 1;

        if (ensureNonNegativeNumber(sourceInfo.size)) {
          sizeBytes = Math.floor(sourceInfo.size);
        }
        const updatedAtFromFile = toIsoStringOrNull(sourceInfo.modificationTime);
        if (updatedAtFromFile) {
          updatedAt = updatedAtFromFile;
        }
      }
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      warnings.push(
        `VOICE_FILE_MISSING:voiceNoteId=${normalizedVoiceNote.id},reviewRecordId=${reviewRecord.id},mistakeId=${reviewRecord.mistake_id},error=${errorName}`,
      );
    }

    backupVoiceNotes.push({
      id: normalizedVoiceNote.id,
      mistakeId: reviewRecord.mistake_id,
      reviewRecordId: reviewRecord.id,
      fileName: backupFileName,
      durationMs: normalizedVoiceNote.durationMs,
      sizeBytes,
      createdAt: normalizedVoiceNote.createdAt,
      updatedAt,
    });

    emitProgress?.(
      'collect_voice',
      `已整理语音讲解 ${current} / ${totalVoiceFiles}`,
      current,
      totalVoiceFiles,
    );
  }

  return {
    backupVoiceNotes,
    archiveVoiceFiles,
    warnings,
    copiedVoiceFileCount,
  };
}

function ensureValidCounts(counts: BackupCounts): BackupCounts {
  if (
    !ensureNonNegativeNumber(counts.mistakes) ||
    !ensureNonNegativeNumber(counts.mistakeImages) ||
    !ensureNonNegativeNumber(counts.reviewRecords) ||
    !ensureNonNegativeNumber(counts.imageFiles)
  ) {
    throw new BackupRestoreError(
      'CORRUPTED_BACKUP_FILE',
      getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
    );
  }
  return counts;
}

function toRestoreExpectedCounts(
  data: BackupDataPayload,
  restorableImageCount: number,
): BackupCounts {
  if (
    !Number.isInteger(restorableImageCount)
    || restorableImageCount < 0
    || restorableImageCount > data.mistakeImages.length
  ) {
    throw new BackupRestoreError(
      'CORRUPTED_BACKUP_FILE',
      getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
    );
  }
  return ensureValidCounts({
    mistakes: data.mistakes.length,
    mistakeImages: restorableImageCount,
    reviewRecords: data.reviewRecords.length,
    imageFiles: restorableImageCount,
  });
}

function ensureSupportedSchemaVersion(schemaVersion: number): void {
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(schemaVersion)) {
    throw buildRestoreError({
      errorCode: 'RESTORE_SCHEMA_UNSUPPORTED',
      stage: 'validate',
      step: 'validate_schema_version',
      details: {
        schemaVersion,
        supportedSchemaVersions: SUPPORTED_SCHEMA_VERSIONS,
      },
    });
  }
}

function cleanupRestoreTempDirectory(directory: Directory | null): { cleaned: boolean; error?: ReturnType<typeof safeError> } {
  if (!directory) {
    return { cleaned: true };
  }

  try {
    if (directory.exists) {
      directory.delete();
    }
    return { cleaned: true };
  } catch (error) {
    return {
      cleaned: false,
      error: safeError(error),
    };
  }
}

function buildFailureMetadata(context: RestoreFailureContext): Record<string, unknown> {
  const rootCause = safeError(context.rootCause);
  const totalDurationMs = nowMs() - context.startedAt;
  context.durations.totalDurationMs = totalDurationMs;
  return {
    restoreSessionId: context.restoreSessionId,
    stage: context.stage,
    step: context.step,
    errorCode: context.errorCode,
    errorName: rootCause.name,
    errorMessage: getBackupErrorUserMessage(context.errorCode),
    rootCauseName: rootCause.name,
    rootCauseMessage: rootCause.message,
    durationMs: totalDurationMs,
    countsParsed: context.countsParsed,
    countsImported: context.countsImported,
    currentCounts: context.currentCounts,
    hasBeforeRestoreBackup: context.hasBeforeRestoreBackup,
    rollbackAttempted: context.rollbackAttempted,
    rollbackSuccess: context.rollbackSuccess,
    warningCount: context.warningCount,
    firstWarnings: firstItems(context.warnings),
    errorCount: context.errors.length,
    firstErrors: firstItems(context.errors),
    durations: context.durations,
  };
}

async function copyBackupFileToTemp(
  fileUri: string,
  restoreSessionId: string,
  fileShortInfo: string,
): Promise<{ tempDirectory: Directory; tempArchiveFile: File; tempArchiveSizeBytes: number }> {
  const sourceFile = new File(fileUri);
  if (!sourceFile.exists) {
    throw buildRestoreError({
      errorCode: 'RESTORE_FILE_STAT_FAILED',
      stage: 'file_stat',
      step: 'check_source_file_exists',
      details: {
        restoreSessionId,
        fileShortInfo,
        sourceUriScheme: getUriScheme(fileUri),
      },
    });
  }

  const rawName = normalizeOptionalText(sourceFile.name) ?? `${restoreSessionId}${BACKUP_FILE_EXTENSION}`;
  const normalizedArchiveName = rawName.toLowerCase().endsWith(BACKUP_FILE_EXTENSION)
    ? rawName
    : `${rawName}${BACKUP_FILE_EXTENSION}`;
  const tempDirectory = new Directory(Paths.cache, RESTORE_TEMP_DIR_NAME, restoreSessionId);
  tempDirectory.create({ intermediates: true, idempotent: true });
  const tempArchiveFile = new File(tempDirectory, normalizedArchiveName);
  const copyStartedAt = nowMs();

  logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_temp_copy_started', {
    restoreSessionId,
    sourceUriScheme: getUriScheme(fileUri),
    targetShortPath: shortPath(tempArchiveFile.uri),
    fileShortInfo,
  });

  try {
    if (tempArchiveFile.exists) {
      tempArchiveFile.delete();
    }

    try {
      sourceFile.copy(tempArchiveFile);
    } catch {
      const sourceInfo = sourceFile.info();
      copyFileInChunks(sourceFile, tempArchiveFile, sourceInfo.size ?? null);
    }
  } catch (error) {
    throw buildRestoreError({
      errorCode: 'RESTORE_TEMP_COPY_FAILED',
      stage: 'temp_copy',
      step: 'copy_source_to_temp',
      cause: error,
      details: {
        restoreSessionId,
        sourceUriScheme: getUriScheme(fileUri),
        targetShortPath: shortPath(tempArchiveFile.uri),
        fileShortInfo,
      },
    });
  }

  const copiedInfo = tempArchiveFile.info();
  const tempFileSizeBytes = typeof copiedInfo.size === 'number' ? copiedInfo.size : 0;
  logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_temp_copy_success', {
    restoreSessionId,
    tempFileShortPath: shortPath(tempArchiveFile.uri),
    tempFileSizeBytes,
    durationMs: nowMs() - copyStartedAt,
  });

  return {
    tempDirectory,
    tempArchiveFile,
    tempArchiveSizeBytes: tempFileSizeBytes,
  };
}

async function readBackupPackageFromTemp(options: {
  restoreSessionId: string;
  tempDirectory: Directory;
  tempArchiveFile: File;
  tempArchiveSizeBytes: number;
}): Promise<ExtractedBackupArchive> {
  const { restoreSessionId, tempDirectory, tempArchiveFile, tempArchiveSizeBytes } = options;
  const readStartedAt = nowMs();

  logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_package_read_started', {
    restoreSessionId,
    tempFileSizeBytes: tempArchiveSizeBytes,
  });

  const extractDirectory = new Directory(tempDirectory, 'extract');
  extractDirectory.create({ intermediates: true, idempotent: true });

  let streamResult: StreamExtractResult;
  try {
    streamResult = extractArchiveToDirectoryStream({
      archiveFile: tempArchiveFile,
      archiveSizeBytes: tempArchiveSizeBytes,
      extractDirectory,
    });
  } catch (error) {
    throw buildRestoreError({
      errorCode: 'RESTORE_PACKAGE_READ_FAILED',
      stage: 'package_read',
      step: 'unzip_backup_archive',
      cause: error,
      details: {
        restoreSessionId,
        tempFileShortPath: shortPath(tempArchiveFile.uri),
      },
    });
  }

  const { archiveFileMap, imageTotalBytes } = streamResult;

  const manifestFile = archiveFileMap.get(BACKUP_MANIFEST_FILE_NAME);
  if (!manifestFile || !manifestFile.exists) {
    throw buildRestoreError({
      errorCode: 'RESTORE_MANIFEST_MISSING',
      stage: 'package_read',
      step: 'ensure_manifest_exists',
      details: {
        restoreSessionId,
      },
    });
  }

  let manifestRaw: unknown;
  try {
    manifestRaw = JSON.parse(strFromU8(await manifestFile.bytes()));
  } catch (error) {
    throw buildRestoreError({
      errorCode: 'RESTORE_JSON_PARSE_FAILED',
      stage: 'package_read',
      step: 'parse_manifest_json',
      cause: error,
      details: {
        restoreSessionId,
      },
    });
  }

  const manifestValidated = validateBackupManifest(manifestRaw);
  if (!manifestValidated.ok || !manifestValidated.manifest) {
    throw buildRestoreError({
      errorCode: 'RESTORE_DATA_VALIDATE_FAILED',
      stage: 'package_read',
      step: 'validate_manifest_shape',
      details: {
        restoreSessionId,
        firstManifestErrors: manifestValidated.errors.slice(0, 5),
      },
    });
  }

  const manifest = ensureManifestRequiredFields(manifestValidated.manifest);
  const warnings = Array.isArray(manifest.warnings) ? manifest.warnings : [];
  const dataFile = archiveFileMap.get(BACKUP_DATA_FILE_NAME);
  if (!dataFile || !dataFile.exists) {
    throw buildRestoreError({
      errorCode: 'RESTORE_PACKAGE_READ_FAILED',
      stage: 'package_read',
      step: 'ensure_data_file_exists',
      details: {
        restoreSessionId,
      },
    });
  }

  let parsedDataRaw: unknown;
  try {
    parsedDataRaw = JSON.parse(strFromU8(await dataFile.bytes()));
  } catch (error) {
    throw buildRestoreError({
      errorCode: 'RESTORE_JSON_PARSE_FAILED',
      stage: 'package_read',
      step: 'parse_data_json',
      cause: error,
      details: {
        restoreSessionId,
      },
    });
  }

  let data: BackupDataPayload;
  try {
    data = validateBackupDataPayload(parsedDataRaw);
    data = normalizeBackupModulesForCurrentSchema(
      data,
      manifest.schemaVersion,
      manifest.createdAt,
    );
  } catch (error) {
    throw buildRestoreError({
      errorCode: 'RESTORE_DATA_VALIDATE_FAILED',
      stage: 'package_read',
      step: 'validate_data_payload_shape',
      cause: error,
      details: {
        restoreSessionId,
      },
    });
  }

  const voiceNotesWarnings: string[] = [];
  let voiceNotes: BackupVoiceNoteRecord[] = [];
  const voiceNotesFile = archiveFileMap.get(BACKUP_VOICE_NOTES_FILE_NAME);
  if (voiceNotesFile && voiceNotesFile.exists) {
    try {
      const rawVoiceNotes = JSON.parse(strFromU8(await voiceNotesFile.bytes()));
      const parsedVoiceNotes = validateBackupVoiceNotesPayload(rawVoiceNotes);
      voiceNotes = parsedVoiceNotes.voiceNotes;
      voiceNotesWarnings.push(...parsedVoiceNotes.warnings);
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      voiceNotesWarnings.push(`VOICE_NOTES_INVALID:failed to parse voiceNotes.json,error=${errorName}`);
      voiceNotes = [];
    }
  }

  logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_package_read_success', {
    restoreSessionId,
    packageFormat: 'zip',
    manifestExists: true,
    manifestVersion: manifest.formatVersion,
    schemaVersion: manifest.schemaVersion,
    appVersionInBackup: manifest.appVersion,
    createdAtInBackup: manifest.createdAt,
    countsFromManifest: manifest.counts,
    voiceNoteCount: voiceNotes.length,
    voiceWarningCount: voiceNotesWarnings.length,
    streamBytesRead: streamResult.bytesRead,
    archiveEntryCount: streamResult.entryCount,
    archiveFileCount: streamResult.fileCount,
    archiveDirectoryCount: streamResult.directoryCount,
    durationMs: nowMs() - readStartedAt,
  });

  return {
    tempArchiveFile,
    tempArchiveSizeBytes,
    tempDirectory: extractDirectory,
    manifest,
    manifestWarnings: warnings,
    data,
    voiceNotes,
    voiceParseWarnings: voiceNotesWarnings,
    archiveFileMap,
    imageTotalBytes,
    countsFromManifest: manifest.counts,
    appVersionInBackup: manifest.appVersion,
    createdAtInBackup: manifest.createdAt,
  };
}

function validateRestorePackage(options: {
  restoreSessionId: string;
  manifest: BackupManifest;
  data: BackupDataPayload;
  archiveFileMap: Map<string, File>;
  warnings: RestoreWarningItem[];
}): { counts: BackupCounts; missingRequiredFieldsCount: number; imageTotalBytes: number; orphanImageSamples: string[] } {
  const { restoreSessionId, manifest, data, archiveFileMap, warnings } = options;
  const validateStartedAt = nowMs();

  logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_package_validate_started', {
    restoreSessionId,
    schemaVersion: manifest.schemaVersion,
    supportedSchemaVersions: SUPPORTED_SCHEMA_VERSIONS,
  });

  ensureSupportedSchemaVersion(manifest.schemaVersion);

  let missingRequiredFieldsCount = 0;
  let relationError: unknown | null = null;
  try {
    ensureBackupPayloadRelations(data);
  } catch (error) {
    relationError = error;
  }
  if (relationError) {
    throw buildRestoreError({
      errorCode: 'RESTORE_DATA_VALIDATE_FAILED',
      stage: 'validate',
      step: 'validate_relations',
      cause: relationError,
      details: {
        restoreSessionId,
      },
    });
  }

  const referencedImageSet = new Set<string>();
  let restorableImageCount = 0;
  for (const image of data.mistakeImages) {
    const relativePath = normalizeArchiveEntryPath(ensureBackupImageRelativePath(ensureRecordId(image.backupRelativePath)));
    referencedImageSet.add(relativePath);
    const sourceFile = archiveFileMap.get(relativePath);
    if (sourceFile?.exists) {
      restorableImageCount += 1;
    }
  }
  const counts = toRestoreExpectedCounts(data, restorableImageCount);

  const orphanImageSamples: string[] = [];
  for (const archivePath of archiveFileMap.keys()) {
    if (!archivePath.startsWith(`${BACKUP_IMAGES_DIR_NAME}/`)) {
      continue;
    }
    if (!referencedImageSet.has(archivePath)) {
      const sample = shortPath(archivePath) ?? archivePath;
      if (orphanImageSamples.length < 5) {
        orphanImageSamples.push(sample);
      }
      appendWarning(warnings, {
        code: 'RESTORE_ORPHAN_IMAGE_FILE',
        stage: 'validate',
        message: 'Backup image file is not referenced by any mistake image record.',
        shortTarget: sample,
      });
    }
  }

  for (const mistake of data.mistakes) {
    if (!normalizeOptionalText(mistake.id)) {
      missingRequiredFieldsCount += 1;
    }
  }

  for (const reviewRecord of data.reviewRecords) {
    if (!normalizeOptionalText(reviewRecord.id) || !normalizeOptionalText(reviewRecord.mistake_id)) {
      missingRequiredFieldsCount += 1;
    }
  }

  for (const tag of data.mistakeTags) {
    if (
      !normalizeOptionalText(tag.id)
      || !normalizeOptionalText(tag.mistake_id)
      || !normalizeOptionalText(tag.name)
      || !normalizeOptionalText(tag.normalized_name)
    ) {
      missingRequiredFieldsCount += 1;
    }
  }

  for (const customModule of data.customModules) {
    if (
      !Number.isInteger(Number(customModule.id))
      || Number(customModule.id) <= 0
      || !normalizeOptionalText(customModule.name)
      || !normalizeOptionalText(customModule.icon)
      || !normalizeOptionalText(customModule.color)
      || !normalizeOptionalText(customModule.created_at)
      || !normalizeOptionalText(customModule.updated_at)
    ) {
      missingRequiredFieldsCount += 1;
    }
  }

  for (const customErrorReason of data.customErrorReasons) {
    if (
      !normalizeOptionalText(customErrorReason.id)
      || !normalizeOptionalText(customErrorReason.name)
      || !normalizeOptionalText(customErrorReason.icon)
      || !normalizeOptionalText(customErrorReason.color)
      || !normalizeOptionalText(customErrorReason.created_at)
      || !normalizeOptionalText(customErrorReason.updated_at)
    ) {
      missingRequiredFieldsCount += 1;
    }
  }

  let imageTotalBytes = 0;
  for (const image of data.mistakeImages) {
    const archivePath = normalizeArchiveEntryPath(ensureBackupImageRelativePath(ensureRecordId(image.backupRelativePath)));
    const sourceFile = archiveFileMap.get(archivePath);
    if (sourceFile && sourceFile.exists) {
      const info = sourceFile.info();
      if (typeof info.size === 'number') {
        imageTotalBytes += info.size;
      }
    }
  }

  logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_package_validate_success', {
    restoreSessionId,
    counts,
    imageTotalBytes,
    missingRequiredFieldsCount,
    warningCount: warnings.length,
    durationMs: nowMs() - validateStartedAt,
  });

  return {
    counts,
    missingRequiredFieldsCount,
    imageTotalBytes,
    orphanImageSamples,
  };
}

async function materializeRestoredImages(options: {
  restoreSessionId: string;
  images: BackupMistakeImageRecord[];
  archiveFileMap: Map<string, File>;
  warnings: RestoreWarningItem[];
  errors: RestoreErrorItem[];
}): Promise<RestoreImageMaterializedResult> {
  const { restoreSessionId, images, archiveFileMap, warnings, errors } = options;
  const restoredImages: RestoredMistakeImageInsert[] = [];
  const missingRelativePaths: string[] = [];
  let restoredFileBytes = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let progressRestored = 0;
  let errorCount = 0;
  const startedAt = nowMs();

  for (const image of images) {
    const normalizedArchivePath = normalizeArchiveEntryPath(
      ensureBackupImageRelativePath(ensureRecordId(image.backupRelativePath)),
    );
    const sourceFile = archiveFileMap.get(normalizedArchivePath);
    if (!sourceFile || !sourceFile.exists) {
      skippedCount += 1;
      missingRelativePaths.push(shortPath(normalizedArchivePath) ?? normalizedArchivePath);
      appendWarning(warnings, {
        code: 'RESTORE_IMAGE_SOURCE_MISSING',
        stage: 'images_restore',
        message: 'Image file missing in backup package.',
        shortTarget: shortPath(normalizedArchivePath) ?? normalizedArchivePath,
      });
      continue;
    }

    try {
      const targetDirectoryUri = await ensureMistakeImageDir(image.mistake_id);
      const targetDirectory = new Directory(targetDirectoryUri);
      targetDirectory.create({ intermediates: true, idempotent: true });

      const targetFile = new File(targetDirectory, mapImageUriForRestore(image));
      if (targetFile.exists) {
        targetFile.delete();
      }
      sourceFile.copy(targetFile);
      const copiedInfo = targetFile.info();
      if (typeof copiedInfo.size === 'number') {
        restoredFileBytes += copiedInfo.size;
      }

      restoredImages.push({
        id: image.id,
        mistake_id: image.mistake_id,
        review_record_id: image.review_record_id ?? null,
        type: image.type,
        sort_order: image.sort_order,
        created_at: image.created_at,
        uri: targetFile.uri,
      });
      progressRestored += 1;
    } catch (error) {
      failedCount += 1;
      errorCount += 1;
      appendError(errors, {
        code: 'RESTORE_IMAGE_COPY_FAILED',
        stage: 'images_restore',
        message: 'Failed to restore image file.',
        shortTarget: shortPath(normalizedArchivePath) ?? normalizedArchivePath,
        rootCauseMessage: safeError(error).message,
      });
    }

    if (progressRestored > 0 && progressRestored % IMAGE_RESTORE_PROGRESS_INTERVAL === 0) {
      logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_images_progress', {
        restoreSessionId,
        restoredCount: progressRestored,
        totalCount: images.length,
        failedCount,
        lastImageShortName: shortPath(normalizedArchivePath),
        durationMs: nowMs() - startedAt,
      });
    }
  }

  return {
    restoredImages,
    missingRelativePaths,
    restoredFileBytes,
    failedCount,
    skippedCount,
    errorCount,
  };
}

async function materializeRestoredVoiceNotes(options: {
  restoreSessionId: string;
  voiceNotes: BackupVoiceNoteRecord[];
  reviewRecords: ReviewRecord[];
  archiveFileMap: Map<string, File>;
  warnings: RestoreWarningItem[];
}): Promise<RestoreVoiceMaterializedResult> {
  const { restoreSessionId, voiceNotes, reviewRecords, archiveFileMap, warnings } = options;
  const resolvedVoiceNotesByReviewRecordId = new Map<string, ReviewRecordVoiceNote>();
  const reviewRecordById = new Map<string, ReviewRecord>();
  let restoredVoiceFileCount = 0;

  for (const reviewRecord of reviewRecords) {
    reviewRecordById.set(reviewRecord.id, reviewRecord);
  }

  if (voiceNotes.length <= 0) {
    return {
      resolvedVoiceNotesByReviewRecordId,
      voiceNoteCount: 0,
      restoredVoiceFileCount: 0,
    };
  }

  const voiceDirectory = getVoiceNotesDirectory();
  voiceDirectory.create({ intermediates: true, idempotent: true });

  for (const voiceNote of voiceNotes) {
    const reviewRecord = reviewRecordById.get(voiceNote.reviewRecordId);
    if (!reviewRecord) {
      appendWarning(warnings, {
        code: 'RESTORE_VOICE_ORPHAN_RECORD',
        stage: 'images_restore',
        message: 'Voice note metadata references a missing review record.',
        shortTarget: voiceNote.reviewRecordId,
      });
      continue;
    }

    if (reviewRecord.mistake_id !== voiceNote.mistakeId) {
      appendWarning(warnings, {
        code: 'RESTORE_VOICE_RELATION_MISMATCH',
        stage: 'images_restore',
        message: 'Voice note metadata mistake relation does not match review record relation.',
        shortTarget: voiceNote.reviewRecordId,
      });
    }

    const normalizedFileName = normalizeBackupVoiceFileName(voiceNote.fileName);
    if (!normalizedFileName) {
      appendWarning(warnings, {
        code: 'RESTORE_VOICE_METADATA_INVALID',
        stage: 'images_restore',
        message: 'Voice note fileName is invalid.',
        shortTarget: voiceNote.reviewRecordId,
      });
      continue;
    }

    const targetFile = new File(voiceDirectory, normalizedFileName);
    const voiceArchivePath = normalizeArchiveEntryPath(mapVoiceFilePathForBackup(normalizedFileName));
    const sourceFile = archiveFileMap.get(voiceArchivePath);
    let sizeBytes = voiceNote.sizeBytes;

    if (!sourceFile || !sourceFile.exists) {
      appendWarning(warnings, {
        code: 'RESTORE_VOICE_FILE_MISSING',
        stage: 'images_restore',
        message: 'Voice note file is missing in backup package.',
        shortTarget: shortPath(voiceArchivePath) ?? voiceArchivePath,
      });
    } else {
      try {
        if (targetFile.exists) {
          targetFile.delete();
        }
        sourceFile.copy(targetFile);
        const targetInfo = targetFile.info();
        if (ensureNonNegativeNumber(targetInfo.size)) {
          sizeBytes = Math.floor(targetInfo.size);
        }
        restoredVoiceFileCount += 1;
      } catch (error) {
        appendWarning(warnings, {
          code: 'RESTORE_VOICE_COPY_FAILED',
          stage: 'images_restore',
          message: 'Failed to restore voice note file.',
          shortTarget: shortPath(voiceArchivePath) ?? voiceArchivePath,
          detail: safeError(error).message,
        });
      }
    }

    const resolvedVoiceNote: ReviewRecordVoiceNote = {
      id: voiceNote.id,
      fileUri: targetFile.uri,
      fileName: normalizedFileName,
      durationMs: voiceNote.durationMs,
      sizeBytes,
      createdAt: voiceNote.createdAt,
    };

    if (resolvedVoiceNotesByReviewRecordId.has(voiceNote.reviewRecordId)) {
      appendWarning(warnings, {
        code: 'RESTORE_VOICE_DUPLICATE_RECORD',
        stage: 'images_restore',
        message: 'Duplicate voice note metadata found for one review record. Latest one wins.',
        shortTarget: voiceNote.reviewRecordId,
      });
    }

    resolvedVoiceNotesByReviewRecordId.set(voiceNote.reviewRecordId, resolvedVoiceNote);
  }

  logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_voice_files_done', {
    restoreSessionId,
    voiceNoteCount: resolvedVoiceNotesByReviewRecordId.size,
    restoredVoiceFileCount,
  });

  return {
    resolvedVoiceNotesByReviewRecordId,
    voiceNoteCount: resolvedVoiceNotesByReviewRecordId.size,
    restoredVoiceFileCount,
  };
}

async function runRestoreDatabaseTransaction(options: {
  restoreSessionId: string;
  data: BackupDataPayload;
  restoredImages: RestoredMistakeImageInsert[];
  resolvedVoiceNotesByReviewRecordId: Map<string, ReviewRecordVoiceNote>;
  shouldRestoreCustomConfiguration: boolean;
  errors: RestoreErrorItem[];
}): Promise<{ counts: BackupCounts; dbClearDurationMs: number }> {
  const {
    restoreSessionId,
    data,
    restoredImages,
    resolvedVoiceNotesByReviewRecordId,
    shouldRestoreCustomConfiguration,
    errors,
  } = options;
  const importStartedAt = nowMs();
  let dbClearDurationMs = 0;
  try {
    await withDatabaseTransaction(async (db) => {
      const dbClearStartedAt = nowMs();
      try {
        await db.runAsync('DELETE FROM mistake_relations;');
        await db.runAsync('DELETE FROM mistake_tags;');
        await db.runAsync('DELETE FROM review_records;');
        await db.runAsync('DELETE FROM mistake_images;');
        await db.runAsync('DELETE FROM mistakes;');
        if (shouldRestoreCustomConfiguration) {
          await db.runAsync('DELETE FROM module_question_counters;');
          await db.runAsync('DELETE FROM modules;');
          await db.runAsync('DELETE FROM custom_error_reasons;');
        } else {
          await db.runAsync(
            "DELETE FROM module_question_counters WHERE module_id IN (SELECT id FROM modules WHERE type <> 'custom');",
          );
          await db.runAsync("DELETE FROM modules WHERE type <> 'custom';");
        }
      } catch (error) {
        appendError(errors, {
          code: 'RESTORE_DB_CLEAR_FAILED',
          stage: 'db_clear',
          message: 'Failed to clear existing restore tables.',
          rootCauseMessage: safeError(error).message,
        });
        throw buildRestoreError({
          errorCode: 'RESTORE_DB_CLEAR_FAILED',
          stage: 'db_clear',
          step: 'delete_existing_records',
          cause: error,
          details: {
            restoreSessionId,
          },
        });
      }

      logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_db_clear_success', {
        restoreSessionId,
        countsAfterClear: {
          mistakes: 0,
          mistakeImages: 0,
          reviewRecords: 0,
          imageFiles: 0,
        },
        durationMs: nowMs() - dbClearStartedAt,
      });
      dbClearDurationMs = nowMs() - dbClearStartedAt;

      try {
        for (let index = 0; index < data.modules.length; index += 1) {
          const moduleItem = data.modules[index];
          if (!shouldRestoreCustomConfiguration && moduleItem.type === 'custom') {
            continue;
          }
          await db.runAsync(
            INSERT_MODULE_SQL,
            moduleItem.id,
            moduleItem.type,
            moduleItem.name,
            moduleItem.display_code,
            moduleItem.custom_no,
            moduleItem.icon,
            moduleItem.color,
            moduleItem.sort_order,
            moduleItem.is_active ? 1 : 0,
            moduleItem.created_at,
            moduleItem.updated_at,
          );
        }

        if (shouldRestoreCustomConfiguration) {
          for (let index = 0; index < data.customErrorReasons.length; index += 1) {
            const customErrorReason = data.customErrorReasons[index];
            await db.runAsync(
              INSERT_CUSTOM_ERROR_REASON_SQL,
              customErrorReason.id,
              customErrorReason.name,
              customErrorReason.icon,
              customErrorReason.color,
              customErrorReason.sort_order,
              customErrorReason.created_at,
              customErrorReason.updated_at,
            );

            if ((index + 1) % DB_IMPORT_PROGRESS_INTERVAL === 0 || index === data.customErrorReasons.length - 1) {
              logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_db_import_progress', {
                restoreSessionId,
                tableName: 'custom_error_reasons',
                importedCount: index + 1,
                totalCount: data.customErrorReasons.length,
                durationMs: nowMs() - importStartedAt,
              });
            }
          }
        }

        for (let index = 0; index < data.mistakes.length; index += 1) {
          const mistake = data.mistakes[index];
          await db.runAsync(
            INSERT_MISTAKE_SQL,
            mistake.id,
            mistake.subject,
            mistake.module,
            mistake.module_id,
            mistake.question_no,
            mistake.title ?? null,
            mistake.error_reason ?? null,
            mistake.error_reason_ids ?? null,
            mistake.difficulty,
            mistake.note ?? null,
            mistake.my_solution_text ?? null,
            mistake.answer_text ?? null,
            mistake.note_highlights ?? null,
            mistake.review_count,
            mistake.status,
            mistake.created_at,
            mistake.updated_at,
            mistake.next_review_at ?? null,
            mistake.last_review_at ?? null,
            mistake.last_review_result ?? null,
            mistake.is_pinned ? 1 : 0,
            mistake.last_viewed_at ?? null,
          );

          if ((index + 1) % DB_IMPORT_PROGRESS_INTERVAL === 0 || index === data.mistakes.length - 1) {
            logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_db_import_progress', {
              restoreSessionId,
              tableName: 'mistakes',
              importedCount: index + 1,
              totalCount: data.mistakes.length,
              durationMs: nowMs() - importStartedAt,
            });
          }
        }

        for (let index = 0; index < data.moduleQuestionCounters.length; index += 1) {
          const counter = data.moduleQuestionCounters[index];
          if (
            !shouldRestoreCustomConfiguration
            && data.modules.some((item) => item.id === counter.module_id && item.type === 'custom')
          ) {
            continue;
          }
          await db.runAsync(
            INSERT_MODULE_QUESTION_COUNTER_SQL,
            counter.module_id,
            counter.last_question_no,
            counter.updated_at,
          );
        }

        for (let index = 0; index < data.reviewRecords.length; index += 1) {
          const reviewRecord = data.reviewRecords[index];
          const restoredVoiceNote = resolvedVoiceNotesByReviewRecordId.get(reviewRecord.id);
          const fallbackVoiceNote = normalizeReviewRecordVoiceNoteForBackup(reviewRecord.voice_note ?? null);
          const resolvedVoiceNote = restoredVoiceNote ?? fallbackVoiceNote;
          const voiceNoteJson = resolvedVoiceNote ? JSON.stringify(resolvedVoiceNote) : null;
          await db.runAsync(
            INSERT_REVIEW_RECORD_SQL,
            reviewRecord.id,
            reviewRecord.mistake_id,
            reviewRecord.review_index,
            reviewRecord.result,
            reviewRecord.note ?? null,
            reviewRecord.note_highlights ?? null,
            voiceNoteJson,
            reviewRecord.created_at,
          );

          if ((index + 1) % DB_IMPORT_PROGRESS_INTERVAL === 0 || index === data.reviewRecords.length - 1) {
            logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_db_import_progress', {
              restoreSessionId,
              tableName: 'review_records',
              importedCount: index + 1,
              totalCount: data.reviewRecords.length,
              durationMs: nowMs() - importStartedAt,
            });
          }
        }

        for (let index = 0; index < data.mistakeTags.length; index += 1) {
          const tag = data.mistakeTags[index];
          await db.runAsync(
            INSERT_MISTAKE_TAG_SQL,
            tag.id,
            tag.mistake_id,
            tag.name,
            tag.normalized_name,
            tag.sort_order,
            tag.created_at,
            tag.updated_at,
          );

          if ((index + 1) % DB_IMPORT_PROGRESS_INTERVAL === 0 || index === data.mistakeTags.length - 1) {
            logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_db_import_progress', {
              restoreSessionId,
              tableName: 'mistake_tags',
              importedCount: index + 1,
              totalCount: data.mistakeTags.length,
              durationMs: nowMs() - importStartedAt,
            });
          }
        }

        for (let index = 0; index < restoredImages.length; index += 1) {
          const image = restoredImages[index];
          await db.runAsync(
            INSERT_MISTAKE_IMAGE_SQL,
            image.id,
            image.mistake_id,
            image.review_record_id ?? null,
            image.type,
            image.uri,
            image.sort_order,
            image.created_at,
          );

          if ((index + 1) % DB_IMPORT_PROGRESS_INTERVAL === 0 || index === restoredImages.length - 1) {
            logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_db_import_progress', {
              restoreSessionId,
              tableName: 'mistake_images',
              importedCount: index + 1,
              totalCount: restoredImages.length,
              durationMs: nowMs() - importStartedAt,
            });
          }
        }

        for (let index = 0; index < data.mistakeRelations.length; index += 1) {
          const relation = data.mistakeRelations[index];
          await db.runAsync(
            INSERT_MISTAKE_RELATION_SQL,
            relation.id,
            relation.source_mistake_id,
            relation.target_mistake_id,
            relation.source,
            relation.created_at,
          );

          if ((index + 1) % DB_IMPORT_PROGRESS_INTERVAL === 0 || index === data.mistakeRelations.length - 1) {
            logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_db_import_progress', {
              restoreSessionId,
              tableName: 'mistake_relations',
              importedCount: index + 1,
              totalCount: data.mistakeRelations.length,
              durationMs: nowMs() - importStartedAt,
            });
          }
        }
      } catch (error) {
        appendError(errors, {
          code: 'RESTORE_DB_IMPORT_FAILED',
          stage: 'db_import',
          message: 'Failed to import records into database.',
          rootCauseMessage: safeError(error).message,
        });
        throw buildRestoreError({
          errorCode: 'RESTORE_DB_IMPORT_FAILED',
          stage: 'db_import',
          step: 'insert_restore_records',
          cause: error,
          details: {
            restoreSessionId,
          },
        });
      }
    });
  } catch (error) {
    if (error instanceof BackupRestoreError) {
      throw error;
    }
    throw buildRestoreError({
      errorCode: 'RESTORE_DB_IMPORT_FAILED',
      stage: 'db_import',
      step: 'write_transaction',
      cause: error,
      details: {
        restoreSessionId,
      },
    });
  }

  return {
    counts: ensureValidCounts({
      mistakes: data.mistakes.length,
      mistakeImages: restoredImages.length,
      reviewRecords: data.reviewRecords.length,
      imageFiles: restoredImages.length,
    }),
    dbClearDurationMs,
  };
}

async function verifyRestoreResults(options: {
  restoreSessionId: string;
  expectedCounts: BackupCounts;
  importedCounts: BackupCounts;
  restoredImages: RestoredMistakeImageInsert[];
  missingImageSamples: string[];
  orphanImageSamples: string[];
}): Promise<RestoreVerifyResult> {
  const { restoreSessionId, expectedCounts, importedCounts, restoredImages, missingImageSamples, orphanImageSamples } = options;
  const actualDbCounts = await readCurrentDatabaseCounts();
  let actualImageFiles = 0;
  for (const image of restoredImages) {
    const file = new File(image.uri);
    if (file.exists) {
      actualImageFiles += 1;
    }
  }

  const actualCounts: BackupCounts = {
    mistakes: actualDbCounts.mistakes,
    mistakeImages: actualDbCounts.mistakeImages,
    reviewRecords: actualDbCounts.reviewRecords,
    imageFiles: actualImageFiles,
  };
  const mismatch: Record<keyof BackupCounts, boolean> = {
    mistakes: actualCounts.mistakes !== expectedCounts.mistakes,
    mistakeImages: actualCounts.mistakeImages !== expectedCounts.mistakeImages,
    reviewRecords: actualCounts.reviewRecords !== expectedCounts.reviewRecords,
    imageFiles: actualCounts.imageFiles !== expectedCounts.imageFiles,
  };

  const verifyResult: RestoreVerifyResult = {
    expectedCounts: cloneCounts(expectedCounts),
    actualCounts,
    mismatch,
    missingImageSamples: missingImageSamples.slice(0, 5),
    orphanImageSamples: orphanImageSamples.slice(0, 5),
    imageFilesExpected: expectedCounts.imageFiles,
    imageFilesActual: actualCounts.imageFiles,
  };

  if (mismatch.mistakes || mismatch.mistakeImages || mismatch.reviewRecords || mismatch.imageFiles) {
    throw buildRestoreError({
      errorCode: 'RESTORE_VERIFY_FAILED',
      stage: 'verify',
      step: 'compare_expected_actual_counts',
      details: {
        restoreSessionId,
        expectedCounts,
        actualCounts,
        mismatch,
        missingImageSamples: verifyResult.missingImageSamples,
        orphanImageSamples: verifyResult.orphanImageSamples,
        importedCounts,
      },
    });
  }

  return verifyResult;
}

export function configureBackupZipAdapter(adapter: BackupZipAdapter): void {
  zipAdapter = adapter;
}

export async function createBackup(options?: CreateBackupOptions): Promise<CreateBackupServiceResult> {
  const sessionId = buildSessionId('backup');
  const startedAt = Date.now();
  const reason = options?.reason ?? 'manual';
  const emitProgress = createBackupProgressEmitter(sessionId, startedAt, options?.onProgress);
  const context: BackupCollectContext = {
    counts: { ...EMPTY_COUNTS },
    warningCount: 0,
  };

  emitProgress('starting', '正在准备备份...', 0, 0);
  logBackupEvent('backup_start', sessionId, 0, {
    counts: context.counts,
    warningCount: context.warningCount,
    reason,
  });

  try {
    emitProgress('collect_db', '正在读取错题、图片、复做记录和自定义配置...', 0, 0);
    const [
      mistakes,
      mistakeImages,
      reviewRecords,
      mistakeRelations,
      mistakeTags,
      modules,
      moduleQuestionCounters,
      customModules,
      customErrorReasons,
    ] = await Promise.all([
      listAllMistakes(),
      listAllMistakeImages(),
      listAllReviewRecords(),
      listAllMistakeRelations(),
      listAllMistakeTags(),
      listAllModules(),
      listAllModuleQuestionCounters(),
      listAllCustomModules(),
      listAllCustomErrorReasons(),
    ]);

    context.counts = {
      ...context.counts,
      mistakes: mistakes.length,
      mistakeImages: mistakeImages.length,
      reviewRecords: reviewRecords.length,
    };
    emitProgress(
      'collect_db',
      `已读取 ${mistakes.length} 道错题、${mistakeImages.length} 张图片、${reviewRecords.length} 条复做记录`,
      mistakes.length + mistakeImages.length + reviewRecords.length,
      mistakes.length + mistakeImages.length + reviewRecords.length,
    );
    logBackupEvent('backup_collect_db_done', sessionId, Date.now() - startedAt, {
      counts: context.counts,
      warningCount: context.warningCount,
      reason,
    });

    const imageArtifacts = await collectImageArtifacts(mistakeImages, emitProgress);
    const voiceArtifacts = await collectVoiceArtifacts(reviewRecords, emitProgress);
    const backupWarnings = [...imageArtifacts.warnings, ...voiceArtifacts.warnings];
    context.warningCount = backupWarnings.length;
    context.counts = {
      ...context.counts,
      imageFiles: imageArtifacts.copiedImageCount,
    };
    logBackupEvent('backup_collect_images_done', sessionId, Date.now() - startedAt, {
      counts: context.counts,
      warningCount: context.warningCount,
      reason,
    });

    const appMeta = resolveAppMeta();
    const manifest: BackupManifest = createBackupManifest({
      appName: appMeta.appName,
      appVersion: appMeta.appVersion,
      schemaVersion: DATABASE_VERSION,
      devicePlatform: toBackupDevicePlatform(),
      counts: context.counts,
      warnings: backupWarnings,
    });

    const data: BackupDataPayload = {
      mistakes,
      mistakeImages: imageArtifacts.backupMistakeImages,
      reviewRecords,
      mistakeRelations,
      mistakeTags,
      modules,
      moduleQuestionCounters,
      customModules,
      customErrorReasons,
      extra: {
        reason,
        mistakeRelationCount: mistakeRelations.length,
        mistakeTagCount: mistakeTags.length,
        moduleCount: modules.length,
        moduleQuestionCounterCount: moduleQuestionCounters.length,
        customModuleCount: customModules.length,
        customErrorReasonCount: customErrorReasons.length,
        voiceNoteCount: voiceArtifacts.backupVoiceNotes.length,
        voiceFileCount: voiceArtifacts.copiedVoiceFileCount,
      },
    };

    const packageFileCount = imageArtifacts.archiveImages.length + voiceArtifacts.archiveVoiceFiles.length;
    emitProgress(
      'package',
      `正在生成备份文件（图片 ${imageArtifacts.archiveImages.length} 张，语音 ${voiceArtifacts.archiveVoiceFiles.length} 条）`,
      0,
      0,
    );
    await yieldToBackupProgressFrame();
    const packaged = await zipAdapter.createBackupPackage({
      fileName: buildBackupFileName(),
      manifest,
      data,
      images: imageArtifacts.archiveImages,
      voiceNotes: voiceArtifacts.backupVoiceNotes,
      voiceFiles: voiceArtifacts.archiveVoiceFiles,
      onFilePacked: (event) => {
        emitProgress(
          'package',
          `正在写入备份文件 ${event.current} / ${event.total}`,
          event.current,
          event.total,
        );
      },
    });
    emitProgress('success', '备份文件已生成', packageFileCount, packageFileCount);

    logBackupEvent('backup_package_created', sessionId, Date.now() - startedAt, {
      counts: context.counts,
      warningCount: context.warningCount,
      reason,
    });

    const packagedFileInfo = new File(packaged.fileUri).info();
    const fileSizeBytes =
      typeof packagedFileInfo.size === 'number' && Number.isFinite(packagedFileInfo.size)
        ? packagedFileInfo.size
        : null;

    return {
      fileUri: packaged.fileUri,
      fileName: packaged.fileName,
      fileSizeBytes,
      manifest,
    };
  } catch (error) {
    const normalized = normalizeBackupError(error, 'BACKUP_FAILED');
    Logger.error(SERVICE_SCOPE, 'backup_failed', {
      sessionId,
      counts: context.counts,
      durationMs: Date.now() - startedAt,
      warningCount: context.warningCount,
      errorName: normalized.name,
      errorMessage: normalized.message,
      reason,
    });
    throw normalized;
  }
}

export async function inspectBackup(
  fileUri: string,
  options?: { restoreSessionId?: string; fileShortInfo?: string },
): Promise<InspectBackupResult> {
  const restoreSessionId = normalizeOptionalText(options?.restoreSessionId) ?? createRestoreSessionId();
  const fileShortInfo = normalizeOptionalText(options?.fileShortInfo) ?? getFileShortInfo(fileUri);
  const startedAt = nowMs();

  logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_inspect_start', {
    restoreSessionId,
    fileShortInfo,
    durationMs: 0,
  });

  try {
    const normalizedUri = normalizeOptionalText(fileUri);
    if (!normalizedUri) {
      throw new BackupRestoreError('INVALID_BACKUP_FILE', getBackupErrorUserMessage('INVALID_BACKUP_FILE'), {
        stage: 'file_pick',
        step: 'validate_backup_uri',
      });
    }

    const file = new File(normalizedUri);
    const fileName = normalizeOptionalText(file.name)?.toLowerCase() ?? '';
    if (!fileName.endsWith(BACKUP_FILE_EXTENSION)) {
      throw new BackupRestoreError('INVALID_BACKUP_FILE', getBackupErrorUserMessage('INVALID_BACKUP_FILE'), {
        stage: 'file_stat',
        step: 'validate_backup_extension',
      });
    }
    if (!file.exists) {
      throw new BackupRestoreError(
        'PERMISSION_OR_FILE_ACCESS_FAILED',
        getBackupErrorUserMessage('PERMISSION_OR_FILE_ACCESS_FAILED'),
        {
          stage: 'file_stat',
          step: 'check_backup_file_exists',
        },
      );
    }

    let manifestBytes: Uint8Array;
    let manifestBytesRead = 0;
    try {
      const fileInfo = file.info();
      const manifestReadResult = readManifestBytesFromArchiveStream(file, fileInfo.size ?? null);
      manifestBytes = manifestReadResult.manifestBytes;
      manifestBytesRead = manifestReadResult.bytesRead;
    } catch (error) {
      if (error instanceof BackupRestoreError) {
        throw error;
      }
      throw new BackupRestoreError(
        'RESTORE_PACKAGE_READ_FAILED',
        getBackupErrorUserMessage('RESTORE_PACKAGE_READ_FAILED'),
        {
          stage: 'package_read',
          step: 'unzip_backup_archive',
          cause: error,
        },
      );
    }

    let manifestRaw: unknown;
    try {
      manifestRaw = JSON.parse(strFromU8(manifestBytes));
    } catch (error) {
      throw new BackupRestoreError('RESTORE_JSON_PARSE_FAILED', getBackupErrorUserMessage('RESTORE_JSON_PARSE_FAILED'), {
        stage: 'package_read',
        step: 'parse_manifest_json',
        cause: error,
      });
    }

    const validated = validateBackupManifest(manifestRaw);
    if (!validated.ok || !validated.manifest) {
      throw new BackupRestoreError(
        'RESTORE_DATA_VALIDATE_FAILED',
        getBackupErrorUserMessage('RESTORE_DATA_VALIDATE_FAILED'),
        {
          stage: 'validate',
          step: 'validate_manifest_shape',
          details: {
            firstErrors: validated.errors.slice(0, 5),
          },
        },
      );
    }

    const manifest = validated.manifest;
    if (manifest.format !== BACKUP_FORMAT) {
      throw new BackupRestoreError('INVALID_BACKUP_FILE', getBackupErrorUserMessage('INVALID_BACKUP_FILE'), {
        stage: 'validate',
        step: 'validate_manifest_format',
      });
    }
    if (manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
      throw new BackupRestoreError(
        'UNSUPPORTED_BACKUP_VERSION',
        getBackupErrorUserMessage('UNSUPPORTED_BACKUP_VERSION'),
        {
          stage: 'validate',
          step: 'validate_manifest_format_version',
        },
      );
    }

    const normalizedManifest = ensureManifestRequiredFields(manifest);
    const warnings = Array.isArray(normalizedManifest.warnings) ? normalizedManifest.warnings : [];
    logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_inspect_done', {
      restoreSessionId,
      fileShortInfo,
      durationMs: nowMs() - startedAt,
      counts: normalizedManifest.counts,
      inspectedBytes: manifestBytesRead,
      warningCount: warnings.length,
    });

    return {
      manifest: normalizedManifest,
      warnings,
    };
  } catch (error) {
    const normalized = normalizeBackupError(error, 'RESTORE_UNKNOWN_FAILED');
    logRestoreEvent(SERVICE_SCOPE, 'error', 'restore_inspect_failed', {
      restoreSessionId,
      fileShortInfo,
      durationMs: nowMs() - startedAt,
      counts: EMPTY_COUNTS,
      warningCount: 0,
      errorCode: normalized.code,
      stage: normalized.stage ?? 'unknown',
      step: normalized.step ?? 'unknown',
      errorName: normalized.name,
      errorMessage: normalized.message,
      rootCause: safeError(normalized.cause),
    });
    throw normalized;
  }
}

export async function restoreFromBackup(
  fileUri: string,
  options?: RestoreFromBackupOptions,
): Promise<RestoreFromBackupResult> {
  const restoreSessionId = normalizeOptionalText(options?.restoreSessionId) ?? createRestoreSessionId();
  const startedAt = nowMs();
  const fileShortInfo = normalizeOptionalText(options?.fileShortInfo) ?? getFileShortInfo(fileUri);
  const shouldCreateBeforeSnapshot = options?.skipBeforeSnapshot !== true;
  const shouldAttemptRollback = options?.allowRollback !== false;
  const emitProgress = (stage: RestoreProgressStage, message: string): void => {
    const callback = options?.onProgress;
    if (!callback) {
      return;
    }
    const payload: RestoreProgressEvent = {
      restoreSessionId,
      stage,
      message,
    };
    try {
      callback(payload);
    } catch (error) {
      Logger.warn(SERVICE_SCOPE, 'restore_progress_callback_failed', {
        restoreSessionId,
        stage,
        error: safeError(error),
      });
    }
  };
  const warnings: RestoreWarningItem[] = [];
  const errors: RestoreErrorItem[] = [];
  const durations = createEmptyDurations();
  const failureContext: RestoreFailureContext = {
    restoreSessionId,
    stage: 'unknown',
    step: 'unknown',
    errorCode: 'RESTORE_UNKNOWN_FAILED',
    startedAt,
    fileShortInfo,
    countsParsed: cloneCounts(EMPTY_COUNTS),
    countsImported: cloneCounts(EMPTY_COUNTS),
    currentCounts: cloneCounts(EMPTY_COUNTS),
    warningCount: 0,
    warnings,
    errors,
    hasBeforeRestoreBackup: false,
    rollbackAttempted: false,
    rollbackSuccess: false,
    durations,
  };

  let tempDirectory: Directory | null = null;
  let beforeRestoreBackupUri: string | undefined;
  let orphanImageSamples: string[] = [];
  let missingImageSamples: string[] = [];
  let skippedImageCount = 0;
  let restoredVoiceNoteCount = 0;
  let restoredVoiceFileCount = 0;
  let tempCopyStartedAt: number | null = null;
  let packageReadStartedAt: number | null = null;
  let validateStartedAt: number | null = null;
  let beforeSnapshotStartedAt: number | null = null;
  let dbImportStartedAt: number | null = null;
  let imageRestoreStartedAt: number | null = null;
  let verifyStartedAt: number | null = null;

  try {
    const normalizedUri = normalizeOptionalText(fileUri);
    if (!normalizedUri) {
      throw buildRestoreError({
        errorCode: 'RESTORE_FILE_PICK_FAILED',
        stage: 'file_pick',
        step: 'validate_backup_uri',
      });
    }
    emitProgress('starting', 'Preparing restore environment...')

    const selectedFile = new File(normalizedUri);
    const fileName = normalizeOptionalText(selectedFile.name) ?? fileShortInfo;
    const extension = fileName.toLowerCase();
    if (!extension.endsWith(BACKUP_FILE_EXTENSION)) {
      throw buildRestoreError({
        errorCode: 'INVALID_BACKUP_FILE',
        stage: 'file_stat',
        step: 'validate_backup_extension',
        details: {
          restoreSessionId,
          fileShortInfo,
        },
      });
    }

    failureContext.stage = 'file_stat';
    failureContext.step = 'read_source_file_info';
    const fileInfo = selectedFile.info();
    if (!selectedFile.exists || fileInfo.exists === false) {
      throw buildRestoreError({
        errorCode: 'RESTORE_FILE_STAT_FAILED',
        stage: 'file_stat',
        step: 'check_source_file_exists',
        details: {
          restoreSessionId,
          fileShortInfo,
          sourceUriScheme: getUriScheme(normalizedUri),
        },
      });
    }

    const currentCountsBeforeRestore = await readCurrentDatabaseCounts();
    failureContext.currentCounts = cloneCounts(currentCountsBeforeRestore);

    failureContext.stage = 'temp_copy';
    failureContext.step = 'copy_source_to_temp';
    emitProgress('temp_copy', 'Copying backup file to temp directory...')
    tempCopyStartedAt = nowMs();
    const copied = await copyBackupFileToTemp(normalizedUri, restoreSessionId, fileShortInfo);
    durations.tempCopyDurationMs = nowMs() - tempCopyStartedAt;
    tempDirectory = copied.tempDirectory;

    failureContext.stage = 'package_read';
    failureContext.step = 'read_backup_package';
    emitProgress('package_read', 'Reading backup package...')
    packageReadStartedAt = nowMs();
    const extracted = await readBackupPackageFromTemp({
      restoreSessionId,
      tempDirectory: copied.tempDirectory,
      tempArchiveFile: copied.tempArchiveFile,
      tempArchiveSizeBytes: copied.tempArchiveSizeBytes,
    });
    durations.packageReadDurationMs = nowMs() - packageReadStartedAt;

    for (const warningText of extracted.manifestWarnings.slice(0, 20)) {
      appendWarning(warnings, {
        code: 'RESTORE_MANIFEST_WARNING',
        stage: 'validate',
        message: warningText,
      });
    }
    for (const warningText of extracted.voiceParseWarnings.slice(0, 20)) {
      appendWarning(warnings, {
        code: 'RESTORE_VOICE_METADATA_INVALID',
        stage: 'validate',
        message: warningText,
      });
    }

    failureContext.stage = 'validate';
    failureContext.step = 'validate_manifest_and_data';
    emitProgress('validate', 'Validating backup data...')
    validateStartedAt = nowMs();
    const validateResult = validateRestorePackage({
      restoreSessionId,
      manifest: extracted.manifest,
      data: extracted.data,
      archiveFileMap: extracted.archiveFileMap,
      warnings,
    });
    durations.validateDurationMs = nowMs() - validateStartedAt;
    failureContext.countsParsed = cloneCounts(validateResult.counts);
    orphanImageSamples = validateResult.orphanImageSamples;

    if (shouldCreateBeforeSnapshot) {
      emitProgress('before_snapshot', 'Creating pre-restore safety backup...')
      logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_before_snapshot_started', {
        restoreSessionId,
        currentCountsBeforeRestore,
      });

      failureContext.stage = 'before_snapshot';
      failureContext.step = 'create_before_restore_backup';
      beforeSnapshotStartedAt = nowMs();
      let safetyBackup: CreateBackupServiceResult;
      try {
        safetyBackup = await createBackup({ reason: 'before_restore' });
      } catch (error) {
        throw buildRestoreError({
          errorCode: 'RESTORE_BEFORE_SNAPSHOT_FAILED',
          stage: 'before_snapshot',
          step: 'create_before_restore_backup',
          cause: error,
          details: {
            restoreSessionId,
          },
        });
      }
      beforeRestoreBackupUri = safetyBackup.fileUri;
      failureContext.hasBeforeRestoreBackup = true;
      durations.beforeSnapshotDurationMs = nowMs() - beforeSnapshotStartedAt;
      logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_before_snapshot_success', {
        restoreSessionId,
        snapshotShortPath: shortPath(beforeRestoreBackupUri),
        snapshotCounts: safetyBackup.manifest.counts,
        snapshotSizeBytes: new File(safetyBackup.fileUri).info().size ?? null,
        durationMs: durations.beforeSnapshotDurationMs,
      });
    }

    logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_db_clear_started', {
      restoreSessionId,
      currentCountsBeforeClear: currentCountsBeforeRestore,
    });
    failureContext.stage = 'db_import';
    failureContext.step = 'write_restore_transaction';
    emitProgress('db_import', 'Importing records into database...')
    dbImportStartedAt = nowMs();
    logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_db_import_started', {
      restoreSessionId,
      targetCounts: validateResult.counts,
    });

    logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_images_started', {
      restoreSessionId,
      imageFileCount: extracted.data.mistakeImages.length,
      imageTotalBytes: validateResult.imageTotalBytes,
    });
    failureContext.stage = 'images_restore';
    failureContext.step = 'copy_image_files';
    emitProgress('images_restore', 'Restoring image files...')
    imageRestoreStartedAt = nowMs();
    const imageResult = await materializeRestoredImages({
      restoreSessionId,
      images: extracted.data.mistakeImages,
      archiveFileMap: extracted.archiveFileMap,
      warnings,
      errors,
    });
    durations.imageRestoreDurationMs = nowMs() - imageRestoreStartedAt;
    missingImageSamples = imageResult.missingRelativePaths.slice(0, 5);
    skippedImageCount = imageResult.skippedCount;

    logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_images_success', {
      restoreSessionId,
      restoredImageFileCount: imageResult.restoredImages.length,
      skippedImageFileCount: imageResult.skippedCount,
      failedImageFileCount: imageResult.failedCount,
      imageTotalBytes: imageResult.restoredFileBytes,
      durationMs: durations.imageRestoreDurationMs,
    });

    logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_voice_files_started', {
      restoreSessionId,
      voiceNoteCountInPackage: extracted.voiceNotes.length,
    });
    const voiceResult = await materializeRestoredVoiceNotes({
      restoreSessionId,
      voiceNotes: extracted.voiceNotes,
      reviewRecords: extracted.data.reviewRecords,
      archiveFileMap: extracted.archiveFileMap,
      warnings,
    });
    restoredVoiceNoteCount = voiceResult.voiceNoteCount;
    restoredVoiceFileCount = voiceResult.restoredVoiceFileCount;
    const voiceWarningCountAfterVoiceRestore = countVoiceWarnings(warnings);
    logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_voice_files_success', {
      restoreSessionId,
      restoredVoiceNoteCount: restoredVoiceNoteCount,
      restoredVoiceFileCount: restoredVoiceFileCount,
      voiceWarningCount: voiceWarningCountAfterVoiceRestore,
    });

    const dbTransactionResult = await runRestoreDatabaseTransaction({
      restoreSessionId,
      data: extracted.data,
      restoredImages: imageResult.restoredImages,
      resolvedVoiceNotesByReviewRecordId: voiceResult.resolvedVoiceNotesByReviewRecordId,
      shouldRestoreCustomConfiguration: extracted.manifest.schemaVersion >= 7,
      errors,
    });
    const importedCounts = dbTransactionResult.counts;
    durations.dbImportDurationMs = nowMs() - dbImportStartedAt;
    durations.dbClearDurationMs = dbTransactionResult.dbClearDurationMs;
    failureContext.countsImported = cloneCounts(importedCounts);
    failureContext.currentCounts = cloneCounts(importedCounts);

    logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_db_import_success', {
      restoreSessionId,
      importedCounts: {
        mistakes: importedCounts.mistakes,
        mistakeImages: importedCounts.mistakeImages,
        reviewRecords: importedCounts.reviewRecords,
        customModules: extracted.manifest.schemaVersion >= 7 ? extracted.data.customModules.length : 'preserved',
        customErrorReasons: extracted.manifest.schemaVersion >= 7 ? extracted.data.customErrorReasons.length : 'preserved',
      },
      durationMs: durations.dbImportDurationMs,
    });

    failureContext.stage = 'verify';
    failureContext.step = 'compare_expected_actual_counts';
    emitProgress('verify', 'Verifying restored data...')
    verifyStartedAt = nowMs();
    logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_verify_started', {
      restoreSessionId,
      expectedCounts: validateResult.counts,
    });
    const verifyResult = await verifyRestoreResults({
      restoreSessionId,
      expectedCounts: validateResult.counts,
      importedCounts,
      restoredImages: imageResult.restoredImages,
      missingImageSamples,
      orphanImageSamples,
    });
    durations.verifyDurationMs = nowMs() - verifyStartedAt;
    logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_verify_success', {
      restoreSessionId,
      expectedCounts: verifyResult.expectedCounts,
      actualCounts: verifyResult.actualCounts,
      mismatch: verifyResult.mismatch,
      missingImageSamples: verifyResult.missingImageSamples,
      orphanImageSamples: verifyResult.orphanImageSamples,
      imageFilesExpected: verifyResult.imageFilesExpected,
      imageFilesActual: verifyResult.imageFilesActual,
      durationMs: durations.verifyDurationMs,
    });

    durations.totalDurationMs = nowMs() - startedAt;
    failureContext.warningCount = warnings.length;
    const voiceWarningCount = countVoiceWarnings(warnings);
    logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_success', {
      restoreSessionId,
      fileShortInfo,
      totalDurationMs: durations.totalDurationMs,
      finalCounts: importedCounts,
      voiceNoteCount: restoredVoiceNoteCount,
      voiceFileCount: restoredVoiceFileCount,
      voiceWarningCount,
      warningCount: warnings.length,
      hasBeforeRestoreBackup: !!beforeRestoreBackupUri,
      durations,
    });
    emitProgress('success', 'Restore completed')

    return {
      restoreSessionId,
      restoredMistakes: importedCounts.mistakes,
      restoredImages: importedCounts.mistakeImages,
      skippedImageCount,
      restoredReviewRecords: importedCounts.reviewRecords,
      voiceNoteCount: restoredVoiceNoteCount,
      voiceFileCount: restoredVoiceFileCount,
      voiceWarningCount,
      warningCount: warnings.length,
      errorCount: errors.length,
      hasBeforeRestoreBackup: !!beforeRestoreBackupUri,
      beforeRestoreBackupUri,
    };
  } catch (error) {
    const normalized = normalizeBackupError(error, 'RESTORE_UNKNOWN_FAILED');
    const resolvedStage = (normalized.stage as RestoreStage | undefined) ?? failureContext.stage;
    const resolvedStep = normalized.step ?? failureContext.step;
    let resolvedErrorCode: BackupRestoreErrorCode = normalized.code;

    if (
      (normalized.code === 'CORRUPTED_BACKUP_FILE' || normalized.code === 'INVALID_BACKUP_FILE') &&
      resolvedStage === 'package_read'
    ) {
      resolvedErrorCode = 'RESTORE_PACKAGE_READ_FAILED';
    } else if (
      (normalized.code === 'CORRUPTED_BACKUP_FILE' || normalized.code === 'INVALID_BACKUP_FILE') &&
      resolvedStage === 'validate'
    ) {
      resolvedErrorCode = 'RESTORE_DATA_VALIDATE_FAILED';
    } else if (normalized.code === 'UNSUPPORTED_BACKUP_VERSION' && resolvedStage === 'validate') {
      resolvedErrorCode = 'RESTORE_SCHEMA_UNSUPPORTED';
    }

    if (durations.tempCopyDurationMs === 0 && tempCopyStartedAt !== null && resolvedStage === 'temp_copy') {
      durations.tempCopyDurationMs = nowMs() - tempCopyStartedAt;
    }
    if (durations.packageReadDurationMs === 0 && packageReadStartedAt !== null && resolvedStage === 'package_read') {
      durations.packageReadDurationMs = nowMs() - packageReadStartedAt;
    }
    if (durations.validateDurationMs === 0 && validateStartedAt !== null && resolvedStage === 'validate') {
      durations.validateDurationMs = nowMs() - validateStartedAt;
    }
    if (
      durations.beforeSnapshotDurationMs === 0 &&
      beforeSnapshotStartedAt !== null &&
      resolvedStage === 'before_snapshot'
    ) {
      durations.beforeSnapshotDurationMs = nowMs() - beforeSnapshotStartedAt;
    }
    if (durations.dbImportDurationMs === 0 && dbImportStartedAt !== null && resolvedStage === 'db_import') {
      durations.dbImportDurationMs = nowMs() - dbImportStartedAt;
    }
    if (durations.imageRestoreDurationMs === 0 && imageRestoreStartedAt !== null && resolvedStage === 'images_restore') {
      durations.imageRestoreDurationMs = nowMs() - imageRestoreStartedAt;
    }
    if (durations.verifyDurationMs === 0 && verifyStartedAt !== null && resolvedStage === 'verify') {
      durations.verifyDurationMs = nowMs() - verifyStartedAt;
    }

    failureContext.errorCode = resolvedErrorCode;
    failureContext.stage = resolvedStage;
    failureContext.step = resolvedStep;
    failureContext.rootCause = normalized.cause ?? error;
    failureContext.warningCount = warnings.length;
    failureContext.hasBeforeRestoreBackup = !!beforeRestoreBackupUri;
    appendError(errors, {
      code: resolvedErrorCode,
      stage: resolvedStage,
      message: getBackupErrorUserMessage(resolvedErrorCode),
      shortTarget: fileShortInfo,
      rootCauseMessage: safeError(normalized.cause ?? error).message,
    });

    const canAttemptRollback = shouldAttemptRollback && shouldCreateBeforeSnapshot;
    if (canAttemptRollback && typeof beforeRestoreBackupUri === 'string') {
      const rollbackBackupUri = beforeRestoreBackupUri;
      failureContext.rollbackAttempted = true;
      const rollbackStartedAt = nowMs();
      const rollbackSessionId = `${restoreSessionId}-rollback`;
      const rollbackFileShortInfo = shortPath(rollbackBackupUri) ?? 'before-restore-backup.qsbk';
      emitProgress('rollback', 'Rollback is running...')

      logRestoreEvent(SERVICE_SCOPE, 'warn', 'restore_rollback_started', {
        restoreSessionId,
        rollbackSessionId,
        rollbackSourceShortPath: rollbackFileShortInfo,
        originalErrorCode: resolvedErrorCode,
        originalStage: resolvedStage,
        originalStep: resolvedStep,
      });

      try {
        const rollbackResult = await restoreFromBackup(rollbackBackupUri, {
          restoreSessionId: rollbackSessionId,
          fileShortInfo: rollbackFileShortInfo,
          skipBeforeSnapshot: true,
          allowRollback: false,
        });

        durations.rollbackDurationMs = nowMs() - rollbackStartedAt;
        failureContext.rollbackSuccess = true;
        try {
          failureContext.currentCounts = await readCurrentDatabaseCounts();
        } catch {
          // best-effort diagnostics only
        }
        emitProgress('rollback', 'Rollback is running...')
        logRestoreEvent(SERVICE_SCOPE, 'warn', 'restore_rollback_success', {
          restoreSessionId,
          rollbackSessionId,
          durationMs: durations.rollbackDurationMs,
          rollbackCounts: {
            mistakes: rollbackResult.restoredMistakes,
            mistakeImages: rollbackResult.restoredImages,
            reviewRecords: rollbackResult.restoredReviewRecords,
            imageFiles: rollbackResult.restoredImages,
          },
        });
      } catch (rollbackError) {
        durations.rollbackDurationMs = nowMs() - rollbackStartedAt;
        failureContext.rollbackSuccess = false;
        const normalizedRollback = normalizeBackupError(rollbackError, 'RESTORE_ROLLBACK_FAILED');
        const rollbackCauseMessage = safeError(normalizedRollback.cause ?? rollbackError).message;
        appendError(errors, {
          code: 'RESTORE_ROLLBACK_FAILED',
          stage: 'rollback',
          message: getBackupErrorUserMessage('RESTORE_ROLLBACK_FAILED'),
          shortTarget: rollbackFileShortInfo,
          rootCauseMessage: rollbackCauseMessage,
        });

        resolvedErrorCode = 'RESTORE_ROLLBACK_FAILED';
        failureContext.errorCode = resolvedErrorCode;
        failureContext.stage = 'rollback';
        failureContext.step = 'restore_from_before_snapshot';
        failureContext.rootCause = normalizedRollback.cause ?? rollbackError;

        logRestoreEvent(SERVICE_SCOPE, 'error', 'restore_rollback_failed', {
          restoreSessionId,
          rollbackSessionId,
          durationMs: durations.rollbackDurationMs,
          rollbackErrorCode: normalizedRollback.code,
          rollbackErrorName: normalizedRollback.name,
          rollbackErrorMessage: normalizedRollback.message,
          rollbackRootCause: safeError(normalizedRollback.cause ?? rollbackError),
        });
        emitProgress('rollback', 'Rollback is running...')
      }
    } else {
      failureContext.rollbackAttempted = false;
      failureContext.rollbackSuccess = false;
    }

    const failureMetadata = buildFailureMetadata(failureContext);
    logRestoreEvent(SERVICE_SCOPE, 'error', 'restore_failed', {
      ...failureMetadata,
      fileShortInfo,
    });

    throw buildRestoreError({
      errorCode: resolvedErrorCode,
      stage: failureContext.stage,
      step: failureContext.step,
      cause: normalized.cause ?? normalized,
      userMessage: getBackupErrorUserMessage('RESTORE_FAILED'),
      details: {
        ...failureMetadata,
        fileShortInfo,
      },
    });
  } finally {
    const cleanupStartedAt = nowMs();
    const cleanupResult = cleanupRestoreTempDirectory(tempDirectory);
    durations.cleanupDurationMs = nowMs() - cleanupStartedAt;
    if (!cleanupResult.cleaned) {
      logRestoreEvent(SERVICE_SCOPE, 'warn', 'restore_cleanup_failed', {
        restoreSessionId,
        durationMs: durations.cleanupDurationMs,
        cleanupError: cleanupResult.error,
      });
    } else {
      logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_cleanup_success', {
        restoreSessionId,
        durationMs: durations.cleanupDurationMs,
      });
    }
  }
}

export async function shareBackup(fileUri: string): Promise<void> {
  const sessionId = buildSessionId('backup');
  const startedAt = Date.now();

  try {
    const file = new File(fileUri);
    if (!file.exists) {
      throw new BackupRestoreError(
        'PERMISSION_OR_FILE_ACCESS_FAILED',
        getBackupErrorUserMessage('PERMISSION_OR_FILE_ACCESS_FAILED'),
      );
    }

    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) {
      throw new BackupRestoreError('BACKUP_FAILED', getBackupErrorUserMessage('BACKUP_FAILED'));
    }

    logBackupEvent('backup_share_opened', sessionId, Date.now() - startedAt, {
      counts: EMPTY_COUNTS,
      warningCount: 0,
      reason: 'manual',
    });

    await Sharing.shareAsync(fileUri, {
      dialogTitle: 'Save backup file',
      mimeType: 'application/octet-stream',
      UTI: 'public.data',
    });
  } catch (error) {
    if (isUserCancelledShare(error)) {
      Logger.info(SERVICE_SCOPE, 'Backup share canceled by user.', {
        sessionId,
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    const normalized = normalizeBackupError(error, 'BACKUP_FAILED');
    Logger.error(SERVICE_SCOPE, 'backup_failed', {
      sessionId,
      counts: EMPTY_COUNTS,
      durationMs: Date.now() - startedAt,
      warningCount: 0,
      errorName: normalized.name,
      errorMessage: normalized.message,
      reason: 'manual',
    });
    throw normalized;
  }
}

export async function previewBackupPackage(): Promise<never> {
  throw createNotImplementedBackupError('previewBackupPackage');
}

export async function restoreFromBackupPackage(options: {
  backupUri: string;
  requireUserConfirmation: boolean;
  restoreSessionId?: string;
  fileShortInfo?: string;
}): Promise<RestoreFromBackupResult> {
  if (!options.requireUserConfirmation) {
    throw new BackupRestoreError('RESTORE_FAILED', getBackupErrorUserMessage('RESTORE_FAILED'));
  }
  return restoreFromBackup(options.backupUri, {
    restoreSessionId: options.restoreSessionId,
    fileShortInfo: options.fileShortInfo,
  });
}

function createBackupProgressEmitter(
  backupSessionId: string,
  startedAt: number,
  onProgress?: CreateBackupOptions['onProgress'],
): BackupProgressEmitter {
  return (
    stage: BackupProgressStage,
    message: string,
    current = 0,
    total = 0,
  ) => {
    if (!onProgress) {
      return;
    }

    const normalizedCurrent = Number.isFinite(current) ? Math.max(0, Math.floor(current)) : 0;
    const normalizedTotal = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
    const event: BackupProgressEvent = {
      backupSessionId,
      stage,
      message,
      current: normalizedTotal > 0 ? Math.min(normalizedCurrent, normalizedTotal) : normalizedCurrent,
      total: normalizedTotal,
      elapsedSeconds: Math.max(0, Math.floor((Date.now() - startedAt) / 1000)),
    };

    onProgress(event);
  };
}

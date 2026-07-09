import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';

import { Logger } from '@/src/services/Logger';
import { createRecordId } from '@/src/utils/id';

import type {
  AddLocalTrackResult,
  MusicLoopMode,
  MusicTrack,
  PersistedMusicState,
} from './musicTypes';

const SERVICE_SCOPE = 'MusicStorage';
const APP_STATE_DIR_NAME = 'qishua_wrongbook';
const SETTINGS_DIR_NAME = 'settings';
const SETTINGS_FILE_NAME = 'music_settings.json';
const MUSIC_DIR_NAME = 'app-music';
const SUPPORTED_EXTENSIONS = new Set(['mp3', 'm4a', 'wav', 'aac', 'ogg']);
const SUPPORTED_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/x-m4a',
  'audio/wav',
  'audio/x-wav',
  'audio/aac',
  'audio/ogg',
  'application/ogg',
]);

const DEFAULT_STATE: PersistedMusicState = {
  version: 1,
  playlist: [],
  currentTrackId: null,
  loopMode: 'one',
  enabled: false,
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeMimeType(value: unknown): string | null {
  const normalized = normalizeText(value).toLowerCase();
  return normalized || null;
}

function getExtension(fileName: string): string {
  const cleanName = fileName.split(/[?#]/, 1)[0] ?? '';
  const dotIndex = cleanName.lastIndexOf('.');
  return dotIndex >= 0 ? cleanName.slice(dotIndex + 1).toLowerCase() : '';
}

function isSupportedAudio(fileName: string, mimeType: string | null): boolean {
  const extension = getExtension(fileName);
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    return false;
  }
  return !mimeType || mimeType.startsWith('audio/') || SUPPORTED_MIME_TYPES.has(mimeType);
}

function getSettingsDirectory(): Directory {
  return new Directory(Paths.document, APP_STATE_DIR_NAME, SETTINGS_DIR_NAME);
}

function getSettingsFile(): File {
  return new File(getSettingsDirectory(), SETTINGS_FILE_NAME);
}

function getMusicDirectory(): Directory {
  return new Directory(Paths.document, MUSIC_DIR_NAME);
}

function ensureMusicDirectory(): Directory {
  const directory = getMusicDirectory();
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

function normalizeTrack(value: unknown): MusicTrack | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const input = value as Partial<MusicTrack>;
  const id = normalizeText(input.id);
  const fileUri = normalizeText(input.fileUri);
  const fileName = normalizeText(input.fileName);
  const originalFileName = normalizeText(input.originalFileName);
  const addedAt = normalizeText(input.addedAt);
  const sizeBytes =
    typeof input.sizeBytes === 'number' && Number.isFinite(input.sizeBytes)
      ? Math.max(0, input.sizeBytes)
      : 0;

  if (!id || !fileUri || !fileName || !originalFileName || !addedAt) {
    return null;
  }

  return {
    id,
    fileUri,
    fileName,
    originalFileName,
    mimeType: normalizeMimeType(input.mimeType),
    sizeBytes,
    addedAt,
  };
}

function normalizeLoopMode(value: unknown): MusicLoopMode {
  return value === 'off' ? 'off' : 'one';
}

function normalizePersistedState(value: unknown): PersistedMusicState {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_STATE };
  }
  const input = value as Partial<PersistedMusicState>;
  const playlist = Array.isArray(input.playlist)
    ? input.playlist.map(normalizeTrack).filter((track): track is MusicTrack => track !== null)
    : [];
  const requestedTrackId = normalizeText(input.currentTrackId) || null;
  const currentTrackId = playlist.some((track) => track.id === requestedTrackId)
    ? requestedTrackId
    : playlist[0]?.id ?? null;

  return {
    version: 1,
    playlist,
    currentTrackId,
    loopMode: normalizeLoopMode(input.loopMode),
    enabled: input.enabled === true,
  };
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return fallback;
}

function createPersistentFileName(id: string, originalFileName: string): string {
  const extension = getExtension(originalFileName);
  return `music_${id}.${extension}`;
}

export async function loadMusicState(): Promise<PersistedMusicState> {
  try {
    const settingsFile = getSettingsFile();
    if (!settingsFile.exists) {
      return { ...DEFAULT_STATE };
    }
    const parsed = JSON.parse(await settingsFile.text()) as unknown;
    const normalized = normalizePersistedState(parsed);
    const validPlaylist = normalized.playlist.filter((track) => {
      try {
        return new File(track.fileUri).exists;
      } catch {
        return false;
      }
    });
    const currentTrackId = validPlaylist.some((track) => track.id === normalized.currentTrackId)
      ? normalized.currentTrackId
      : validPlaylist[0]?.id ?? null;
    return {
      ...normalized,
      playlist: validPlaylist,
      currentTrackId,
      enabled: validPlaylist.length > 0 && normalized.enabled,
    };
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Failed to load music settings.', { error });
    return { ...DEFAULT_STATE };
  }
}

export async function saveMusicState(state: PersistedMusicState): Promise<void> {
  const normalized = normalizePersistedState(state);
  const directory = getSettingsDirectory();
  directory.create({ intermediates: true, idempotent: true });
  getSettingsFile().write(JSON.stringify(normalized));
}

export function musicTrackExists(track: MusicTrack): boolean {
  try {
    return new File(track.fileUri).exists;
  } catch {
    return false;
  }
}

export async function pickAndPersistLocalTrack(): Promise<AddLocalTrackResult> {
  try {
    const pickerResult = await DocumentPicker.getDocumentAsync({
      type: 'audio/*',
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (pickerResult.canceled) {
      return { ok: true, canceled: true };
    }

    const asset = pickerResult.assets[0];
    if (!asset) {
      return {
        ok: false,
        canceled: false,
        errorMessage: '没有读取到所选音频，请重试。',
      };
    }

    const originalFileName = normalizeText(asset.name);
    const mimeType = normalizeMimeType(asset.mimeType);
    if (!isSupportedAudio(originalFileName, mimeType)) {
      return {
        ok: false,
        canceled: false,
        errorMessage: '仅支持 mp3、m4a、wav、aac、ogg 音频文件。',
      };
    }

    const sourceFile = new File(asset.uri);
    if (!sourceFile.exists) {
      return {
        ok: false,
        canceled: false,
        errorMessage: '所选音频文件不存在或暂时无法读取。',
      };
    }

    const id = createRecordId('MUSIC');
    const directory = ensureMusicDirectory();
    const targetFile = new File(directory, createPersistentFileName(id, originalFileName));
    sourceFile.copy(targetFile);

    if (!targetFile.exists) {
      throw new Error('音频复制后不可用');
    }

    const track: MusicTrack = {
      id,
      fileUri: targetFile.uri,
      fileName: targetFile.name,
      originalFileName,
      mimeType,
      sizeBytes:
        typeof asset.size === 'number' && Number.isFinite(asset.size)
          ? Math.max(0, asset.size)
          : Math.max(0, targetFile.size),
      addedAt: new Date().toISOString(),
    };

    Logger.info(SERVICE_SCOPE, 'Local music copied to persistent storage.', {
      trackId: id,
      fileName: track.fileName,
      sizeBytes: track.sizeBytes,
    });
    return { ok: true, canceled: false, track };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Failed to select or persist local music.', { error });
    return {
      ok: false,
      canceled: false,
      errorMessage: toErrorMessage(error, '添加本地歌曲失败，请重试。'),
    };
  }
}

export async function deletePersistedTrack(track: MusicTrack): Promise<void> {
  try {
    const file = new File(track.fileUri);
    if (file.exists) {
      file.delete();
    }
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Failed to delete persisted music file.', {
      trackId: track.id,
      error,
    });
  }
}

import {
  AudioModule,
  RecordingPresets,
  createAudioPlayer,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioRecorder,
  type PermissionResponse,
  type PermissionStatus,
  type RecordingOptions,
  type RecorderState,
} from 'expo-audio';
import { Directory, File, Paths, type FileInfo } from 'expo-file-system';

import { Logger } from '@/src/services/Logger';
import { createRecordId } from '@/src/utils/id';

const SERVICE_SCOPE = 'VoiceNoteService';
const VOICE_NOTE_DIR_NAME = 'voice-notes';
const DEFAULT_VOICE_NOTE_EXTENSION = '.m4a';
const PLAYBACK_FAILED_MESSAGE = 'Voice note playback failed. Please try again.';
const RECORDING_FAILED_MESSAGE = 'Voice note recording failed. Please try again.';
const SAVE_FAILED_MESSAGE = 'Saving voice note failed. Please try again.';
const STOP_PLAYING_FAILED_MESSAGE = 'Stopping voice note playback failed. Please try again.';

export type VoiceNoteEntity = {
  id: string;
  fileUri: string;
  fileName: string;
  durationMs: number;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
};

export type VoiceNotePermissionResult = {
  ok: boolean;
  granted: boolean;
  status: PermissionStatus | null;
  canAskAgain: boolean;
  errorMessage?: string;
};

export type VoiceNoteActionResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      errorMessage: string;
    };

export type StopAndSaveRecordingResult =
  | {
      ok: true;
      voiceNote: VoiceNoteEntity;
    }
  | {
      ok: false;
      errorMessage: string;
    };

export type DeleteVoiceNoteResult = {
  ok: boolean;
  deleted: boolean;
  errorMessage?: string;
};

export type VoiceNoteFileInfo = {
  exists: boolean;
  fileUri: string;
  fileName: string | null;
  sizeBytes: number | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type GetVoiceNoteFileInfoResult =
  | {
      ok: true;
      info: VoiceNoteFileInfo;
    }
  | {
      ok: false;
      info: VoiceNoteFileInfo;
      errorMessage: string;
    };

let activeRecorder: AudioRecorder | null = null;
let activeRecorderStartedAtMs: number | null = null;
let activePlayer: AudioPlayer | null = null;
let activePlayerUri: string | null = null;

type AudioRecorderConstructor = new (options: Partial<RecordingOptions>) => AudioRecorder;

function normalizeRequiredText(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalized = normalizeRequiredText(value);
  return normalized.length > 0 ? normalized : null;
}

function toShortUri(uri: string | null | undefined): string | null {
  const normalized = normalizeOptionalText(uri);
  if (!normalized) {
    return null;
  }
  if (normalized.length <= 64) {
    return normalized;
  }
  return `${normalized.slice(0, 28)}...${normalized.slice(-20)}`;
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message.length > 0 ? message : fallback;
  }
  const message = String(error ?? '').trim();
  return message.length > 0 ? message : fallback;
}

function getVoiceNoteDirectory(): Directory {
  return new Directory(Paths.document, VOICE_NOTE_DIR_NAME);
}

async function ensureVoiceNoteDirectory(): Promise<Directory> {
  const directory = getVoiceNoteDirectory();
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

function toIsoString(timestampMs: number | null | undefined): string | null {
  if (typeof timestampMs !== 'number' || !Number.isFinite(timestampMs) || timestampMs <= 0) {
    return null;
  }
  return new Date(timestampMs).toISOString();
}

function resolveDurationMs(durationMillis: number, startedAtMs: number | null): number {
  if (Number.isFinite(durationMillis) && durationMillis > 0) {
    return Math.floor(durationMillis);
  }
  if (typeof startedAtMs === 'number' && startedAtMs > 0) {
    return Math.max(0, Date.now() - startedAtMs);
  }
  return 0;
}

function resolveFileExtension(fileUri: string): string {
  const cleanUri = fileUri.split(/[?#]/, 1)[0] ?? '';
  const extensionMatch = cleanUri.match(/(\.[a-zA-Z0-9]+)$/);
  if (!extensionMatch) {
    return DEFAULT_VOICE_NOTE_EXTENSION;
  }
  return extensionMatch[1].toLowerCase();
}

function buildVoiceNoteFileName(id: string, extension: string): string {
  return `voice_note_${id}${extension}`;
}

function resolveTargetFile(directory: Directory, preferredFileName: string): File {
  const lastDotIndex = preferredFileName.lastIndexOf('.');
  const hasExtension = lastDotIndex > 0;
  const baseName = hasExtension ? preferredFileName.slice(0, lastDotIndex) : preferredFileName;
  const extension = hasExtension ? preferredFileName.slice(lastDotIndex) : '';

  let targetFile = new File(directory, preferredFileName);
  let suffix = 1;

  while (targetFile.exists && suffix < 1000) {
    targetFile = new File(directory, `${baseName}_${suffix}${extension}`);
    suffix += 1;
  }

  return targetFile;
}

function resolveVoiceNoteFileSize(fileInfo: FileInfo, fallbackFile: File): number {
  if (typeof fileInfo.size === 'number' && Number.isFinite(fileInfo.size) && fileInfo.size >= 0) {
    return fileInfo.size;
  }
  if (Number.isFinite(fallbackFile.size) && fallbackFile.size >= 0) {
    return fallbackFile.size;
  }
  return 0;
}

function buildEmptyVoiceNoteFileInfo(fileUri: string): VoiceNoteFileInfo {
  const normalizedUri = normalizeRequiredText(fileUri);
  const fileName = normalizedUri ? new File(normalizedUri).name : null;
  return {
    exists: false,
    fileUri: normalizedUri,
    fileName,
    sizeBytes: null,
    createdAt: null,
    updatedAt: null,
  };
}

function getAudioRecorderConstructor(): AudioRecorderConstructor {
  const audioModule = AudioModule as unknown as {
    AudioRecorder: AudioRecorderConstructor;
  };
  return audioModule.AudioRecorder;
}

async function applyRecordingAudioMode(allowsRecording: boolean): Promise<void> {
  try {
    await setAudioModeAsync({
      allowsRecording,
      playsInSilentMode: true,
      interruptionMode: 'doNotMix',
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
      allowsBackgroundRecording: false,
    });
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Failed to set audio mode.', { allowsRecording, error });
  }
}

async function clearActiveRecorderState(): Promise<void> {
  activeRecorder = null;
  activeRecorderStartedAtMs = null;
  await applyRecordingAudioMode(false);
}

async function stopPlayingInternal(): Promise<void> {
  const player = activePlayer;
  const playerUri = activePlayerUri;
  activePlayer = null;
  activePlayerUri = null;

  if (!player) {
    return;
  }

  try {
    player.pause();
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Failed to pause audio player while stopping playback.', {
      fileUriShort: toShortUri(playerUri),
      error,
    });
  }

  try {
    await player.seekTo(0);
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Failed to reset audio player position while stopping playback.', {
      fileUriShort: toShortUri(playerUri),
      error,
    });
  }

  try {
    player.remove();
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Failed to release audio player while stopping playback.', {
      fileUriShort: toShortUri(playerUri),
      error,
    });
  }
}

function mapPermissionResult(permission: PermissionResponse): VoiceNotePermissionResult {
  return {
    ok: true,
    granted: permission.granted,
    status: permission.status,
    canAskAgain: permission.canAskAgain,
  };
}

export async function requestPermission(): Promise<VoiceNotePermissionResult> {
  try {
    const permission = await requestRecordingPermissionsAsync();
    const result = mapPermissionResult(permission);
    Logger.info(SERVICE_SCOPE, 'Recording permission request completed.', {
      granted: result.granted,
      status: result.status,
      canAskAgain: result.canAskAgain,
    });
    return result;
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Recording permission request failed.', { error });
    return {
      ok: false,
      granted: false,
      status: null,
      canAskAgain: false,
      errorMessage: toErrorMessage(error, RECORDING_FAILED_MESSAGE),
    };
  }
}

export async function startRecording(): Promise<VoiceNoteActionResult> {
  if (activeRecorder) {
    try {
      const state = activeRecorder.getStatus();
      if (state.isRecording) {
        return { ok: false, errorMessage: 'Recording is already in progress.' };
      }
    } catch (error) {
      Logger.warn(SERVICE_SCOPE, 'Failed to read recorder status when starting a new recording.', {
        error,
      });
    }
    await clearActiveRecorderState();
  }

  const permission = await requestPermission();
  if (!permission.granted) {
    return {
      ok: false,
      errorMessage:
        permission.errorMessage ?? 'Microphone permission was not granted. Cannot start recording.',
    };
  }

  try {
    await stopPlayingInternal();
    await applyRecordingAudioMode(true);

    const RecorderConstructor = getAudioRecorderConstructor();
    const recorder = new RecorderConstructor(RecordingPresets.HIGH_QUALITY);
    await recorder.prepareToRecordAsync(RecordingPresets.HIGH_QUALITY);
    recorder.record();

    activeRecorder = recorder;
    activeRecorderStartedAtMs = Date.now();

    Logger.info(SERVICE_SCOPE, 'Voice note recording started.', {});
    return { ok: true };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Failed to start voice note recording.', { error });
    await clearActiveRecorderState();
    return {
      ok: false,
      errorMessage: toErrorMessage(error, RECORDING_FAILED_MESSAGE),
    };
  }
}

export async function stopAndSaveRecording(): Promise<StopAndSaveRecordingResult> {
  const recorder = activeRecorder;
  const startedAtMs = activeRecorderStartedAtMs;

  if (!recorder) {
    return {
      ok: false,
      errorMessage: 'No active recording to stop.',
    };
  }

  try {
    await recorder.stop();
    const recorderState: RecorderState = recorder.getStatus();
    const sourceUri = normalizeOptionalText(recorder.uri ?? recorderState.url);
    const durationMs = resolveDurationMs(recorderState.durationMillis, startedAtMs);

    if (!sourceUri) {
      Logger.warn(SERVICE_SCOPE, 'Recording stopped but source uri is missing.', {});
      return {
        ok: false,
        errorMessage: SAVE_FAILED_MESSAGE,
      };
    }

    const sourceFile = new File(sourceUri);
    if (!sourceFile.exists) {
      Logger.warn(SERVICE_SCOPE, 'Recording file does not exist when saving.', {
        sourceUriShort: toShortUri(sourceUri),
      });
      return {
        ok: false,
        errorMessage: SAVE_FAILED_MESSAGE,
      };
    }

    const directory = await ensureVoiceNoteDirectory();
    const voiceNoteId = createRecordId('VN');
    const extension = resolveFileExtension(sourceUri);
    const preferredFileName = buildVoiceNoteFileName(voiceNoteId, extension);
    const targetFile = resolveTargetFile(directory, preferredFileName);

    sourceFile.move(targetFile);

    const targetInfo = targetFile.info();
    const fallbackTimestamp = new Date().toISOString();
    const createdAt = toIsoString(targetInfo.creationTime) ?? fallbackTimestamp;
    const updatedAt = toIsoString(targetInfo.modificationTime) ?? createdAt;

    const voiceNote: VoiceNoteEntity = {
      id: voiceNoteId,
      fileUri: targetFile.uri,
      fileName: targetFile.name,
      durationMs,
      sizeBytes: resolveVoiceNoteFileSize(targetInfo, targetFile),
      createdAt,
      updatedAt,
    };

    Logger.info(SERVICE_SCOPE, 'Voice note recording saved successfully.', {
      id: voiceNote.id,
      fileName: voiceNote.fileName,
      durationMs: voiceNote.durationMs,
      sizeBytes: voiceNote.sizeBytes,
      fileUriShort: toShortUri(voiceNote.fileUri),
    });

    return {
      ok: true,
      voiceNote,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Failed to stop and save voice note recording.', { error });
    return {
      ok: false,
      errorMessage: toErrorMessage(error, SAVE_FAILED_MESSAGE),
    };
  } finally {
    await clearActiveRecorderState();
  }
}

export async function playVoiceNote(fileUri: string): Promise<VoiceNoteActionResult> {
  const normalizedFileUri = normalizeRequiredText(fileUri);
  if (!normalizedFileUri) {
    return {
      ok: false,
      errorMessage: 'Voice note file uri is required.',
    };
  }

  try {
    const file = new File(normalizedFileUri);
    if (!file.exists) {
      return {
        ok: false,
        errorMessage: 'Voice note file was not found.',
      };
    }

    await stopPlayingInternal();
    const player = createAudioPlayer(normalizedFileUri);
    player.play();

    activePlayer = player;
    activePlayerUri = normalizedFileUri;

    Logger.info(SERVICE_SCOPE, 'Voice note playback started.', {
      fileUriShort: toShortUri(normalizedFileUri),
      fileName: file.name,
    });

    return { ok: true };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Failed to play voice note.', {
      fileUriShort: toShortUri(normalizedFileUri),
      error,
    });
    await stopPlayingInternal();
    return {
      ok: false,
      errorMessage: toErrorMessage(error, PLAYBACK_FAILED_MESSAGE),
    };
  }
}

export async function stopPlaying(): Promise<VoiceNoteActionResult> {
  try {
    await stopPlayingInternal();
    Logger.info(SERVICE_SCOPE, 'Voice note playback stopped.', {});
    return { ok: true };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Failed to stop voice note playback.', { error });
    return {
      ok: false,
      errorMessage: toErrorMessage(error, STOP_PLAYING_FAILED_MESSAGE),
    };
  }
}

export async function deleteVoiceNote(fileUri: string): Promise<DeleteVoiceNoteResult> {
  const normalizedFileUri = normalizeRequiredText(fileUri);
  if (!normalizedFileUri) {
    return {
      ok: false,
      deleted: false,
      errorMessage: 'Voice note file uri is required.',
    };
  }

  try {
    if (normalizeOptionalText(activePlayerUri) === normalizedFileUri) {
      await stopPlayingInternal();
    }

    const file = new File(normalizedFileUri);
    if (!file.exists) {
      Logger.warn(SERVICE_SCOPE, 'deleteVoiceNote skipped because file does not exist.', {
        fileUriShort: toShortUri(normalizedFileUri),
      });
      return {
        ok: true,
        deleted: false,
      };
    }

    file.delete();
    Logger.info(SERVICE_SCOPE, 'Voice note deleted successfully.', {
      fileUriShort: toShortUri(normalizedFileUri),
    });

    return {
      ok: true,
      deleted: true,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Failed to delete voice note file.', {
      fileUriShort: toShortUri(normalizedFileUri),
      error,
    });
    return {
      ok: false,
      deleted: false,
      errorMessage: 'Voice note delete failed and was ignored.',
    };
  }
}

export async function getVoiceNoteFileInfo(fileUri: string): Promise<GetVoiceNoteFileInfoResult> {
  const normalizedFileUri = normalizeRequiredText(fileUri);
  if (!normalizedFileUri) {
    return {
      ok: false,
      info: buildEmptyVoiceNoteFileInfo(''),
      errorMessage: 'Voice note file uri is required.',
    };
  }

  try {
    const file = new File(normalizedFileUri);
    if (!file.exists) {
      return {
        ok: true,
        info: buildEmptyVoiceNoteFileInfo(normalizedFileUri),
      };
    }

    const fileInfo = file.info();
    const info: VoiceNoteFileInfo = {
      exists: fileInfo.exists,
      fileUri: normalizedFileUri,
      fileName: file.name,
      sizeBytes:
        typeof fileInfo.size === 'number' && Number.isFinite(fileInfo.size) ? fileInfo.size : null,
      createdAt: toIsoString(fileInfo.creationTime),
      updatedAt: toIsoString(fileInfo.modificationTime),
    };

    return {
      ok: true,
      info,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Failed to read voice note file info.', {
      fileUriShort: toShortUri(normalizedFileUri),
      error,
    });
    return {
      ok: false,
      info: buildEmptyVoiceNoteFileInfo(normalizedFileUri),
      errorMessage: 'Failed to read voice note file info. Please try again later.',
    };
  }
}

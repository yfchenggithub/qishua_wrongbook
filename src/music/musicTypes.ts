export const MUSIC_LOOP_MODES = ['off', 'one'] as const;

export type MusicLoopMode = (typeof MUSIC_LOOP_MODES)[number];

export type MusicTrack = {
  id: string;
  fileUri: string;
  fileName: string;
  originalFileName: string;
  mimeType: string | null;
  sizeBytes: number;
  addedAt: string;
};

export type PersistedMusicState = {
  version: 1;
  playlist: MusicTrack[];
  currentTrackId: string | null;
  loopMode: MusicLoopMode;
  enabled: boolean;
};

export type MusicActionResult =
  | { ok: true }
  | {
      ok: false;
      errorMessage: string;
    };

export type AddLocalTrackResult =
  | {
      ok: true;
      canceled: false;
      track: MusicTrack;
    }
  | {
      ok: true;
      canceled: true;
    }
  | {
      ok: false;
      canceled: false;
      errorMessage: string;
    };


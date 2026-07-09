import {
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
} from 'expo-audio';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { Logger } from '@/src/services/Logger';

import {
  deletePersistedTrack,
  loadMusicState,
  musicTrackExists,
  pickAndPersistLocalTrack,
  saveMusicState,
} from './musicStorage';
import type {
  AddLocalTrackResult,
  MusicActionResult,
  MusicLoopMode,
  MusicTrack,
  PersistedMusicState,
} from './musicTypes';

const PROVIDER_SCOPE = 'MusicProvider';

export type MusicContextValue = {
  isReady: boolean;
  playlist: MusicTrack[];
  currentTrack: MusicTrack | null;
  isPlaying: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  loopMode: MusicLoopMode;
  enabled: boolean;
  play: () => Promise<MusicActionResult>;
  pause: () => void;
  togglePlay: () => Promise<MusicActionResult>;
  next: () => Promise<MusicActionResult>;
  previous: () => Promise<MusicActionResult>;
  selectTrack: (trackId: string, autoplay?: boolean) => Promise<MusicActionResult>;
  addLocalTrack: () => Promise<AddLocalTrackResult>;
  removeTrack: (trackId: string) => Promise<MusicActionResult>;
  setLoopMode: (mode: MusicLoopMode) => void;
  setEnabled: (enabled: boolean) => void;
  seekTo: (seconds: number) => Promise<MusicActionResult>;
  pauseForInterruption: () => void;
  resumeAfterInterruption: () => Promise<void>;
};

export const MusicContext = createContext<MusicContextValue | null>(null);
export const MusicInterruptionContext = createContext<Pick<
  MusicContextValue,
  'pauseForInterruption' | 'resumeAfterInterruption'
> | null>(null);

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return fallback;
}

export function MusicProvider({ children }: PropsWithChildren) {
  const player = useAudioPlayer(null, {
    updateInterval: 250,
    keepAudioSessionActive: true,
  });
  const status = useAudioPlayerStatus(player);
  const [isReady, setIsReady] = useState(false);
  const [playlist, setPlaylist] = useState<MusicTrack[]>([]);
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);
  const [loopMode, setLoopModeState] = useState<MusicLoopMode>('one');
  const [enabled, setEnabledState] = useState(false);
  const playerTrackIdRef = useRef<string | null>(null);
  const playlistRef = useRef<MusicTrack[]>([]);
  const currentTrackIdRef = useRef<string | null>(null);
  const loopModeRef = useRef<MusicLoopMode>('one');
  const enabledRef = useRef(false);
  const statusPlayingRef = useRef(false);
  const statusDurationRef = useRef(0);
  const interruptionDepthRef = useRef(0);
  const shouldResumeAfterInterruptionRef = useRef(false);

  const currentTrack = useMemo(
    () => playlist.find((track) => track.id === currentTrackId) ?? null,
    [currentTrackId, playlist],
  );

  useEffect(() => {
    playlistRef.current = playlist;
  }, [playlist]);
  useEffect(() => {
    currentTrackIdRef.current = currentTrackId;
  }, [currentTrackId]);
  useEffect(() => {
    loopModeRef.current = loopMode;
    player.loop = loopMode === 'one';
  }, [loopMode, player]);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);
  useEffect(() => {
    statusPlayingRef.current = status.playing;
    statusDurationRef.current = status.duration;
  }, [status.duration, status.playing]);

  const persist = useCallback(
    async (overrides?: Partial<Omit<PersistedMusicState, 'version'>>) => {
      const state: PersistedMusicState = {
        version: 1,
        playlist: overrides?.playlist ?? playlistRef.current,
        currentTrackId:
          overrides && 'currentTrackId' in overrides
            ? overrides.currentTrackId ?? null
            : currentTrackIdRef.current,
        loopMode: overrides?.loopMode ?? loopModeRef.current,
        enabled: overrides?.enabled ?? enabledRef.current,
      };
      try {
        await saveMusicState(state);
      } catch (error) {
        Logger.warn(PROVIDER_SCOPE, 'Failed to persist music state.', { error });
      }
    },
    [],
  );

  const loadTrackIntoPlayer = useCallback(
    (track: MusicTrack) => {
      if (playerTrackIdRef.current === track.id) {
        return;
      }
      player.replace(track.fileUri);
      player.loop = loopModeRef.current === 'one';
      playerTrackIdRef.current = track.id;
    },
    [player],
  );

  useEffect(() => {
    let active = true;
    void loadMusicState()
      .then((state) => {
        if (!active) {
          return;
        }
        setPlaylist(state.playlist);
        setCurrentTrackId(state.currentTrackId);
        setLoopModeState(state.loopMode);
        setEnabledState(state.enabled);
        playlistRef.current = state.playlist;
        currentTrackIdRef.current = state.currentTrackId;
        loopModeRef.current = state.loopMode;
        enabledRef.current = state.enabled;
        const track =
          state.playlist.find((item) => item.id === state.currentTrackId) ?? null;
        if (track) {
          loadTrackIntoPlayer(track);
          player.pause();
          void player.seekTo(0);
        }
      })
      .catch((error) => {
        Logger.error(PROVIDER_SCOPE, 'Failed initializing music state.', { error });
      })
      .finally(() => {
        if (active) {
          setIsReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, [loadTrackIntoPlayer, player]);

  const play = useCallback(async (): Promise<MusicActionResult> => {
    const track =
      playlistRef.current.find((item) => item.id === currentTrackIdRef.current)
      ?? playlistRef.current[0]
      ?? null;
    if (!track) {
      return { ok: false, errorMessage: '请先添加一首本地歌曲。' };
    }
    if (!musicTrackExists(track)) {
      return { ok: false, errorMessage: '歌曲文件不存在，请重新添加。' };
    }
    try {
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        interruptionMode: 'doNotMix',
        shouldPlayInBackground: false,
        shouldRouteThroughEarpiece: false,
        allowsBackgroundRecording: false,
      });
      if (currentTrackIdRef.current !== track.id) {
        currentTrackIdRef.current = track.id;
        setCurrentTrackId(track.id);
      }
      loadTrackIntoPlayer(track);
      enabledRef.current = true;
      setEnabledState(true);
      player.play();
      void persist({ currentTrackId: track.id, enabled: true });
      return { ok: true };
    } catch (error) {
      Logger.error(PROVIDER_SCOPE, 'Failed to play background music.', {
        trackId: track.id,
        error,
      });
      return {
        ok: false,
        errorMessage: toErrorMessage(error, '歌曲播放失败，请重试。'),
      };
    }
  }, [loadTrackIntoPlayer, persist, player]);

  const pause = useCallback(() => {
    try {
      player.pause();
    } catch (error) {
      Logger.warn(PROVIDER_SCOPE, 'Failed to pause background music.', { error });
    }
    if (interruptionDepthRef.current > 0) {
      shouldResumeAfterInterruptionRef.current = false;
    }
  }, [player]);

  const togglePlay = useCallback(async (): Promise<MusicActionResult> => {
    if (player.playing || statusPlayingRef.current) {
      pause();
      return { ok: true };
    }
    return play();
  }, [pause, play, player]);

  const selectTrack = useCallback(
    async (trackId: string, autoplay = true): Promise<MusicActionResult> => {
      const track = playlistRef.current.find((item) => item.id === trackId) ?? null;
      if (!track) {
        return { ok: false, errorMessage: '没有找到这首歌曲。' };
      }
      if (!musicTrackExists(track)) {
        return { ok: false, errorMessage: '歌曲文件不存在，请重新添加。' };
      }
      try {
        player.pause();
        playerTrackIdRef.current = null;
        loadTrackIntoPlayer(track);
        currentTrackIdRef.current = track.id;
        setCurrentTrackId(track.id);
        await player.seekTo(0);
        void persist({ currentTrackId: track.id });
        if (autoplay) {
          return play();
        }
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          errorMessage: toErrorMessage(error, '切换歌曲失败，请重试。'),
        };
      }
    },
    [loadTrackIntoPlayer, persist, play, player],
  );

  const moveTrack = useCallback(
    async (offset: -1 | 1): Promise<MusicActionResult> => {
      const tracks = playlistRef.current;
      if (tracks.length === 0) {
        return { ok: false, errorMessage: '请先添加一首本地歌曲。' };
      }
      const currentIndex = Math.max(
        0,
        tracks.findIndex((track) => track.id === currentTrackIdRef.current),
      );
      const nextIndex = (currentIndex + offset + tracks.length) % tracks.length;
      return selectTrack(tracks[nextIndex].id, true);
    },
    [selectTrack],
  );

  const addLocalTrack = useCallback(async (): Promise<AddLocalTrackResult> => {
    const result = await pickAndPersistLocalTrack();
    if (!result.ok || result.canceled) {
      return result;
    }
    const nextPlaylist = [...playlistRef.current, result.track];
    playlistRef.current = nextPlaylist;
    setPlaylist(nextPlaylist);
    currentTrackIdRef.current = result.track.id;
    setCurrentTrackId(result.track.id);
    enabledRef.current = true;
    setEnabledState(true);
    playerTrackIdRef.current = null;
    loadTrackIntoPlayer(result.track);
    void persist({
      playlist: nextPlaylist,
      currentTrackId: result.track.id,
      enabled: true,
    });
    const playResult = await play();
    if (!playResult.ok) {
      return {
        ok: false,
        canceled: false,
        errorMessage: playResult.errorMessage,
      };
    }
    return result;
  }, [loadTrackIntoPlayer, persist, play]);

  const removeTrack = useCallback(
    async (trackId: string): Promise<MusicActionResult> => {
      const removedTrack = playlistRef.current.find((track) => track.id === trackId);
      if (!removedTrack) {
        return { ok: true };
      }
      const nextPlaylist = playlistRef.current.filter((track) => track.id !== trackId);
      const removingCurrent = currentTrackIdRef.current === trackId;
      const nextTrackId = removingCurrent
        ? nextPlaylist[0]?.id ?? null
        : currentTrackIdRef.current;
      if (removingCurrent) {
        player.pause();
        player.replace(null);
        playerTrackIdRef.current = null;
      }
      playlistRef.current = nextPlaylist;
      currentTrackIdRef.current = nextTrackId;
      setPlaylist(nextPlaylist);
      setCurrentTrackId(nextTrackId);
      if (!nextTrackId) {
        enabledRef.current = false;
        setEnabledState(false);
      }
      await deletePersistedTrack(removedTrack);
      await persist({
        playlist: nextPlaylist,
        currentTrackId: nextTrackId,
        enabled: nextTrackId ? enabledRef.current : false,
      });
      return { ok: true };
    },
    [persist, player],
  );

  const setLoopMode = useCallback(
    (mode: MusicLoopMode) => {
      loopModeRef.current = mode;
      setLoopModeState(mode);
      player.loop = mode === 'one';
      void persist({ loopMode: mode });
    },
    [persist, player],
  );

  const setEnabled = useCallback(
    (nextEnabled: boolean) => {
      enabledRef.current = nextEnabled;
      setEnabledState(nextEnabled);
      if (!nextEnabled) {
        player.pause();
        shouldResumeAfterInterruptionRef.current = false;
      }
      void persist({ enabled: nextEnabled });
    },
    [persist, player],
  );

  const seekTo = useCallback(
    async (seconds: number): Promise<MusicActionResult> => {
      const duration = statusDurationRef.current;
      const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
      const safeSeconds = Math.min(Math.max(0, seconds), safeDuration || Math.max(0, seconds));
      try {
        await player.seekTo(safeSeconds);
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          errorMessage: toErrorMessage(error, '调整播放进度失败，请重试。'),
        };
      }
    },
    [player],
  );

  const pauseForInterruption = useCallback(() => {
    if (interruptionDepthRef.current === 0) {
      shouldResumeAfterInterruptionRef.current = player.playing || statusPlayingRef.current;
      if (shouldResumeAfterInterruptionRef.current) {
        player.pause();
      }
    }
    interruptionDepthRef.current += 1;
  }, [player]);

  const resumeAfterInterruption = useCallback(async () => {
    if (interruptionDepthRef.current <= 0) {
      return;
    }
    interruptionDepthRef.current -= 1;
    if (interruptionDepthRef.current > 0) {
      return;
    }
    const shouldResume = shouldResumeAfterInterruptionRef.current;
    shouldResumeAfterInterruptionRef.current = false;
    if (shouldResume && enabledRef.current) {
      await play();
    }
  }, [play]);

  const value = useMemo<MusicContextValue>(
    () => ({
      isReady,
      playlist,
      currentTrack,
      isPlaying: status.playing,
      isBuffering: status.isBuffering,
      currentTime: status.currentTime,
      duration: status.duration,
      loopMode,
      enabled,
      play,
      pause,
      togglePlay,
      next: () => moveTrack(1),
      previous: () => moveTrack(-1),
      selectTrack,
      addLocalTrack,
      removeTrack,
      setLoopMode,
      setEnabled,
      seekTo,
      pauseForInterruption,
      resumeAfterInterruption,
    }),
    [
      addLocalTrack,
      currentTrack,
      enabled,
      isReady,
      loopMode,
      moveTrack,
      pause,
      pauseForInterruption,
      play,
      playlist,
      removeTrack,
      resumeAfterInterruption,
      seekTo,
      selectTrack,
      setEnabled,
      setLoopMode,
      status.currentTime,
      status.duration,
      status.isBuffering,
      status.playing,
      togglePlay,
    ],
  );

  const interruptionValue = useMemo(
    () => ({ pauseForInterruption, resumeAfterInterruption }),
    [pauseForInterruption, resumeAfterInterruption],
  );

  return (
    <MusicInterruptionContext.Provider value={interruptionValue}>
      <MusicContext.Provider value={value}>{children}</MusicContext.Provider>
    </MusicInterruptionContext.Provider>
  );
}

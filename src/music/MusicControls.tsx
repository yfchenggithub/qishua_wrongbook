import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type NativeTouchEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, shadows, spacing, typography } from '@/src/styles/tokens';

import type { MusicActionResult, MusicTrack } from './musicTypes';
import { useMusic } from './useMusic';

type MusicSheetProps = {
  visible: boolean;
  onClose: () => void;
};

function getTrackTitle(track: MusicTrack | null): string {
  if (!track) {
    return '未选择歌曲';
  }
  return track.originalFileName.replace(/\.[^.]+$/, '') || track.originalFileName;
}

function formatSeconds(value: number): string {
  const safeValue = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const minutes = Math.floor(safeValue / 60);
  const seconds = safeValue % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function showActionError(result: MusicActionResult): void {
  if (!result.ok) {
    Alert.alert('背景音乐', result.errorMessage);
  }
}

type ProgressBarProps = {
  currentTime: number;
  duration: number;
  onSeek: (seconds: number) => Promise<MusicActionResult>;
};

function MusicProgressBar({ currentTime, duration, onSeek }: ProgressBarProps) {
  const [trackWidth, setTrackWidth] = useState(0);
  const progress = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;

  const seekFromEvent = useCallback(
    (event: NativeSyntheticEvent<NativeTouchEvent>) => {
      if (trackWidth <= 0 || duration <= 0) {
        return;
      }
      const ratio = Math.min(1, Math.max(0, event.nativeEvent.locationX / trackWidth));
      void onSeek(duration * ratio).then(showActionError);
    },
    [duration, onSeek, trackWidth],
  );

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  }, []);

  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel="歌曲播放进度"
      accessibilityValue={{
        min: 0,
        max: Math.max(0, Math.round(duration)),
        now: Math.max(0, Math.round(currentTime)),
      }}
      onLayout={handleLayout}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={seekFromEvent}
      onResponderMove={seekFromEvent}
      style={styles.progressTouchArea}>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        <View style={[styles.progressThumb, { left: `${progress * 100}%` }]} />
      </View>
    </View>
  );
}

function ControlButton({
  icon,
  label,
  onPress,
  primary = false,
  disabled = false,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.controlButton,
        primary && styles.controlButtonPrimary,
        (pressed || disabled) && styles.controlButtonPressed,
      ]}>
      <MaterialIcons
        name={icon}
        size={primary ? 31 : 27}
        color={primary ? '#FFFFFF' : colors.textPrimary}
      />
    </Pressable>
  );
}

export function MusicEntryButton({ onPress }: { onPress: () => void }) {
  const { isPlaying } = useMusic();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isPlaying ? '打开复做背景音乐，当前正在播放' : '打开复做背景音乐'}
      onPress={onPress}
      style={({ pressed }) => [
        styles.entryButton,
        isPlaying && styles.entryButtonPlaying,
        pressed && styles.entryButtonPressed,
      ]}>
      <MaterialIcons name="music-note" size={22} color={colors.success} />
    </Pressable>
  );
}

export function MusicBottomSheet({ visible, onClose }: MusicSheetProps) {
  const insets = useSafeAreaInsets();
  const {
    playlist,
    currentTrack,
    isPlaying,
    isBuffering,
    currentTime,
    duration,
    loopMode,
    enabled,
    togglePlay,
    next,
    previous,
    addLocalTrack,
    removeTrack,
    selectTrack,
    setLoopMode,
    setEnabled,
    seekTo,
    play,
  } = useMusic();
  const [isAdding, setIsAdding] = useState(false);

  const handleAdd = useCallback(async () => {
    if (isAdding) {
      return;
    }
    setIsAdding(true);
    const result = await addLocalTrack();
    setIsAdding(false);
    if (!result.ok) {
      Alert.alert('添加本地歌曲失败', result.errorMessage);
    }
  }, [addLocalTrack, isAdding]);

  const handleEnableLocal = useCallback(async () => {
    if (playlist.length === 0) {
      await handleAdd();
      return;
    }
    setEnabled(true);
    if (!isPlaying) {
      showActionError(await play());
    }
  }, [handleAdd, isPlaying, play, playlist.length, setEnabled]);

  const handleRemoveCurrent = useCallback(() => {
    if (!currentTrack) {
      return;
    }
    Alert.alert('移除这首歌曲？', '只会删除 App 内保存的副本，不会删除手机中的原文件。', [
      { text: '取消', style: 'cancel' },
      {
        text: '移除',
        style: 'destructive',
        onPress: () => {
          void removeTrack(currentTrack.id).then(showActionError);
        },
      },
    ]);
  }, [currentTrack, removeTrack]);

  return (
    <Modal
      animationType="slide"
      transparent
      visible={visible}
      statusBarTranslucent
      onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable accessibilityLabel="关闭背景音乐面板" onPress={onClose} style={styles.backdrop} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>复做背景音乐</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="关闭"
              onPress={onClose}
              hitSlop={10}
              style={({ pressed }) => [styles.closeButton, pressed && styles.controlButtonPressed]}>
              <MaterialIcons name="close" size={27} color={colors.textPrimary} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.sheetScrollContent}
            showsVerticalScrollIndicator={false}>
            <Pressable
              onPress={() => setEnabled(false)}
              style={({ pressed }) => [
                styles.modeRow,
                !enabled && styles.modeRowSelected,
                pressed && styles.modeRowPressed,
              ]}>
              <View style={[styles.modeIcon, !enabled && styles.modeIconSelected]}>
                <MaterialIcons
                  name="music-off"
                  size={22}
                  color={!enabled ? colors.success : colors.textSecondary}
                />
              </View>
              <View style={styles.modeTextWrap}>
                <Text style={[styles.modeTitle, !enabled && styles.modeTitleSelected]}>不播放</Text>
                <Text style={styles.modeDescription}>专注刷题，不播放音乐</Text>
              </View>
              <MaterialIcons
                name={!enabled ? 'radio-button-checked' : 'radio-button-unchecked'}
                size={24}
                color={!enabled ? colors.success : '#94A3B8'}
              />
            </Pressable>

            <Pressable
              onPress={() => {
                void handleEnableLocal();
              }}
              style={({ pressed }) => [
                styles.modeRow,
                enabled && styles.modeRowSelected,
                pressed && styles.modeRowPressed,
              ]}>
              <View style={[styles.modeIcon, enabled && styles.modeIconSelected]}>
                <MaterialIcons
                  name="library-music"
                  size={22}
                  color={enabled ? colors.success : colors.textSecondary}
                />
              </View>
              <View style={styles.modeTextWrap}>
                <Text style={[styles.modeTitle, enabled && styles.modeTitleSelected]}>本地歌曲</Text>
                <Text style={styles.modeDescription}>选择本地歌曲播放</Text>
              </View>
              <MaterialIcons
                name={enabled ? 'radio-button-checked' : 'radio-button-unchecked'}
                size={24}
                color={enabled ? colors.success : '#94A3B8'}
              />
            </Pressable>

            {currentTrack ? (
              <View style={styles.nowPlayingSection}>
                <View style={styles.sectionHeadingRow}>
                  <Text style={styles.sectionHeading}>当前播放</Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={handleRemoveCurrent}
                    hitSlop={8}>
                    <Text style={styles.removeText}>移除</Text>
                  </Pressable>
                </View>

                <View style={styles.trackInfoRow}>
                  <View style={styles.coverPlaceholder}>
                    <MaterialIcons name="music-note" size={29} color={colors.success} />
                  </View>
                  <View style={styles.trackTextWrap}>
                    <Text numberOfLines={1} style={styles.trackTitle}>
                      {getTrackTitle(currentTrack)}
                    </Text>
                    <Text numberOfLines={1} style={styles.trackSubtitle}>
                      本地音频 · {playlist.length} 首
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="切换单曲循环"
                    onPress={() => setLoopMode(loopMode === 'one' ? 'off' : 'one')}
                    style={({ pressed }) => [
                      styles.loopButton,
                      loopMode === 'one' && styles.loopButtonSelected,
                      pressed && styles.modeRowPressed,
                    ]}>
                    <MaterialIcons
                      name="repeat-one"
                      size={18}
                      color={loopMode === 'one' ? colors.success : colors.textSecondary}
                    />
                    <Text
                      style={[
                        styles.loopText,
                        loopMode === 'one' && styles.loopTextSelected,
                      ]}>
                      单曲循环
                    </Text>
                  </Pressable>
                </View>

                <View style={styles.progressRow}>
                  <Text style={styles.timeText}>{formatSeconds(currentTime)}</Text>
                  <MusicProgressBar
                    currentTime={currentTime}
                    duration={duration}
                    onSeek={seekTo}
                  />
                  <Text style={styles.timeText}>{formatSeconds(duration)}</Text>
                </View>

                <View style={styles.controlsRow}>
                  <ControlButton
                    icon="skip-previous"
                    label="上一首"
                    onPress={() => {
                      void previous().then(showActionError);
                    }}
                  />
                  <ControlButton
                    primary
                    disabled={isBuffering}
                    icon={isPlaying ? 'pause' : 'play-arrow'}
                    label={isPlaying ? '暂停' : '播放'}
                    onPress={() => {
                      void togglePlay().then(showActionError);
                    }}
                  />
                  <ControlButton
                    icon="skip-next"
                    label="下一首"
                    onPress={() => {
                      void next().then(showActionError);
                    }}
                  />
                </View>

                {playlist.length > 1 ? (
                  <View style={styles.playlistSection}>
                    <Text style={styles.playlistHeading}>本地歌曲</Text>
                    {playlist.map((track) => {
                      const selected = track.id === currentTrack.id;
                      return (
                        <Pressable
                          key={track.id}
                          onPress={() => {
                            void selectTrack(track.id, true).then(showActionError);
                          }}
                          style={({ pressed }) => [
                            styles.playlistRow,
                            selected && styles.playlistRowSelected,
                            pressed && styles.modeRowPressed,
                          ]}>
                          <MaterialIcons
                            name={selected && isPlaying ? 'equalizer' : 'audiotrack'}
                            size={20}
                            color={selected ? colors.success : colors.textSecondary}
                          />
                          <Text
                            numberOfLines={1}
                            style={[styles.playlistTrackName, selected && styles.modeTitleSelected]}>
                            {getTrackTitle(track)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            ) : null}

            <Pressable
              accessibilityRole="button"
              disabled={isAdding}
              onPress={() => {
                void handleAdd();
              }}
              style={({ pressed }) => [
                styles.addButton,
                (pressed || isAdding) && styles.modeRowPressed,
              ]}>
              {isAdding ? (
                <ActivityIndicator size="small" color={colors.success} />
              ) : (
                <MaterialIcons name="add" size={22} color={colors.success} />
              )}
              <Text style={styles.addButtonText}>
                {isAdding ? '正在添加…' : '添加本地歌曲'}
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function MusicMiniPlayer({ onOpen }: { onOpen: () => void }) {
  const {
    currentTrack,
    isPlaying,
    isBuffering,
    loopMode,
    togglePlay,
    next,
    previous,
  } = useMusic();
  if (!currentTrack) {
    return null;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="打开复做背景音乐"
      onPress={onOpen}
      style={({ pressed }) => [styles.miniPlayer, pressed && styles.modeRowPressed]}>
      <View style={styles.miniCover}>
        <MaterialIcons name="music-note" size={22} color={colors.success} />
      </View>
      <View style={styles.miniTextWrap}>
        <Text numberOfLines={1} style={styles.miniTitle}>
          {getTrackTitle(currentTrack)}
        </Text>
        <Text numberOfLines={1} style={styles.miniSubtitle}>
          本地音频{loopMode === 'one' ? ' · 单曲循环' : ''}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="上一首"
        onPress={(event) => {
          event.stopPropagation();
          void previous().then(showActionError);
        }}
        hitSlop={8}
        style={styles.miniControl}>
        <MaterialIcons name="skip-previous" size={23} color={colors.textPrimary} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={isPlaying ? '暂停' : '播放'}
        disabled={isBuffering}
        onPress={(event) => {
          event.stopPropagation();
          void togglePlay().then(showActionError);
        }}
        style={({ pressed }) => [
          styles.miniPlayButton,
          (pressed || isBuffering) && styles.controlButtonPressed,
        ]}>
        {isBuffering ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <MaterialIcons
            name={isPlaying ? 'pause' : 'play-arrow'}
            size={24}
            color="#FFFFFF"
          />
        )}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="下一首"
        onPress={(event) => {
          event.stopPropagation();
          void next().then(showActionError);
        }}
        hitSlop={8}
        style={styles.miniControl}>
        <MaterialIcons name="skip-next" size={23} color={colors.textPrimary} />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  entryButton: {
    width: 43,
    height: 43,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDF5E7',
    ...shadows.card,
  },
  entryButtonPlaying: {
    backgroundColor: '#ECFDF3',
  },
  entryButtonPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.97 }],
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.38)',
  },
  sheet: {
    maxHeight: '88%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    ...shadows.card,
  },
  sheetHeader: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitle: {
    ...typography.sectionTitle,
    fontSize: 21,
    lineHeight: 29,
    color: colors.textPrimary,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetScrollContent: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  modeRow: {
    minHeight: 78,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  modeRowSelected: {
    borderColor: '#BBF7D0',
    backgroundColor: '#F0FDF4',
  },
  modeRowPressed: {
    opacity: 0.72,
  },
  modeIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
  },
  modeIconSelected: {
    backgroundColor: '#DCFCE7',
  },
  modeTextWrap: {
    flex: 1,
    gap: 3,
  },
  modeTitle: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  modeTitleSelected: {
    color: colors.success,
  },
  modeDescription: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  nowPlayingSection: {
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  sectionHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionHeading: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '800',
  },
  removeText: {
    ...typography.bodySmall,
    color: colors.danger,
    fontWeight: '600',
  },
  trackInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  coverPlaceholder: {
    width: 58,
    height: 58,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EAFBF0',
  },
  trackTextWrap: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  trackTitle: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '800',
  },
  trackSubtitle: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  loopButton: {
    minHeight: 34,
    borderRadius: 17,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    gap: 4,
  },
  loopButtonSelected: {
    backgroundColor: '#ECFDF3',
  },
  loopText: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  loopTextSelected: {
    color: colors.success,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  timeText: {
    width: 40,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  progressTouchArea: {
    flex: 1,
    height: 30,
    justifyContent: 'center',
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#DDE3EA',
  },
  progressFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.success,
  },
  progressThumb: {
    position: 'absolute',
    top: -5,
    width: 14,
    height: 14,
    marginLeft: -7,
    borderRadius: 7,
    backgroundColor: colors.success,
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xl,
  },
  controlButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlButtonPrimary: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.success,
    ...shadows.card,
  },
  controlButtonPressed: {
    opacity: 0.62,
  },
  playlistSection: {
    gap: spacing.xs,
  },
  playlistHeading: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  playlistRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
  },
  playlistRowSelected: {
    backgroundColor: '#F0FDF4',
  },
  playlistTrackName: {
    flex: 1,
    ...typography.bodySmall,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  addButton: {
    minHeight: 48,
    marginTop: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#D7DEE7',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: '#FFFFFF',
  },
  addButtonText: {
    ...typography.body,
    color: colors.success,
    fontWeight: '700',
  },
  miniPlayer: {
    minHeight: 68,
    borderRadius: radius.xl,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: '#E6F4EB',
    ...shadows.card,
  },
  miniCover: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EAFBF0',
  },
  miniTextWrap: {
    flex: 1,
    minWidth: 0,
    paddingLeft: 2,
  },
  miniTitle: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    fontWeight: '800',
  },
  miniSubtitle: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  miniControl: {
    width: 28,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniPlayButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.success,
  },
});

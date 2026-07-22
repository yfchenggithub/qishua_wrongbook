import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import type { ImageBatchProgress, LocalImage } from '@/src/models/LocalImage';
import { SurfaceCard } from '@/src/components/ui/CardContainer';
import { colors, radius, spacing, typography } from '@/src/styles/tokens';

export interface PhotoPickerSectionProps {
  images: LocalImage[];
  busy: boolean;
  emptyTitle: string;
  emptySubtitle?: string;
  icon?: keyof typeof MaterialIcons.glyphMap;
  compact?: boolean;
  processingProgress?: ImageBatchProgress | null;
  onTakePhoto: () => void;
  onPickImages: () => void;
  onDelete: (image: LocalImage) => void;
  onMove: (from: number, to: number) => void;
  onPreview?: (image: LocalImage, index: number) => void;
}

export function PhotoPickerSection({
  images,
  busy,
  emptyTitle,
  emptySubtitle = '支持多张，可调整顺序',
  icon = 'photo-camera',
  compact = false,
  processingProgress = null,
  onTakePhoto,
  onPickImages,
  onDelete,
  onMove,
  onPreview,
}: PhotoPickerSectionProps) {
  return (
    <SurfaceCard padding={0} style={[styles.container, compact && styles.containerCompact]}>
      {images.length === 0 ? (
        <View style={[styles.empty, compact && styles.emptyCompact]}>
          <MaterialIcons name={icon} size={compact ? 40 : 54} color={colors.textTertiary} />
          <Text style={styles.emptyTitle}>{emptyTitle}</Text>
          <Text style={styles.emptySubtitle}>{emptySubtitle}</Text>
        </View>
      ) : (
        <FlatList
          data={images}
          horizontal
          showsHorizontalScrollIndicator={false}
          initialNumToRender={4}
          maxToRenderPerBatch={4}
          windowSize={3}
          removeClippedSubviews
          keyExtractor={(image) => image.id}
          getItemLayout={(_data, index) => ({ length: 138, offset: 138 * index, index })}
          contentContainerStyle={styles.thumbnails}
          ItemSeparatorComponent={() => <View style={styles.thumbnailSeparator} />}
          renderItem={({ item: image, index }) => (
            <View key={image.id} style={styles.thumbnailItem}>
              <Pressable
                accessibilityLabel={`预览第 ${index + 1} 张图片`}
                disabled={!onPreview}
                onPress={() => onPreview?.(image, index)}>
                <Image
                  allowDownscaling
                  cachePolicy="memory"
                  contentFit="cover"
                  recyclingKey={image.id}
                  source={image.uri}
                  style={styles.thumbnail}
                />
                <View style={styles.orderBadge}>
                  <Text style={styles.orderText}>{index + 1}</Text>
                </View>
              </Pressable>
              <Pressable
                accessibilityLabel={`删除第 ${index + 1} 张图片`}
                disabled={busy}
                hitSlop={8}
                onPress={() => onDelete(image)}
                style={styles.deleteButton}>
                <MaterialIcons name="close" size={16} color="#FFFFFF" />
              </Pressable>
              {images.length > 1 ? (
                <View style={styles.reorderRow}>
                  <Pressable
                    accessibilityLabel={`将第 ${index + 1} 张前移`}
                    disabled={busy || index === 0}
                    onPress={() => onMove(index, index - 1)}
                    style={({ pressed }) => [styles.reorderButton, (pressed || index === 0) && styles.dimmed]}>
                    <MaterialIcons name="chevron-left" size={20} color={colors.textPrimary} />
                  </Pressable>
                  <Pressable
                    accessibilityLabel={`将第 ${index + 1} 张后移`}
                    disabled={busy || index === images.length - 1}
                    onPress={() => onMove(index, index + 1)}
                    style={({ pressed }) => [
                      styles.reorderButton,
                      (pressed || index === images.length - 1) && styles.dimmed,
                    ]}>
                    <MaterialIcons name="chevron-right" size={20} color={colors.textPrimary} />
                  </Pressable>
                </View>
              ) : null}
            </View>
          )}
          ListFooterComponent={(
            <Pressable
              accessibilityLabel="继续添加图片"
              disabled={busy}
              onPress={onTakePhoto}
              style={({ pressed }) => [styles.addMore, pressed && styles.pressed, busy && styles.dimmed]}>
              <MaterialIcons name="add-a-photo" size={28} color={colors.accent} />
              <Text style={styles.addMoreText}>继续添加</Text>
            </Pressable>
          )}
        />
      )}

      {busy && processingProgress ? (
        <View accessibilityLiveRegion="polite" style={styles.processingRow}>
          <ActivityIndicator color={colors.accent} size="small" />
          <Text style={styles.processingText}>
            正在处理 {processingProgress.completed}/{processingProgress.total} 张
          </Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onTakePhoto}
          style={({ pressed }) => [styles.action, pressed && styles.pressed, busy && styles.dimmed]}>
          <MaterialIcons name="photo-camera" size={21} color={colors.accent} />
          <Text style={[styles.actionText, styles.greenText]}>拍照</Text>
        </Pressable>
        <View style={styles.divider} />
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onPickImages}
          style={({ pressed }) => [styles.action, pressed && styles.pressed, busy && styles.dimmed]}>
          <MaterialIcons name="photo-library" size={21} color={colors.textSecondary} />
          <Text style={styles.actionText}>从相册选择</Text>
        </Pressable>
      </View>
    </SurfaceCard>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden' },
  containerCompact: { borderRadius: radius.lg },
  empty: { minHeight: 230, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  emptyCompact: { minHeight: 170 },
  emptyTitle: { ...typography.cardTitle, marginTop: spacing.xs },
  emptySubtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  thumbnails: { minHeight: 178, padding: 14, alignItems: 'flex-start' },
  thumbnailItem: { width: 126 },
  thumbnailSeparator: { width: 12 },
  thumbnail: { width: 126, height: 126, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  orderBadge: { position: 'absolute', left: 7, bottom: 7, minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(28,28,30,0.72)' },
  orderText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  deleteButton: { position: 'absolute', right: -7, top: -7, width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(28,28,30,0.82)' },
  reorderRow: { marginTop: 7, flexDirection: 'row', justifyContent: 'center', gap: 8 },
  reorderButton: { width: 44, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted },
  addMore: { width: 112, height: 126, marginLeft: 12, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.accentBorder, backgroundColor: colors.accentSoft },
  addMoreText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  processingRow: { minHeight: 42, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator, backgroundColor: colors.accentSoft },
  processingText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  actions: { minHeight: 58, flexDirection: 'row', alignItems: 'stretch', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  action: { flex: 1, minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  actionText: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
  greenText: { color: colors.accent },
  divider: { width: StyleSheet.hairlineWidth, marginVertical: 12, backgroundColor: colors.separator },
  pressed: { opacity: 0.55 },
  dimmed: { opacity: 0.35 },
});

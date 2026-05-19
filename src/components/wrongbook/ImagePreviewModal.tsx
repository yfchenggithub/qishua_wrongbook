import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/src/styles/tokens';

export interface ImagePreviewModalProps {
  visible: boolean;
  uri: string | null;
  title: string;
  onClose: () => void;
}

const DOUBLE_TAP_DELAY = 300;

function normalizeUri(uri: string | null): string | null {
  if (typeof uri !== 'string') {
    return null;
  }

  const trimmed = uri.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function ImagePreviewModal({
  visible,
  uri,
  title,
  onClose,
}: ImagePreviewModalProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const lastTapRef = useRef(0);

  const normalizedUri = useMemo(() => normalizeUri(uri), [uri]);

  useEffect(() => {
    setImageFailed(false);
  }, [normalizedUri, visible]);

  const canShowImage = visible && !!normalizedUri && !imageFailed;
  const headerTitle = title.trim().length > 0 ? title : '图片预览';

  const handleContentPress = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
      onClose();
      lastTapRef.current = 0;
      return;
    }

    lastTapRef.current = now;
  }, [onClose]);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={false}
      statusBarTranslucent
      onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.header}>
          <Text numberOfLines={1} style={styles.title}>
            {headerTitle}
          </Text>
          <Pressable accessibilityRole="button" style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonText}>关闭</Text>
          </Pressable>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="双击关闭预览"
          style={({ pressed }) => [styles.content, pressed && styles.contentPressed]}
          onPress={handleContentPress}>
          {canShowImage ? (
            <Image
              source={{ uri: normalizedUri! }}
              resizeMode="contain"
              style={styles.image}
              onError={() => setImageFailed(true)}
            />
          ) : (
            <Text style={styles.errorText}>{normalizedUri ? '图片加载失败，请返回重试' : '暂无可预览图片'}</Text>
          )}

          {canShowImage ? (
            <View pointerEvents="none" style={styles.gestureHintWrap}>
              <Text style={styles.gestureHintText}>双击关闭预览</Text>
            </View>
          ) : null}
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.black,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  header: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: {
    ...typography.sectionTitle,
    color: colors.white,
    flex: 1,
    fontSize: 18,
    lineHeight: 24,
  },
  closeButton: {
    minHeight: 36,
    minWidth: 56,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#4A4A4A',
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    ...typography.bodySmall,
    color: colors.white,
    fontWeight: '700',
  },
  content: {
    flex: 1,
    marginTop: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  contentPressed: {
    opacity: 0.96,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  errorText: {
    ...typography.body,
    color: '#D8D8D8',
    textAlign: 'center',
  },
  gestureHintWrap: {
    position: 'absolute',
    bottom: spacing.md,
    alignSelf: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    backgroundColor: 'rgba(0, 0, 0, 0.34)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  gestureHintText: {
    ...typography.caption,
    color: '#E5E7EB',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
  },
});

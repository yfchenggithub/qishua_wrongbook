import { useEffect, useMemo, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/src/styles/tokens';

export interface ImagePreviewModalProps {
  visible: boolean;
  uri: string | null;
  title: string;
  onClose: () => void;
}

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

  const normalizedUri = useMemo(() => normalizeUri(uri), [uri]);

  useEffect(() => {
    setImageFailed(false);
  }, [normalizedUri, visible]);

  const canShowImage = visible && !!normalizedUri && !imageFailed;
  const headerTitle = title.trim().length > 0 ? title : '图片预览';

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

        <View style={styles.content}>
          {canShowImage ? (
            <Image
              source={{ uri: normalizedUri! }}
              resizeMode="contain"
              style={styles.image}
              onError={() => setImageFailed(true)}
            />
          ) : (
            <Text style={styles.errorText}>
              {normalizedUri ? '图片加载失败，请返回重试' : '暂无可预览图片'}
            </Text>
          )}
        </View>
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
});

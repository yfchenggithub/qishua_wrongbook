import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { CameraView, type BarcodeScanningResult, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Logger } from '@/src/services/Logger';
import * as ReviewSheetService from '@/src/services/ReviewSheetService';
import { colors, radius, shadows, spacing, typography } from '@/src/styles/tokens';

const PAGE_SCOPE = 'ReviewSheetScanScreen';

export default function ReviewSheetScanScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [isResolving, setIsResolving] = useState(false);

  const handleBarcodeScanned = useCallback(
    async (result: BarcodeScanningResult) => {
      if (isResolving) {
        return;
      }

      const sheetId = ReviewSheetService.parseReviewSheetQrPayload(result.data);
      if (!sheetId) {
        setIsResolving(true);
        Alert.alert('扫描练习卷', '未找到这份练习卷', [
          {
            text: '继续扫描',
            onPress: () => setIsResolving(false),
          },
        ]);
        return;
      }

      setIsResolving(true);
      try {
        const sheetResult = await ReviewSheetService.getReviewSheetFillData(sheetId);
        if (sheetResult.ok) {
          router.replace(`/review-sheet/${sheetId}` as never);
          return;
        }

        Alert.alert('扫描练习卷', sheetResult.errorMessage, [
          {
            text: '继续扫描',
            onPress: () => setIsResolving(false),
          },
        ]);
      } catch (error) {
        Logger.error(PAGE_SCOPE, 'Failed to resolve scanned review sheet.', { sheetId, error });
        Alert.alert('扫描练习卷', '未找到这份练习卷', [
          {
            text: '继续扫描',
            onPress: () => setIsResolving(false),
          },
        ]);
      }
    },
    [isResolving, router],
  );

  if (!permission) {
    return (
      <SafeAreaView style={styles.pageRoot}>
        <View style={styles.centerState}>
          <ActivityIndicator size="small" color={colors.success} />
          <Text style={styles.stateText}>正在读取相机权限...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.pageRoot}>
        <View style={styles.permissionCard}>
          <View style={styles.permissionIcon}>
            <MaterialIcons name="photo-camera" size={28} color={colors.success} />
          </View>
          <Text style={styles.permissionTitle}>需要相机权限</Text>
          <Text style={styles.permissionText}>打开相机后才能扫描练习卷二维码。</Text>
          {permission.canAskAgain ? (
            <Pressable style={styles.primaryButton} onPress={() => void requestPermission()}>
              <Text style={styles.primaryButtonText}>允许相机权限</Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.secondaryButton} onPress={() => router.back()}>
            <Text style={styles.secondaryButtonText}>返回</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.pageRoot}>
      <View style={styles.headerBar}>
        <Pressable style={styles.iconButton} onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>扫描练习卷</Text>
        <View style={styles.iconButtonPlaceholder} />
      </View>

      <View style={styles.cameraWrap}>
        <CameraView
          style={styles.camera}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={isResolving ? undefined : handleBarcodeScanned}
        />
        <View pointerEvents="none" style={styles.scanFrame}>
          <View style={styles.frameCornerTopLeft} />
          <View style={styles.frameCornerTopRight} />
          <View style={styles.frameCornerBottomLeft} />
          <View style={styles.frameCornerBottomRight} />
        </View>
        {isResolving ? (
          <View style={styles.resolvingOverlay}>
            <ActivityIndicator size="small" color={colors.white} />
            <Text style={styles.resolvingText}>正在识别练习卷...</Text>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const FRAME_SIZE = 248;
const CORNER_SIZE = 34;

const styles = StyleSheet.create({
  pageRoot: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerBar: {
    minHeight: 56,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  iconButtonPlaceholder: {
    width: 40,
    height: 40,
  },
  headerTitle: {
    ...typography.sectionTitle,
    fontSize: 18,
    lineHeight: 24,
    color: colors.textPrimary,
  },
  cameraWrap: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: colors.black,
  },
  camera: {
    flex: 1,
  },
  scanFrame: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: FRAME_SIZE,
    height: FRAME_SIZE,
    marginLeft: -FRAME_SIZE / 2,
    marginTop: -FRAME_SIZE / 2,
  },
  frameCornerTopLeft: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderLeftWidth: 4,
    borderTopWidth: 4,
    borderColor: colors.success,
    borderTopLeftRadius: radius.md,
  },
  frameCornerTopRight: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderRightWidth: 4,
    borderTopWidth: 4,
    borderColor: colors.success,
    borderTopRightRadius: radius.md,
  },
  frameCornerBottomLeft: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderLeftWidth: 4,
    borderBottomWidth: 4,
    borderColor: colors.success,
    borderBottomLeftRadius: radius.md,
  },
  frameCornerBottomRight: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderRightWidth: 4,
    borderBottomWidth: 4,
    borderColor: colors.success,
    borderBottomRightRadius: radius.md,
  },
  resolvingOverlay: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.xl,
    minHeight: 48,
    borderRadius: radius.xl,
    backgroundColor: 'rgba(17, 17, 17, 0.74)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  resolvingText: {
    ...typography.body,
    color: colors.white,
    fontWeight: '700',
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  stateText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  permissionCard: {
    margin: spacing.screenPadding,
    marginTop: spacing.xxl,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.successBorder,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.md,
    ...shadows.card,
  },
  permissionIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.xl,
    backgroundColor: colors.successBg,
    borderWidth: 1,
    borderColor: colors.successBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionTitle: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
  },
  permissionText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  primaryButton: {
    width: '100%',
    minHeight: 48,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.successBorder,
    backgroundColor: colors.successBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    ...typography.body,
    color: colors.success,
    fontWeight: '800',
  },
  secondaryButton: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    ...typography.body,
    color: colors.textSecondary,
    fontWeight: '700',
  },
});

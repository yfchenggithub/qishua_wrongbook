import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Clipboard from 'expo-clipboard';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CardContainer, ScreenContainer } from '@/src/components';
import {
  APP_NAME,
  APP_BUILD_DATE,
  DATA_MODE_LABEL,
  IMAGE_COMBINER_URL,
  OFFICIAL_ACCOUNT_SEARCH_TEXT,
  SUPPORT_EMAIL,
} from '@/src/constants/app';
import { colors, radius, spacing, typography } from '@/src/styles/tokens';

const TOAST_DURATION_DEFAULT = 1800;
const TOAST_VERTICAL_OFFSET = 18;
const WX_QRCODE_IMAGE = require('../assets/images/wechat_qr_square.png');

export default function AboutSupportScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [isPreviewVisible, setIsPreviewVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTranslateY = useRef(new Animated.Value(8)).current;
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hideToast = useCallback(() => {
    Animated.parallel([
      Animated.timing(toastOpacity, {
        toValue: 0,
        duration: 140,
        useNativeDriver: true,
      }),
      Animated.timing(toastTranslateY, {
        toValue: 8,
        duration: 140,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setToastVisible(false);
    });
  }, [toastOpacity, toastTranslateY]);

  const showToast = useCallback(
    (message: string, duration = TOAST_DURATION_DEFAULT) => {
      const normalized = message.trim();
      if (!normalized) {
        return;
      }

      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }

      setToastMessage(normalized);
      setToastVisible(true);
      toastOpacity.setValue(0);
      toastTranslateY.setValue(8);

      Animated.parallel([
        Animated.timing(toastOpacity, {
          toValue: 1,
          duration: 160,
          useNativeDriver: true,
        }),
        Animated.timing(toastTranslateY, {
          toValue: 0,
          duration: 160,
          useNativeDriver: true,
        }),
      ]).start();

      toastTimerRef.current = setTimeout(() => {
        hideToast();
        toastTimerRef.current = null;
      }, duration);
    },
    [hideToast, toastOpacity, toastTranslateY],
  );

  const copyText = useCallback(
    async (value: string, successMessage: string) => {
      if (typeof Clipboard.setStringAsync !== 'function') {
        showToast('当前环境暂不支持复制');
        return;
      }

      try {
        await Clipboard.setStringAsync(value);
        showToast(successMessage);
      } catch {
        showToast('复制失败，请稍后重试');
      }
    },
    [showToast],
  );

  const handleCopyOfficialSearchText = useCallback(() => {
    void copyText(OFFICIAL_ACCOUNT_SEARCH_TEXT, '公众号搜索词已复制');
  }, [copyText]);

  const handleCopySupportEmail = useCallback(() => {
    void copyText(SUPPORT_EMAIL, '邮箱已复制');
  }, [copyText]);

  const handleCopyImageCombinerUrl = useCallback(() => {
    void copyText(IMAGE_COMBINER_URL, '图片合并网址已复制');
  }, [copyText]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  return (
    <>
      <Stack.Screen options={{ title: '关于与支持' }} />

      <ScreenContainer
        scroll
        contentStyle={styles.content}
        safeAreaEdges={['bottom']}
      >
        <CardContainer style={styles.sectionCard} padding={spacing.lg}>
          <Text style={styles.sectionTitle}>产品信息</Text>
          <Text style={styles.appName}>{APP_NAME}</Text>
          <View style={styles.infoTags}>
            <View style={styles.infoTag}>
              <Text style={styles.infoTagText}>编译 {APP_BUILD_DATE}</Text>
            </View>
            <View style={styles.infoTag}>
              <Text style={styles.infoTagText}>{DATA_MODE_LABEL}</Text>
            </View>
          </View>
          <Text style={styles.descriptionText}>
            错题数据默认保存在本机，不上传到服务器。
          </Text>
        </CardContainer>

        <CardContainer style={styles.sectionCard} padding={spacing.lg}>
          <Text style={styles.sectionTitle}>官方公众号</Text>
          <Text style={styles.descriptionText}>
            获取使用教程、打印模板、版本更新与问题反馈入口。
          </Text>

          <View style={styles.officialPanel}>
            <Pressable
              accessibilityLabel="查看公众号图片大图"
              accessibilityRole="button"
              onPress={() => setIsPreviewVisible(true)}
              style={({ pressed }) => [
                styles.qrPreviewBox,
                pressed ? styles.buttonPressed : null,
              ]}
            >
              <Image
                resizeMode="contain"
                source={WX_QRCODE_IMAGE}
                style={styles.qrPreviewImage}
              />
            </Pressable>

            <View style={styles.accountInfo}>
              <Text style={styles.accountPanelTitle}>微信搜一搜</Text>
              <View style={styles.searchPill}>
                <Text style={styles.searchPillText}>
                  {OFFICIAL_ACCOUNT_SEARCH_TEXT}
                </Text>
              </View>
              <Text style={styles.accountPanelDesc}>
                扫码或复制搜索词，在微信中搜索公众号。
              </Text>
            </View>
          </View>

          <View style={styles.actionRow}>
            <Pressable
              accessibilityRole="button"
              onPress={handleCopyOfficialSearchText}
              style={({ pressed }) => [
                styles.primaryActionButton,
                pressed ? styles.buttonPressed : null,
              ]}
            >
              <Text style={styles.primaryActionText}>复制公众号</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setIsPreviewVisible(true)}
              style={({ pressed }) => [
                styles.secondaryActionButton,
                pressed ? styles.buttonPressed : null,
              ]}
            >
              <Text style={styles.secondaryActionText}>查看大图</Text>
            </Pressable>
          </View>
        </CardContainer>

        <CardContainer style={styles.sectionCard} padding={spacing.lg}>
          <View style={styles.toolHeaderRow}>
            <View style={styles.toolIconBox}>
              <MaterialIcons color="#2563EB" name="collections" size={20} />
            </View>
            <View style={styles.toolTitleWrap}>
              <Text style={styles.sectionTitle}>多图合并成一张</Text>
              <Text style={styles.toolBadgeText}>外部网页工具</Text>
            </View>
          </View>
          <Text style={styles.descriptionText}>
            如果一道题被拍成多张图片，可以先用外部网页把图片合并成一张，再回到七刷错题本选择合并后的图片。
          </Text>

          <View style={styles.toolNoticeBox}>
            <MaterialIcons color="#64748B" name="info-outline" size={18} />
            <Text style={styles.toolNoticeText}>
              七刷错题本不会读取网页中的图片，也不会接收网页生成结果。请在浏览器中自行合并、保存后再手动导入。
            </Text>
          </View>

          <View style={styles.toolSteps}>
            <Text style={styles.toolStepText}>1. 复制网址并在浏览器打开</Text>
            <Text style={styles.toolStepText}>2. 在网页里选择多张图片并下载合并结果</Text>
            <Text style={styles.toolStepText}>3. 回到七刷错题本，选择合并后的图片</Text>
          </View>

          <Pressable
            accessibilityLabel="复制图片合并网址"
            accessibilityRole="button"
            onPress={handleCopyImageCombinerUrl}
            style={({ pressed }) => [
              styles.copyToolButton,
              pressed ? styles.buttonPressed : null,
            ]}
          >
            <MaterialIcons color="#2563EB" name="content-copy" size={18} />
            <Text style={styles.copyToolButtonText}>复制网址</Text>
          </Pressable>
        </CardContainer>

        <CardContainer style={styles.sectionCard} padding={spacing.lg}>
          <Text style={styles.sectionTitle}>问题反馈</Text>
          <Text style={styles.descriptionText}>
            用于问题反馈、隐私与商务联系。
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={handleCopySupportEmail}
            style={({ pressed }) => [
              styles.feedbackRow,
              pressed ? styles.feedbackRowPressed : null,
            ]}
          >
            <View style={styles.feedbackIconBox}>
              <MaterialIcons color="#6B7280" name="mail-outline" size={18} />
            </View>
            <Text numberOfLines={1} style={styles.feedbackEmailText}>
              {SUPPORT_EMAIL}
            </Text>
            <Text style={styles.feedbackCopyText}>复制</Text>
          </Pressable>
        </CardContainer>

        <CardContainer style={styles.sectionCard} padding={spacing.lg}>
          <Text style={styles.sectionTitle}>法律信息</Text>
          <View style={styles.legalList}>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/privacy-policy' as never)}
              style={({ pressed }) => [
                styles.legalRow,
                pressed ? styles.legalRowPressed : null,
              ]}
            >
              <Text style={styles.legalText}>隐私政策</Text>
              <MaterialIcons color="#9CA3AF" name="chevron-right" size={20} />
            </Pressable>
            <View style={styles.legalDivider} />
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/user-agreement' as never)}
              style={({ pressed }) => [
                styles.legalRow,
                pressed ? styles.legalRowPressed : null,
              ]}
            >
              <Text style={styles.legalText}>用户协议</Text>
              <MaterialIcons color="#9CA3AF" name="chevron-right" size={20} />
            </Pressable>
          </View>
        </CardContainer>
      </ScreenContainer>

      <Modal
        animationType="fade"
        onRequestClose={() => setIsPreviewVisible(false)}
        transparent
        visible={isPreviewVisible}
      >
        <View style={styles.previewLayer}>
          <Pressable
            onPress={() => setIsPreviewVisible(false)}
            style={({ pressed }) => [
              styles.previewBackdrop,
              pressed ? styles.previewBackdropPressed : null,
            ]}
          />
          <View style={styles.previewCard}>
            <Pressable
              accessibilityLabel="关闭大图"
              accessibilityRole="button"
              onPress={() => setIsPreviewVisible(false)}
              style={({ pressed }) => [
                styles.previewCloseButton,
                pressed ? styles.buttonPressed : null,
              ]}
            >
              <MaterialIcons color="#FFFFFF" name="close" size={22} />
            </Pressable>
            <Image
              resizeMode="contain"
              source={WX_QRCODE_IMAGE}
              style={styles.previewImage}
            />
            <Text style={styles.previewHintText}>
              长按图片可保存，或返回微信搜索 {OFFICIAL_ACCOUNT_SEARCH_TEXT}
            </Text>
          </View>
        </View>
      </Modal>

      {toastVisible ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.toastContainer,
            {
              bottom: Math.max(
                insets.bottom + TOAST_VERTICAL_OFFSET,
                spacing.xl,
              ),
              opacity: toastOpacity,
              transform: [{ translateY: toastTranslateY }],
            },
          ]}
        >
          <View style={styles.toastBubble}>
            <Text style={styles.toastText}>{toastMessage}</Text>
          </View>
        </Animated.View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  sectionCard: {
    borderRadius: 22,
    borderColor: '#E9EDF2',
    backgroundColor: colors.surface,
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  sectionTitle: {
    ...typography.sectionTitle,
    color: '#111827',
    fontSize: 18,
    lineHeight: 25,
  },
  appName: {
    ...typography.body,
    marginTop: spacing.sm,
    color: '#111827',
    fontWeight: '700',
    fontSize: 18,
    lineHeight: 24,
  },
  infoTags: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  infoTag: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignSelf: 'flex-start',
  },
  infoTagText: {
    ...typography.caption,
    color: '#4B5563',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  descriptionText: {
    ...typography.bodySmall,
    marginTop: spacing.sm,
    color: '#6B7280',
    lineHeight: 20,
  },
  officialPanel: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: 18,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E5EAF0',
    gap: spacing.md,
  },
  qrPreviewBox: {
    width: 96,
    height: 96,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E6EAF0',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  qrPreviewImage: {
    width: 88,
    height: 88,
  },
  accountInfo: {
    flex: 1,
    minWidth: 0,
  },
  accountPanelTitle: {
    ...typography.body,
    color: '#111827',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
  },
  searchPill: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDE3EA',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  searchPillText: {
    ...typography.bodySmall,
    color: '#1F2937',
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
  },
  accountPanelDesc: {
    ...typography.caption,
    marginTop: spacing.sm,
    color: '#6B7280',
    fontSize: 13,
    lineHeight: 18,
  },
  toolHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  toolIconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EEF6FF',
    borderWidth: 1,
    borderColor: '#D7E7FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolTitleWrap: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  toolBadgeText: {
    ...typography.caption,
    color: '#64748B',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  toolNoticeBox: {
    marginTop: spacing.md,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  toolNoticeText: {
    ...typography.caption,
    flex: 1,
    color: '#475569',
    fontSize: 13,
    lineHeight: 19,
  },
  toolSteps: {
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  toolStepText: {
    ...typography.bodySmall,
    color: '#374151',
    lineHeight: 20,
  },
  copyToolButton: {
    marginTop: spacing.md,
    minHeight: 44,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#D7E7FF',
    backgroundColor: '#EEF6FF',
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  copyToolButtonText: {
    ...typography.bodySmall,
    color: '#2563EB',
    fontSize: 13,
    fontWeight: '700',
  },
  actionRow: {
    marginTop: spacing.md,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  primaryActionButton: {
    flex: 1,
    minHeight: 41,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#D7E7FF',
    backgroundColor: '#EEF6FF',
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionButton: {
    flex: 1,
    minHeight: 41,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#DDE3EA',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionText: {
    ...typography.bodySmall,
    color: '#2563EB',
    fontSize: 13,
    fontWeight: '700',
  },
  secondaryActionText: {
    ...typography.bodySmall,
    color: '#374151',
    fontSize: 13,
    fontWeight: '600',
  },
  feedbackRow: {
    marginTop: spacing.md,
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E5EAF0',
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  feedbackRowPressed: {
    backgroundColor: '#F1F5F9',
  },
  feedbackIconBox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5EAF0',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  feedbackEmailText: {
    ...typography.body,
    flex: 1,
    minWidth: 0,
    color: '#111827',
    fontWeight: '600',
  },
  feedbackCopyText: {
    ...typography.bodySmall,
    marginLeft: spacing.sm,
    color: '#2563EB',
    fontSize: 13,
    fontWeight: '700',
  },
  legalList: {
    marginTop: spacing.md,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5EAF0',
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  legalRow: {
    minHeight: 52,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  legalRowPressed: {
    backgroundColor: '#F8FAFC',
  },
  legalText: {
    ...typography.body,
    color: '#111827',
    fontWeight: '600',
  },
  legalDivider: {
    height: 1,
    backgroundColor: '#EEF2F6',
  },
  previewLayer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
  },
  previewBackdropPressed: {
    opacity: 0.96,
  },
  previewCard: {
    width: '90%',
    maxWidth: 460,
    maxHeight: '88%',
    borderRadius: 22,
    backgroundColor: '#111827',
    paddingTop: spacing.xxl,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.2,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  previewCloseButton: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewImage: {
    width: '100%',
    height: 360,
    maxHeight: '78%',
  },
  previewHintText: {
    ...typography.caption,
    marginTop: spacing.sm,
    fontSize: 13,
    lineHeight: 18,
    color: '#CBD5E1',
    textAlign: 'center',
  },
  buttonPressed: {
    opacity: 0.86,
  },
  toastContainer: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    alignItems: 'center',
    zIndex: 10,
  },
  toastBubble: {
    maxWidth: '100%',
    borderRadius: radius.pill,
    backgroundColor: 'rgba(24, 27, 33, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  toastText: {
    ...typography.bodySmall,
    color: colors.white,
    fontWeight: '700',
    textAlign: 'center',
  },
});

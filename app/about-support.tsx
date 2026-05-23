import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as Clipboard from "expo-clipboard";
import { Stack } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CardContainer, ScreenContainer } from "@/src/components";
import {
  APP_NAME,
  APP_VERSION,
  DATA_MODE_LABEL,
  OFFICIAL_ACCOUNT_SEARCH_TEXT,
  SUPPORT_EMAIL,
} from "@/src/constants/app";
import {
  colors,
  radius,
  shadows,
  spacing,
  typography,
} from "@/src/styles/tokens";

const TOAST_DURATION_DEFAULT = 1800;
const TOAST_VERTICAL_OFFSET = 18;
const WX_QRCODE_IMAGE = require("../assets/images/wechat_qr_square.png");
const WX_IMAGE_ASSET = Image.resolveAssetSource(WX_QRCODE_IMAGE);
const WX_IMAGE_RATIO =
  WX_IMAGE_ASSET.width > 0 && WX_IMAGE_ASSET.height > 0
    ? WX_IMAGE_ASSET.width / WX_IMAGE_ASSET.height
    : 1;

export default function AboutSupportScreen() {
  const insets = useSafeAreaInsets();
  const [isPreviewVisible, setIsPreviewVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
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
      if (typeof Clipboard.setStringAsync !== "function") {
        showToast("当前环境暂不支持复制");
        return;
      }

      try {
        await Clipboard.setStringAsync(value);
        showToast(successMessage);
      } catch {
        showToast("复制失败，请稍后重试");
      }
    },
    [showToast],
  );

  const handleCopyOfficialSearchText = useCallback(() => {
    void copyText(OFFICIAL_ACCOUNT_SEARCH_TEXT, "已复制公众号搜索词");
  }, [copyText]);

  const handleCopySupportEmail = useCallback(() => {
    void copyText(SUPPORT_EMAIL, "邮箱已复制");
  }, [copyText]);

  const handleShowComingSoon = useCallback(() => {
    showToast("即将上线");
  }, [showToast]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  return (
    <>
      <Stack.Screen options={{ title: "关于与支持" }} />

      <ScreenContainer
        scroll
        contentStyle={styles.content}
        safeAreaEdges={["bottom"]}
      >
        <CardContainer style={styles.sectionCard} padding={spacing.lg}>
          <Text style={styles.sectionTitle}>产品信息</Text>
          <View style={styles.productInfoWrap}>
            <Text style={styles.appName}>{APP_NAME}</Text>
            <Text style={styles.metaText}>版本 {APP_VERSION}</Text>
            <Text style={styles.metaText}>{DATA_MODE_LABEL}</Text>
          </View>
          <Text style={styles.descriptionText}>
            你的错题数据默认保存在本机，不上传到服务器。
          </Text>
        </CardContainer>

        <CardContainer style={styles.sectionCard} padding={spacing.lg}>
          <Text style={styles.sectionTitle}>官方公众号</Text>
          <Text style={styles.descriptionText}>
            扫码或在微信搜一搜「{OFFICIAL_ACCOUNT_SEARCH_TEXT}
            」，获取使用教程、打印模板、版本更新与问题反馈入口。
          </Text>

          <Pressable
            accessibilityLabel="查看公众号引导图大图"
            accessibilityRole="button"
            onPress={() => setIsPreviewVisible(true)}
            style={({ pressed }) => [
              styles.accountImageWrap,
              pressed ? styles.accountImageWrapPressed : null,
            ]}
          >
            <Image
              resizeMode="contain"
              source={WX_QRCODE_IMAGE}
              style={[styles.accountImage, { aspectRatio: WX_IMAGE_RATIO }]}
            />
          </Pressable>

          <View style={styles.sectionActions}>
            <Pressable
              accessibilityRole="button"
              onPress={handleCopyOfficialSearchText}
              style={({ pressed }) => [
                styles.copyButton,
                pressed ? styles.copyButtonPressed : null,
              ]}
            >
              <Text style={styles.copyButtonText}>复制搜索词</Text>
            </Pressable>
          </View>
        </CardContainer>

        <CardContainer style={styles.sectionCard} padding={spacing.lg}>
          <Text style={styles.sectionTitle}>问题反馈</Text>
          <Pressable
            accessibilityRole="button"
            onPress={handleCopySupportEmail}
            style={({ pressed }) => [
              styles.emailPressable,
              pressed ? styles.emailPressed : null,
            ]}
          >
            <Text style={styles.emailText}>反馈邮箱：{SUPPORT_EMAIL}</Text>
          </Pressable>
          <Text style={styles.descriptionText}>
            用于问题反馈、隐私与商务联系。
          </Text>
          <View style={styles.sectionActions}>
            <Pressable
              accessibilityRole="button"
              onPress={handleCopySupportEmail}
              style={({ pressed }) => [
                styles.copyButton,
                pressed ? styles.copyButtonPressed : null,
              ]}
            >
              <Text style={styles.copyButtonText}>复制邮箱</Text>
            </Pressable>
          </View>
        </CardContainer>

        <CardContainer style={styles.sectionCard} padding={spacing.lg}>
          <Text style={styles.sectionTitle}>法律信息</Text>
          <View style={styles.legalList}>
            <Pressable
              accessibilityRole="button"
              onPress={handleShowComingSoon}
              style={({ pressed }) => [
                styles.legalRow,
                pressed ? styles.legalRowPressed : null,
              ]}
            >
              <Text style={styles.legalText}>隐私政策</Text>
              <MaterialIcons color="#9BA1AA" name="chevron-right" size={20} />
            </Pressable>
            <View style={styles.legalDivider} />
            <Pressable
              accessibilityRole="button"
              onPress={handleShowComingSoon}
              style={({ pressed }) => [
                styles.legalRow,
                pressed ? styles.legalRowPressed : null,
              ]}
            >
              <Text style={styles.legalText}>用户协议</Text>
              <MaterialIcons color="#9BA1AA" name="chevron-right" size={20} />
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
            style={styles.previewBackdrop}
            onPress={() => setIsPreviewVisible(false)}
          />
          <View style={styles.previewCard}>
            <Pressable
              accessibilityLabel="关闭大图"
              accessibilityRole="button"
              onPress={() => setIsPreviewVisible(false)}
              style={styles.previewCloseButton}
            >
              <MaterialIcons color="#FFFFFF" name="close" size={22} />
            </Pressable>
            <Image
              resizeMode="contain"
              source={WX_QRCODE_IMAGE}
              style={[styles.previewImage, { aspectRatio: WX_IMAGE_RATIO }]}
            />
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
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  sectionCard: {
    borderRadius: 22,
    borderColor: "#E9EBEE",
    backgroundColor: colors.surface,
    shadowColor: "#0F172A",
    shadowOpacity: 0.05,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  sectionTitle: {
    ...typography.sectionTitle,
    fontSize: 19,
    lineHeight: 26,
  },
  productInfoWrap: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  appName: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: "700",
    fontSize: 17,
    lineHeight: 23,
  },
  metaText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  descriptionText: {
    ...typography.bodySmall,
    marginTop: spacing.sm,
    color: "#6C737E",
    lineHeight: 21,
  },
  accountImageWrap: {
    marginTop: spacing.md,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E8EBEF",
    backgroundColor: "#FAFBFC",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  accountImageWrapPressed: {
    opacity: 0.92,
  },
  accountImage: {
    width: "100%",
    maxWidth: 420,
  },
  sectionActions: {
    marginTop: spacing.md,
    alignItems: "flex-start",
  },
  copyButton: {
    minHeight: 42,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "#CCD5E0",
    backgroundColor: "#F5F8FC",
    paddingHorizontal: spacing.md,
    justifyContent: "center",
    alignItems: "center",
  },
  copyButtonPressed: {
    opacity: 0.88,
  },
  copyButtonText: {
    ...typography.bodySmall,
    color: "#2E4F83",
    fontWeight: "700",
  },
  emailPressable: {
    marginTop: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: "#F9FBFD",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignSelf: "flex-start",
  },
  emailPressed: {
    opacity: 0.9,
  },
  emailText: {
    ...typography.body,
    color: "#244E86",
    fontWeight: "600",
  },
  legalList: {
    marginTop: spacing.sm,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#ECEFF2",
    overflow: "hidden",
  },
  legalRow: {
    minHeight: 50,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  legalRowPressed: {
    backgroundColor: "#F8FAFC",
  },
  legalText: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: "600",
  },
  legalDivider: {
    height: 1,
    backgroundColor: "#ECEFF2",
  },
  previewLayer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  previewBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.66)",
  },
  previewCard: {
    width: "92%",
    borderRadius: 22,
    backgroundColor: "#0E1116",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    paddingTop: spacing.xxl,
    alignItems: "center",
    ...shadows.floating,
  },
  previewCloseButton: {
    position: "absolute",
    top: spacing.sm,
    right: spacing.sm,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255, 255, 255, 0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  previewImage: {
    width: "100%",
    maxHeight: "80%",
  },
  toastContainer: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    alignItems: "center",
    zIndex: 10,
  },
  toastBubble: {
    maxWidth: "100%",
    borderRadius: radius.pill,
    backgroundColor: "rgba(24, 27, 33, 0.94)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  toastText: {
    ...typography.bodySmall,
    color: colors.white,
    fontWeight: "700",
    textAlign: "center",
  },
});

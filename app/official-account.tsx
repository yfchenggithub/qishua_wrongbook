import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useCallback, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppToast, PrimaryButton, SupportPage } from '@/src/components';
import { OFFICIAL_ACCOUNT_SEARCH_TEXT } from '@/src/constants/app';
import { useAppToast } from '@/src/hooks/useAppToast';
import {
  aboutSupportCardShadow,
  aboutSupportColors,
  aboutSupportLayout,
  aboutSupportTypography,
} from '@/src/styles/aboutSupportTokens';
import { copySupportText } from '@/src/utils/supportActions';

const WECHAT_QR_CODE = require('../assets/images/wechat_qr_square.png');

export default function OfficialAccountScreen() {
  const insets = useSafeAreaInsets();
  const [previewVisible, setPreviewVisible] = useState(false);
  const { props: toastProps, showToast } = useAppToast();

  const copyAccount = useCallback(() => {
    void copySupportText(OFFICIAL_ACCOUNT_SEARCH_TEXT, '公众号已复制', showToast);
  }, [showToast]);

  return (
    <>
      <SupportPage
        contentStyle={styles.content}
        fallbackRoute="/about-support"
        overlay={<AppToast {...toastProps} bottomOffset={Math.max(insets.bottom + 18, 28)} />}
        title="官方公众号">
        <View style={styles.hero}>
          <MaterialIcons color={aboutSupportColors.wechat} name="forum" size={66} />
          <Text style={styles.heroTitle}>关注官方公众号</Text>
          <Text style={styles.heroDescription}>获取使用教程、打印模板与版本更新</Text>
        </View>

        <View style={styles.qrCard}>
          <Pressable
            accessibilityLabel="查看公众号二维码大图"
            accessibilityRole="button"
            onPress={() => setPreviewVisible(true)}
            style={({ pressed }) => [styles.qrTouch, pressed ? styles.pressed : null]}>
            <Image resizeMode="contain" source={WECHAT_QR_CODE} style={styles.qrImage} />
          </Pressable>
          <Text style={styles.scanText}>微信扫一扫</Text>
          <View style={styles.accountPill}>
            <Text style={styles.accountText}>{OFFICIAL_ACCOUNT_SEARCH_TEXT}</Text>
          </View>
        </View>

        <View style={styles.actions}>
          <PrimaryButton onPress={copyAccount} title="复制公众号" tone="blue" />
          <Pressable
            accessibilityRole="button"
            onPress={() => setPreviewVisible(true)}
            style={({ pressed }) => [styles.previewButton, pressed ? styles.pressed : null]}>
            <Text style={styles.previewButtonText}>查看二维码大图</Text>
          </Pressable>
          <View style={styles.searchHint}>
            <MaterialIcons color={aboutSupportColors.secondaryText} name="search" size={22} />
            <Text style={styles.searchHintText}>
              也可以在微信中搜索 {OFFICIAL_ACCOUNT_SEARCH_TEXT}
            </Text>
          </View>
        </View>
      </SupportPage>

      <Modal
        animationType="fade"
        onRequestClose={() => setPreviewVisible(false)}
        statusBarTranslucent
        transparent
        visible={previewVisible}>
        <View style={styles.previewLayer}>
          <Pressable
            accessibilityLabel="关闭二维码大图"
            accessibilityRole="button"
            onPress={() => setPreviewVisible(false)}
            style={[styles.previewClose, { top: insets.top + 12 }]}>
            <MaterialIcons color="#FFFFFF" name="close" size={28} />
          </Pressable>
          <Image resizeMode="contain" source={WECHAT_QR_CODE} style={styles.previewImage} />
          <Text style={styles.previewCaption}>{OFFICIAL_ACCOUNT_SEARCH_TEXT}</Text>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: 24,
  },
  hero: {
    alignItems: 'center',
    marginBottom: 30,
  },
  heroTitle: {
    ...aboutSupportTypography.pageTitle,
    marginTop: 18,
    textAlign: 'center',
  },
  heroDescription: {
    ...aboutSupportTypography.body,
    marginTop: 9,
    textAlign: 'center',
  },
  qrCard: {
    ...aboutSupportCardShadow,
    borderRadius: aboutSupportLayout.cardRadius,
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 24,
    alignItems: 'center',
    backgroundColor: aboutSupportColors.card,
  },
  qrTouch: {
    width: 228,
    height: 228,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrImage: {
    width: 220,
    height: 220,
  },
  scanText: {
    ...aboutSupportTypography.supporting,
    marginTop: 8,
    color: aboutSupportColors.tertiaryText,
  },
  accountPill: {
    minHeight: 40,
    minWidth: 136,
    marginTop: 12,
    borderRadius: 12,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F1F3',
  },
  accountText: {
    color: aboutSupportColors.text,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '500',
  },
  actions: {
    marginTop: 30,
  },
  previewButton: {
    minHeight: aboutSupportLayout.touchSize,
    marginTop: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewButtonText: {
    ...aboutSupportTypography.body,
    color: aboutSupportColors.blue,
    fontWeight: '500',
  },
  searchHint: {
    minHeight: 48,
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  searchHintText: {
    ...aboutSupportTypography.supporting,
    flexShrink: 1,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.65,
  },
  previewLayer: {
    flex: 1,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: aboutSupportColors.modalBackdrop,
  },
  previewClose: {
    position: 'absolute',
    right: 18,
    zIndex: 1,
    width: aboutSupportLayout.touchSize,
    height: aboutSupportLayout.touchSize,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
  },
  previewImage: {
    width: '92%',
    maxWidth: 520,
    aspectRatio: 1,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
  },
  previewCaption: {
    marginTop: 20,
    color: '#FFFFFF',
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
  },
});

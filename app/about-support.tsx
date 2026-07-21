import { useRouter } from 'expo-router';
import { useCallback, useRef } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AppToast,
  InsetGroup,
  PrivacyNotice,
  SectionLabel,
  SettingRow,
  SupportPage,
} from '@/src/components';
import {
  APP_NAME,
  APP_VERSION,
  DATA_MODE_LABEL,
  OFFICIAL_ACCOUNT_SEARCH_TEXT,
} from '@/src/constants/app';
import { useAppToast } from '@/src/hooks/useAppToast';
import {
  aboutSupportColors,
  aboutSupportLayout,
  aboutSupportTypography,
} from '@/src/styles/aboutSupportTokens';

const APP_ICON = require('../assets/images/icon.png');
const NAVIGATION_DEBOUNCE_MS = 600;

type SupportRoute =
  | '/official-account'
  | '/image-combiner'
  | '/feedback'
  | '/privacy-policy'
  | '/user-agreement';

export default function AboutSupportScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const lastNavigationAtRef = useRef(0);
  const { props: toastProps } = useAppToast();

  const navigateTo = useCallback(
    (route: SupportRoute) => {
      const now = Date.now();
      if (now - lastNavigationAtRef.current < NAVIGATION_DEBOUNCE_MS) {
        return;
      }
      lastNavigationAtRef.current = now;
      router.push(route as never);
    },
    [router],
  );

  return (
    <SupportPage
      contentStyle={styles.content}
      fallbackRoute="/(tabs)/settings"
      overlay={<AppToast {...toastProps} bottomOffset={Math.max(insets.bottom + 18, 28)} />}
      title="关于与支持">
      <View style={styles.productSection}>
        <Image accessibilityLabel="七刷错题本图标" source={APP_ICON} style={styles.appIcon} />
        <Text style={styles.appName}>{APP_NAME}</Text>
        <Text style={styles.version}>版本 {APP_VERSION}</Text>
        <PrivacyNotice style={styles.localPill} text="数据仅保存在本机" tone="green" />
      </View>

      <View style={styles.section}>
        <SectionLabel>支持</SectionLabel>
        <InsetGroup dividerInset={76}>
          <SettingRow
            icon="forum"
            iconColor={aboutSupportColors.wechat}
            onPress={() => navigateTo('/official-account')}
            rightLabel={OFFICIAL_ACCOUNT_SEARCH_TEXT}
            subtitle="教程、打印模板与版本更新"
            title="官方公众号"
          />
          <SettingRow
            icon="collections"
            iconColor={aboutSupportColors.image}
            onPress={() => navigateTo('/image-combiner')}
            rightLabel="外部工具"
            subtitle="将多张题图合成为一张"
            title="多图合并"
          />
          <SettingRow
            icon="mail-outline"
            iconColor={aboutSupportColors.mail}
            onPress={() => navigateTo('/feedback')}
            subtitle="问题、隐私与商务联系"
            title="问题反馈"
          />
        </InsetGroup>
      </View>

      <View style={styles.section}>
        <SectionLabel>法律</SectionLabel>
        <InsetGroup>
          <SettingRow onPress={() => navigateTo('/privacy-policy')} title="隐私政策" />
          <SettingRow onPress={() => navigateTo('/user-agreement')} title="用户协议" />
        </InsetGroup>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>{APP_NAME} · {DATA_MODE_LABEL}</Text>
      </View>

    </SupportPage>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: 18,
  },
  productSection: {
    alignItems: 'center',
    marginBottom: 44,
  },
  appIcon: {
    width: 96,
    height: 96,
    borderRadius: 22,
    marginBottom: 16,
  },
  appName: {
    ...aboutSupportTypography.pageTitle,
    fontSize: 28,
    lineHeight: 35,
  },
  version: {
    ...aboutSupportTypography.body,
    marginTop: 8,
  },
  localPill: {
    minHeight: 38,
    marginTop: 16,
    paddingHorizontal: 14,
  },
  section: {
    marginBottom: 30,
  },
  footer: {
    minHeight: aboutSupportLayout.touchSize,
    marginTop: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  footerText: {
    ...aboutSupportTypography.supporting,
    color: aboutSupportColors.tertiaryText,
  },
});

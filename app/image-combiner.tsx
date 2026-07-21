import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppToast, PrimaryButton, PrivacyNotice, SupportPage } from '@/src/components';
import { IMAGE_COMBINER_URL } from '@/src/constants/app';
import { useAppToast } from '@/src/hooks/useAppToast';
import {
  aboutSupportCardShadow,
  aboutSupportColors,
  aboutSupportLayout,
  aboutSupportTypography,
} from '@/src/styles/aboutSupportTokens';
import { copySupportText } from '@/src/utils/supportActions';

const STEPS = [
  { title: '复制网址', description: '复制合图工具的网址' },
  { title: '浏览器打开', description: '在浏览器中选择多张图片并合成' },
  { title: '返回七刷', description: '保存图片后，回到七刷错题本导入' },
] as const;

export default function ImageCombinerScreen() {
  const insets = useSafeAreaInsets();
  const { props: toastProps, showToast } = useAppToast();

  const copyUrl = useCallback(() => {
    void copySupportText(IMAGE_COMBINER_URL, '网址已复制', showToast);
  }, [showToast]);

  return (
    <SupportPage
      contentStyle={styles.content}
      fallbackRoute="/about-support"
      overlay={<AppToast {...toastProps} bottomOffset={Math.max(insets.bottom + 18, 28)} />}
      title="多图合并">
      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <MaterialIcons color={aboutSupportColors.image} name="collections" size={54} />
        </View>
        <View style={styles.heroText}>
          <Text style={styles.heroTitle}>将多张题图合成一张</Text>
          <Text style={styles.heroDescription}>外部网页工具</Text>
        </View>
      </View>

      <View style={styles.stepsCard}>
        {STEPS.map((step, index) => (
          <View key={step.title} style={styles.stepRow}>
            <View style={styles.markerColumn}>
              <View style={styles.marker}>
                <Text style={styles.markerText}>{index + 1}</Text>
              </View>
              {index < STEPS.length - 1 ? <View style={styles.stepLine} /> : null}
            </View>
            <View style={[styles.stepText, index === STEPS.length - 1 ? styles.lastStepText : null]}>
              <Text style={styles.stepTitle}>{step.title}</Text>
              <Text style={styles.stepDescription}>{step.description}</Text>
            </View>
          </View>
        ))}

        <PrivacyNotice
          style={styles.privacyNotice}
          text="网页中的图片不会被七刷错题本读取或上传"
        />
      </View>

      <View style={styles.actions}>
        <PrimaryButton onPress={copyUrl} title="复制网址" tone="blue" />
        <Text style={styles.actionHint}>复制后请在浏览器中打开</Text>
      </View>
    </SupportPage>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: 28,
  },
  hero: {
    minHeight: 92,
    marginBottom: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  heroIcon: {
    width: 68,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroText: {
    flex: 1,
    minWidth: 0,
    gap: 8,
  },
  heroTitle: {
    ...aboutSupportTypography.pageTitle,
    fontSize: 25,
    lineHeight: 32,
  },
  heroDescription: {
    ...aboutSupportTypography.body,
    fontSize: 17,
  },
  stepsCard: {
    ...aboutSupportCardShadow,
    borderRadius: aboutSupportLayout.cardRadius,
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 20,
    backgroundColor: aboutSupportColors.card,
  },
  stepRow: {
    minHeight: 112,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 18,
  },
  markerColumn: {
    width: 44,
    alignItems: 'center',
  },
  marker: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: aboutSupportColors.blue,
  },
  markerText: {
    color: '#FFFFFF',
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '600',
  },
  stepLine: {
    width: 2,
    flex: 1,
    marginTop: 8,
    marginBottom: 8,
    backgroundColor: aboutSupportColors.separator,
  },
  stepText: {
    flex: 1,
    minWidth: 0,
    paddingTop: 4,
    paddingBottom: 30,
  },
  lastStepText: {
    paddingBottom: 22,
  },
  stepTitle: {
    ...aboutSupportTypography.rowTitle,
    fontSize: 19,
    lineHeight: 25,
  },
  stepDescription: {
    ...aboutSupportTypography.supporting,
    marginTop: 8,
    fontSize: 15,
    lineHeight: 22,
  },
  privacyNotice: {
    marginTop: 2,
  },
  actions: {
    marginTop: 'auto',
    paddingTop: 40,
  },
  actionHint: {
    ...aboutSupportTypography.supporting,
    minHeight: aboutSupportLayout.touchSize,
    paddingTop: 12,
    textAlign: 'center',
  },
});

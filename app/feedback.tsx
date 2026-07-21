import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as MailComposer from 'expo-mail-composer';
import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppToast, PrimaryButton, PrivacyNotice, SectionLabel, SupportPage } from '@/src/components';
import { APP_NAME, APP_VERSION, SUPPORT_EMAIL } from '@/src/constants/app';
import { useAppToast } from '@/src/hooks/useAppToast';
import type { PickedImageAsset } from '@/src/models/LocalImage';
import { pickImagesFromLibrary } from '@/src/services/ImagePickerService';
import {
  aboutSupportCardShadow,
  aboutSupportColors,
  aboutSupportLayout,
  aboutSupportTypography,
} from '@/src/styles/aboutSupportTokens';
import { copySupportText } from '@/src/utils/supportActions';

const MAX_DESCRIPTION_LENGTH = 500;
const MAX_SCREENSHOTS = 3;

const FEEDBACK_TYPES = ['功能问题', '使用建议', '隐私与商务'] as const;
type FeedbackType = (typeof FEEDBACK_TYPES)[number];

function buildMailBody(type: FeedbackType, description: string): string {
  return [
    `反馈类型：${type}`,
    '',
    '问题描述：',
    description,
    '',
    `App：${APP_NAME}`,
    `App 版本：${APP_VERSION}`,
    `系统平台：${Platform.OS} ${String(Platform.Version)}`,
  ].join('\n');
}

export default function FeedbackScreen() {
  const insets = useSafeAreaInsets();
  const [feedbackType, setFeedbackType] = useState<FeedbackType>('功能问题');
  const [description, setDescription] = useState('');
  const [screenshots, setScreenshots] = useState<PickedImageAsset[]>([]);
  const [isOpeningMail, setIsOpeningMail] = useState(false);
  const { props: toastProps, showToast } = useAppToast();

  const canOpenMail = description.trim().length > 0 && !isOpeningMail;
  const screenshotCountLabel = useMemo(
    () => screenshots.length === 0 ? '最多 3 张' : `已选择 ${screenshots.length}/3 张`,
    [screenshots.length],
  );

  const copyEmail = useCallback(() => {
    void copySupportText(SUPPORT_EMAIL, '邮箱已复制', showToast);
  }, [showToast]);

  const showMailUnavailableAlert = useCallback(() => {
    Alert.alert(
      '未找到可用邮箱应用',
      `请先配置系统邮箱，或复制邮箱地址后手动联系：\n${SUPPORT_EMAIL}`,
      [
        { text: '取消', style: 'cancel' },
        { text: '复制邮箱', onPress: copyEmail },
      ],
    );
  }, [copyEmail]);

  const addScreenshots = useCallback(async () => {
    const remaining = MAX_SCREENSHOTS - screenshots.length;
    if (remaining <= 0) {
      showToast('最多只能添加 3 张截图', 'info');
      return;
    }

    const result = await pickImagesFromLibrary(remaining);
    if (result.canceled) {
      if (result.errorMessage) {
        showToast('无法读取图片，请检查相册权限', 'error');
      }
      return;
    }

    const nextAssets = result.assets ?? [];
    setScreenshots((current) => {
      const currentUris = new Set(current.map((asset) => asset.tempUri));
      const uniqueNext = nextAssets.filter((asset) => !currentUris.has(asset.tempUri));
      return [...current, ...uniqueNext].slice(0, MAX_SCREENSHOTS);
    });
  }, [screenshots.length, showToast]);

  const removeScreenshot = useCallback((uri: string) => {
    setScreenshots((current) => current.filter((asset) => asset.tempUri !== uri));
  }, []);

  const openSystemMail = useCallback(async () => {
    const normalizedDescription = description.trim();
    if (!normalizedDescription) {
      showToast('请先填写问题描述', 'info');
      return;
    }

    setIsOpeningMail(true);
    try {
      const available = await MailComposer.isAvailableAsync();
      if (!available) {
        showMailUnavailableAlert();
        return;
      }

      await MailComposer.composeAsync({
        recipients: [SUPPORT_EMAIL],
        subject: `[${APP_NAME}][${feedbackType}]`,
        body: buildMailBody(feedbackType, normalizedDescription),
        attachments: screenshots.map((asset) => asset.tempUri),
      });
    } catch {
      showMailUnavailableAlert();
    } finally {
      setIsOpeningMail(false);
    }
  }, [description, feedbackType, screenshots, showMailUnavailableAlert, showToast]);

  return (
    <SupportPage
      contentStyle={styles.content}
      fallbackRoute="/about-support"
      keyboardAware
      overlay={<AppToast {...toastProps} bottomOffset={Math.max(insets.bottom + 18, 28)} />}
      title="问题反馈">
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>告诉我们遇到了什么</Text>
        <Text style={styles.heroDescription}>你的反馈会帮助七刷变得更好</Text>
      </View>

      <View style={styles.section}>
        <SectionLabel>反馈类型</SectionLabel>
        <View style={styles.typeCard}>
          {FEEDBACK_TYPES.map((type) => {
            const selected = type === feedbackType;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                key={type}
                onPress={() => setFeedbackType(type)}
                style={({ pressed }) => [
                  styles.typeButton,
                  selected ? styles.typeButtonSelected : null,
                  pressed ? styles.pressed : null,
                ]}>
                <Text
                  numberOfLines={1}
                  style={[styles.typeText, selected ? styles.typeTextSelected : null]}>
                  {type}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        <SectionLabel>问题描述</SectionLabel>
        <View style={styles.inputCard}>
          <TextInput
            accessibilityLabel="问题描述"
            maxLength={MAX_DESCRIPTION_LENGTH}
            multiline
            onChangeText={setDescription}
            placeholder="请描述问题发生的场景…"
            placeholderTextColor={aboutSupportColors.tertiaryText}
            style={styles.input}
            textAlignVertical="top"
            value={description}
          />
          <Text style={styles.counter}>{description.length}/{MAX_DESCRIPTION_LENGTH}</Text>
        </View>
      </View>

      <View style={styles.screenshotCard}>
        <Pressable
          accessibilityRole="button"
          onPress={() => { void addScreenshots(); }}
          style={({ pressed }) => [styles.screenshotEntry, pressed ? styles.pressed : null]}>
          <MaterialIcons color={aboutSupportColors.image} name="add-photo-alternate" size={31} />
          <View style={styles.screenshotEntryText}>
            <Text style={styles.screenshotTitle}>添加截图</Text>
            <Text style={styles.screenshotSubtitle}>{screenshotCountLabel}</Text>
          </View>
          <MaterialIcons color={aboutSupportColors.secondaryText} name="add" size={30} />
        </Pressable>

        {screenshots.length > 0 ? (
          <View style={styles.thumbnails}>
            {screenshots.map((asset, index) => (
              <View key={asset.tempUri} style={styles.thumbnailWrap}>
                <Image source={{ uri: asset.tempUri }} style={styles.thumbnail} />
                <Pressable
                  accessibilityLabel={`移除第 ${index + 1} 张截图`}
                  accessibilityRole="button"
                  hitSlop={4}
                  onPress={() => removeScreenshot(asset.tempUri)}
                  style={({ pressed }) => [
                    styles.removeButton,
                    pressed ? styles.removeButtonPressed : null,
                  ]}>
                  <MaterialIcons color="#FFFFFF" name="close" size={18} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <PrivacyNotice
        style={styles.privacyNotice}
        text="内容仅在你确认后交给系统邮箱发送"
      />

      <View style={styles.actions}>
        <PrimaryButton
          disabled={!canOpenMail}
          onPress={() => { void openSystemMail(); }}
          title={isOpeningMail ? '正在打开…' : '打开系统邮箱'}
          tone="blue"
        />
        <View style={styles.contactRow}>
          <Text style={styles.contactLabel}>联系邮箱</Text>
          <Text numberOfLines={1} style={styles.contactEmail}>{SUPPORT_EMAIL}</Text>
          <Pressable
            accessibilityLabel="复制联系邮箱"
            accessibilityRole="button"
            onPress={copyEmail}
            style={({ pressed }) => [styles.copyEmailButton, pressed ? styles.pressed : null]}>
            <Text style={styles.copyEmailText}>复制</Text>
          </Pressable>
        </View>
      </View>
    </SupportPage>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: 28,
  },
  hero: {
    marginBottom: 34,
  },
  heroTitle: {
    ...aboutSupportTypography.pageTitle,
  },
  heroDescription: {
    ...aboutSupportTypography.body,
    marginTop: 8,
  },
  section: {
    marginBottom: 24,
  },
  typeCard: {
    ...aboutSupportCardShadow,
    borderRadius: aboutSupportLayout.cardRadius,
    padding: 12,
    flexDirection: 'row',
    gap: 8,
    backgroundColor: aboutSupportColors.card,
  },
  typeButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 46,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: aboutSupportColors.separator,
    borderRadius: 12,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: aboutSupportColors.card,
  },
  typeButtonSelected: {
    borderWidth: 1,
    borderColor: '#9BC9FF',
    backgroundColor: aboutSupportColors.blueSoft,
  },
  typeText: {
    color: aboutSupportColors.secondaryText,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  typeTextSelected: {
    color: aboutSupportColors.blue,
    fontWeight: '600',
  },
  inputCard: {
    ...aboutSupportCardShadow,
    height: 210,
    borderRadius: aboutSupportLayout.cardRadius,
    padding: 16,
    backgroundColor: aboutSupportColors.card,
  },
  input: {
    flex: 1,
    padding: 0,
    paddingBottom: 28,
    color: aboutSupportColors.text,
    fontSize: 16,
    lineHeight: 23,
  },
  counter: {
    position: 'absolute',
    right: 16,
    bottom: 14,
    ...aboutSupportTypography.supporting,
    color: aboutSupportColors.tertiaryText,
  },
  screenshotCard: {
    ...aboutSupportCardShadow,
    borderRadius: aboutSupportLayout.cardRadius,
    marginBottom: 22,
    backgroundColor: aboutSupportColors.card,
  },
  screenshotEntry: {
    minHeight: 76,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: aboutSupportLayout.cardRadius,
  },
  screenshotEntryText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  screenshotTitle: {
    ...aboutSupportTypography.rowTitle,
  },
  screenshotSubtitle: {
    ...aboutSupportTypography.supporting,
  },
  thumbnails: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: aboutSupportColors.separator,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 18,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  thumbnailWrap: {
    width: 78,
    height: 78,
  },
  thumbnail: {
    width: 78,
    height: 78,
    borderRadius: 12,
    backgroundColor: aboutSupportColors.neutralNoticeBackground,
  },
  removeButton: {
    position: 'absolute',
    top: -10,
    right: -10,
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: aboutSupportColors.card,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(29, 29, 31, 0.78)',
  },
  removeButtonPressed: {
    opacity: 0.6,
  },
  privacyNotice: {
    alignSelf: 'center',
    backgroundColor: 'transparent',
  },
  actions: {
    marginTop: 'auto',
    paddingTop: 34,
  },
  contactRow: {
    minHeight: aboutSupportLayout.touchSize,
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactLabel: {
    ...aboutSupportTypography.supporting,
    marginRight: 10,
  },
  contactEmail: {
    ...aboutSupportTypography.supporting,
    flexShrink: 1,
  },
  copyEmailButton: {
    minWidth: aboutSupportLayout.touchSize,
    minHeight: aboutSupportLayout.touchSize,
    marginLeft: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyEmailText: {
    ...aboutSupportTypography.supporting,
    color: aboutSupportColors.blue,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.62,
  },
});

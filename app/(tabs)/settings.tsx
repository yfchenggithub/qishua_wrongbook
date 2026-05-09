import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BrandHeader, CardContainer, ScreenContainer, SectionTitle } from '@/src/components';
import { colors, radius, spacing, typography } from '@/src/styles/tokens';

type InfoRow = {
  label: string;
  value: string;
};

const DEV_UNLOCK_TAP_TARGET = 7;
const DEV_TAP_HINT_START = 3;
const DEV_TAP_WINDOW_MS = 3000;
const VERSION_LABEL = '版本';
const VERSION_VALUE = '0.1.0 MVP';

const APP_INFO_ROWS: InfoRow[] = [
  { label: '模式', value: '离线本地版' },
  { label: '数据位置', value: '本机存储' },
  { label: '当前状态', value: '开发测试中' },
];

const CORE_FLOW_ITEMS = [
  '拍照录入错题',
  '每题复做 7 次',
  '做满 7 次后标记已掌握',
  '所有数据只保存在本机',
];

const LOCAL_DATA_ITEMS = [
  '错题信息保存在 SQLite',
  '图片保存在 App 本地目录',
  '当前版本不支持云同步',
  '卸载 App 可能会删除本地数据',
];

const ROADMAP_ITEMS = ['数据备份与恢复', '本地通知提醒', '学习统计', 'OCR / AI 识别'];

export default function SettingsScreen() {
  const [devTapCount, setDevTapCount] = useState(0);
  const [isDevModeUnlocked, setIsDevModeUnlocked] = useState(false);
  const [devHintMessage, setDevHintMessage] = useState<string | null>(null);

  const lastTapAtRef = useRef<number | null>(null);
  const tapCountRef = useRef(0);

  const handleVersionTap = useCallback(() => {
    if (!__DEV__) {
      setDevHintMessage('当前为正式构建，开发调试入口不可用');
      return;
    }

    if (isDevModeUnlocked) {
      setDevHintMessage('已开启开发调试入口');
      return;
    }

    const now = Date.now();
    const shouldReset =
      lastTapAtRef.current !== null && now - lastTapAtRef.current > DEV_TAP_WINDOW_MS;
    const baseCount = shouldReset ? 0 : Math.max(tapCountRef.current, devTapCount);
    const nextCount = baseCount + 1;

    lastTapAtRef.current = now;
    tapCountRef.current = nextCount;
    setDevTapCount(nextCount);

    if (nextCount >= DEV_UNLOCK_TAP_TARGET) {
      setIsDevModeUnlocked(true);
      setDevHintMessage('已开启开发调试入口');
      return;
    }

    if (nextCount >= DEV_TAP_HINT_START) {
      const remaining = DEV_UNLOCK_TAP_TARGET - nextCount;
      setDevHintMessage(`再点 ${remaining} 次开启开发调试入口`);
      return;
    }

    setDevHintMessage(null);
  }, [devTapCount, isDevModeUnlocked]);

  return (
    <ScreenContainer scroll contentStyle={styles.screenContent}>
      <BrandHeader title="设置" subtitle="离线运行，本地保存错题和复做记录" offlineLabel="• 离线" />

      <View style={styles.sectionBlock}>
        <SectionTitle title="App 信息" />
        <CardContainer style={styles.card} padding={spacing.lg}>
          <Text style={styles.appName}>七刷错题本</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="版本号"
            hitSlop={8}
            onPress={handleVersionTap}
            style={styles.versionRowPressable}>
            <Text style={styles.infoLabel}>{VERSION_LABEL}</Text>
            <Text style={styles.infoValue}>{VERSION_VALUE}</Text>
          </Pressable>
          {APP_INFO_ROWS.map((row) => (
            <View key={row.label} style={styles.infoRow}>
              <Text style={styles.infoLabel}>{row.label}</Text>
              <Text style={styles.infoValue}>{row.value}</Text>
            </View>
          ))}
          {devHintMessage ? <Text style={styles.devHintText}>{devHintMessage}</Text> : null}
        </CardContainer>
      </View>

      <View style={styles.sectionBlock}>
        <SectionTitle title="核心流程" />
        <CardContainer style={styles.card} padding={spacing.lg}>
          {CORE_FLOW_ITEMS.map((item) => (
            <Text key={item} style={styles.listText}>
              • {item}
            </Text>
          ))}
        </CardContainer>
      </View>

      <View style={styles.sectionBlock}>
        <SectionTitle title="本地数据" />
        <CardContainer style={styles.card} padding={spacing.lg}>
          {LOCAL_DATA_ITEMS.map((item) => (
            <Text key={item} style={styles.listText}>
              • {item}
            </Text>
          ))}
        </CardContainer>
      </View>

      <View style={styles.sectionBlock}>
        <SectionTitle title="后续计划" />
        <CardContainer style={styles.card} padding={spacing.lg}>
          {ROADMAP_ITEMS.map((item) => (
            <Text key={item} style={styles.listText}>
              • {item}
            </Text>
          ))}
        </CardContainer>
      </View>

      {isDevModeUnlocked ? (
        <View style={styles.sectionBlock}>
          <SectionTitle title="开发调试" />
          <CardContainer style={styles.card} padding={spacing.lg}>
            <Text style={styles.listText}>
              已开启开发调试入口，下一阶段接入数据库调试和图片调试。
            </Text>
          </CardContainer>
        </View>
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    paddingTop: spacing.lg,
    gap: spacing.xl,
  },
  sectionBlock: {
    gap: spacing.md,
  },
  card: {
    borderRadius: radius.xl,
    gap: spacing.sm,
  },
  appName: {
    ...typography.sectionTitle,
    fontSize: 22,
    lineHeight: 30,
    marginBottom: spacing.xs,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  infoLabel: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  infoValue: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    flexShrink: 1,
    textAlign: 'right',
  },
  versionRowPressable: {
    minHeight: 44,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  devHintText: {
    ...typography.caption,
    color: colors.success,
    fontWeight: '700',
  },
  listText: {
    ...typography.body,
    color: colors.textSecondary,
    lineHeight: 26,
  },
});

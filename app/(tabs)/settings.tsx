import { StyleSheet, Text, View } from 'react-native';

import { BrandHeader, CardContainer, ScreenContainer, SectionTitle } from '@/src/components';
import { colors, radius, spacing, typography } from '@/src/styles/tokens';

export default function SettingsScreen() {
  return (
    <ScreenContainer scroll contentStyle={styles.screenContent}>
      <BrandHeader title="设置" subtitle="离线运行，本地保存错题和复做记录" />

      <View style={styles.sectionBlock}>
        <SectionTitle title="App 信息（占位）" />
        <CardContainer style={styles.card} padding={spacing.lg}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>应用名称</Text>
            <Text style={styles.infoValue}>七刷错题本</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>版本号</Text>
            <Text style={styles.infoValue}>待接入</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>构建信息</Text>
            <Text style={styles.infoValue}>待接入</Text>
          </View>
        </CardContainer>
      </View>

      <View style={styles.sectionBlock}>
        <SectionTitle title="本地数据说明（占位）" />
        <CardContainer style={styles.card} padding={spacing.lg}>
          <Text style={styles.description}>当前版本离线运行，不依赖登录与云同步。</Text>
          <Text style={styles.description}>错题、图片、复做记录仅保存在当前设备本地。</Text>
          <Text style={styles.note}>后续 S-B 阶段将补充更完整的数据说明入口。</Text>
        </CardContainer>
      </View>
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
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  infoLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  infoValue: {
    ...typography.body,
    color: colors.textPrimary,
    textAlign: 'right',
  },
  description: {
    ...typography.body,
    color: colors.textSecondary,
  },
  note: {
    ...typography.caption,
    color: colors.textMuted,
  },
});

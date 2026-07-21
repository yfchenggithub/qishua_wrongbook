import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { PrimaryButton, SurfaceCard } from '@/src/components/ui';
import type { TodayCompletedStats } from '@/src/services/MistakeListService';
import { colors, layout, typography } from '@/src/styles/tokens';


interface ProgressRingProps {
  completed: number;
  total: number;
}

function ProgressRing({ completed, total }: ProgressRingProps) {
  const size = 120;
  const strokeWidth = 11;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = total > 0 ? Math.max(0, Math.min(1, completed / total)) : 0;

  return (
    <View
      accessibilityLabel={`今日复做进度，已完成 ${completed} 道，共 ${total} 道`}
      accessibilityRole="progressbar"
      style={styles.ringWrap}>
      <Svg height={size} width={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          fill="none"
          r={radius}
          stroke="#E9E9EB"
          strokeWidth={strokeWidth}
        />
        {progress > 0 ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            fill="none"
            r={radius}
            rotation="-90"
            origin={`${size / 2}, ${size / 2}`}
            stroke={colors.accent}
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={circumference * (1 - progress)}
            strokeLinecap="round"
            strokeWidth={strokeWidth}
          />
        ) : null}
      </Svg>
      <View pointerEvents="none" style={styles.ringLabel}>
        <View style={styles.ringValueRow}>
          <Text adjustsFontSizeToFit minimumFontScale={0.48} numberOfLines={1} style={styles.ringValue}>
            {completed}
          </Text>
          <Text adjustsFontSizeToFit minimumFontScale={0.58} numberOfLines={1} style={styles.ringTotal}>
            / {total}
          </Text>
        </View>
        <Text style={styles.ringCaption}>已完成</Text>
      </View>
    </View>
  );
}

interface TodaySummaryCardProps {
  completed: TodayCompletedStats;
  pendingCount: number;
  totalCount: number;
  hint: string;
  primaryLabel: string;
  primaryDisabled: boolean;
  onPrimaryPress: () => void;
  exportLabel: string;
  exportDisabled: boolean;
  onExportPress: () => void;
  exportProgressLabel?: string;
  exportProgress?: number;
}

export function TodaySummaryCard({
  completed,
  pendingCount,
  totalCount,
  hint,
  primaryLabel,
  primaryDisabled,
  onPrimaryPress,
  exportLabel,
  exportDisabled,
  onExportPress,
  exportProgressLabel,
  exportProgress = 0,
}: TodaySummaryCardProps) {
  return (
    <SurfaceCard style={styles.card}>
      <Text style={styles.title}>今日复做</Text>

      <View style={styles.summaryRow}>
        <ProgressRing completed={completed.total} total={totalCount} />

        <View style={styles.detailColumn}>
          <View style={styles.pendingRow}>
            <Text
              adjustsFontSizeToFit
              maxFontSizeMultiplier={1.05}
              minimumFontScale={0.45}
              numberOfLines={1}
              style={styles.pendingCount}>
              {pendingCount}
            </Text>
            <Text maxFontSizeMultiplier={1.1} numberOfLines={2} style={styles.pendingLabel}>
              道{`\n`}待复做
            </Text>
          </View>

          <View style={styles.resultDivider} />
          <View style={styles.resultRow}>
            <View style={styles.resultCell}>
              <Text style={styles.resultLabel}>会了</Text>
              <Text style={[styles.resultValue, styles.mastered]}>{completed.mastered}</Text>
            </View>
            <View style={[styles.resultCell, styles.resultCellDivided]}>
              <Text style={styles.resultLabel}>模糊</Text>
              <Text style={[styles.resultValue, styles.unsure]}>{completed.unsure}</Text>
            </View>
            <View style={[styles.resultCell, styles.resultCellDivided]}>
              <Text style={styles.resultLabel}>不会</Text>
              <Text style={[styles.resultValue, styles.wrong]}>{completed.wrong}</Text>
            </View>
          </View>
        </View>
      </View>

      <Text maxFontSizeMultiplier={1.2} style={styles.hint}>{hint}</Text>

      <PrimaryButton
        disabled={primaryDisabled}
        onPress={onPrimaryPress}
        style={styles.primaryButton}
        title={primaryLabel}
      />

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: exportDisabled }}
        disabled={exportDisabled}
        onPress={onExportPress}
        style={({ pressed }) => [
          styles.exportButton,
          exportDisabled ? styles.exportButtonDisabled : null,
          pressed && !exportDisabled ? styles.exportButtonPressed : null,
        ]}>
        <MaterialIcons
          name="description"
          size={20}
          color={exportDisabled ? colors.textTertiary : colors.accent}
        />
        <Text numberOfLines={1} style={[styles.exportText, exportDisabled ? styles.exportTextDisabled : null]}>
          {exportLabel}
        </Text>
      </Pressable>

      {exportProgressLabel ? (
        <View style={styles.exportProgressWrap}>
          <Text numberOfLines={2} style={styles.exportProgressText}>{exportProgressLabel}</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(Math.max(0, Math.min(1, exportProgress)) * 100)}%` }]} />
          </View>
        </View>
      ) : null}
    </SurfaceCard>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 0,
  },
  title: {
    ...typography.cardTitle,
  },
  summaryRow: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  ringWrap: {
    width: 120,
    height: 120,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringLabel: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringValueRow: {
    width: 92,
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  ringValue: {
    flex: 1,
    minWidth: 0,
    color: colors.accent,
    fontSize: 34,
    lineHeight: 39,
    fontWeight: '800',
    textAlign: 'right',
  },
  ringTotal: {
    flex: 1,
    minWidth: 0,
    marginLeft: 4,
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  ringCaption: {
    marginTop: 1,
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  detailColumn: {
    flex: 1,
    minWidth: 0,
  },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  pendingCount: {
    flex: 1,
    minWidth: 0,
    color: colors.accent,
    fontSize: 45,
    lineHeight: 52,
    fontWeight: '800',
  },
  pendingLabel: {
    marginLeft: 6,
    flexShrink: 0,
    color: colors.textPrimary,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  resultDivider: {
    height: StyleSheet.hairlineWidth,
    marginTop: 10,
    marginBottom: 10,
    backgroundColor: colors.separator,
  },
  resultRow: {
    flexDirection: 'row',
  },
  resultCell: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
  },
  resultCellDivided: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.separator,
  },
  resultLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
  },
  resultValue: {
    marginTop: 2,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '700',
  },
  mastered: {
    color: colors.accent,
  },
  unsure: {
    color: colors.warning,
  },
  wrong: {
    color: colors.danger,
  },
  hint: {
    marginTop: 18,
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  primaryButton: {
    marginTop: 18,
    height: layout.primaryButtonHeight,
  },
  exportButton: {
    minHeight: 48,
    marginTop: 5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  exportButtonPressed: {
    opacity: 0.55,
  },
  exportButtonDisabled: {
    opacity: 0.72,
  },
  exportText: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
  },
  exportTextDisabled: {
    color: colors.textTertiary,
  },
  exportProgressWrap: {
    gap: 6,
  },
  exportProgressText: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
  progressTrack: {
    height: 4,
    overflow: 'hidden',
    borderRadius: 99,
    backgroundColor: '#E9E9EB',
  },
  progressFill: {
    height: '100%',
    borderRadius: 99,
    backgroundColor: colors.accent,
  },
});

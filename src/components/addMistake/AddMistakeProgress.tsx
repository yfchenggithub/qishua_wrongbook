import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing } from '@/src/styles/tokens';

export type AddMistakeStage = 'QUESTION' | 'SUPPLEMENT' | 'READY_TO_SAVE';

const STEPS = [
  { number: 1, label: '题目' },
  { number: 2, label: '补充' },
  { number: 3, label: '保存' },
] as const;

function getActiveStep(stage: AddMistakeStage): number {
  if (stage === 'SUPPLEMENT') return 2;
  if (stage === 'READY_TO_SAVE') return 3;
  return 1;
}

export function AddMistakeProgress({ stage }: { stage: AddMistakeStage }) {
  const activeStep = getActiveStep(stage);
  return (
    <View accessibilityLabel={`新增错题步骤：第 ${activeStep} 步`} style={styles.row}>
      {STEPS.map((step, index) => {
        const active = step.number === activeStep;
        const reached = step.number <= activeStep;
        return (
          <View key={step.number} style={styles.fragment}>
            <View style={styles.step}>
              <View style={[styles.badge, active && styles.badgeActive, reached && !active && styles.badgeReached]}>
                <Text style={[styles.number, reached && styles.numberReached]}>{step.number}</Text>
              </View>
              <Text style={[styles.label, active && styles.labelActive]}>{step.label}</Text>
            </View>
            {index < STEPS.length - 1 ? (
              <View style={[styles.line, step.number < activeStep && styles.lineReached]} />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xxl },
  fragment: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  step: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  badge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.separator,
    backgroundColor: colors.surface,
  },
  badgeActive: { borderColor: colors.accent, backgroundColor: colors.accent },
  badgeReached: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  number: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
  numberReached: { color: colors.accent, fontWeight: '700' },
  label: { color: colors.textSecondary, fontSize: 16, lineHeight: 22, fontWeight: '600' },
  labelActive: { color: colors.accent, fontWeight: '700' },
  line: { flex: 1, height: StyleSheet.hairlineWidth, marginHorizontal: spacing.sm, backgroundColor: colors.separator },
  lineReached: { backgroundColor: colors.accent },
});

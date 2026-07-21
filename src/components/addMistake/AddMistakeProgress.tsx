import { StyleSheet, Text, View } from 'react-native';

const GREEN = '#34C759';
const MUTED = '#8E8E93';
const BORDER = '#D1D1D6';

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
  row: { flexDirection: 'row', alignItems: 'center', marginVertical: 18 },
  fragment: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  step: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  badge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#FFFFFF',
  },
  badgeActive: { borderColor: GREEN, backgroundColor: GREEN },
  badgeReached: { borderColor: GREEN, backgroundColor: '#EAF8EE' },
  number: { color: MUTED, fontSize: 15, fontWeight: '600' },
  numberReached: { color: GREEN, fontWeight: '700' },
  label: { color: MUTED, fontSize: 15, fontWeight: '600' },
  labelActive: { color: GREEN, fontWeight: '700' },
  line: { flex: 1, height: StyleSheet.hairlineWidth, marginHorizontal: 10, backgroundColor: BORDER },
  lineReached: { backgroundColor: GREEN },
});

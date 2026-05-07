import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing } from '@/src/styles/tokens';

export interface ProgressDotsProps {
  total?: number;
  current?: number;
  completed?: number;
  style?: StyleProp<ViewStyle>;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function ProgressDots({ total = 7, current, completed = 0, style }: ProgressDotsProps) {
  const safeTotal = Math.max(total, 1);
  const safeCompleted = clamp(completed, 0, safeTotal);
  const safeCurrent = current === undefined ? undefined : clamp(current, 1, safeTotal);

  return (
    <View style={[styles.row, style]}>
      {Array.from({ length: safeTotal }, (_, index) => {
        const position = index + 1;
        const isCurrent = safeCurrent === position;
        const isCompleted = !isCurrent && position <= safeCompleted;

        if (isCurrent) {
          return (
            <View key={position} style={styles.currentRing}>
              <View style={styles.currentInner} />
            </View>
          );
        }

        return <View key={position} style={[styles.dot, isCompleted && styles.dotCompleted]} />;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: radius.pill,
    backgroundColor: '#D9DADD',
  },
  dotCompleted: {
    backgroundColor: colors.black,
  },
  currentRing: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.black,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  currentInner: {
    width: 10,
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.black,
  },
});


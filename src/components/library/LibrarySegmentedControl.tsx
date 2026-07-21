import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '@/src/styles/tokens';

export interface LibrarySegmentOption<TValue extends string> {
  value: TValue;
  label: string;
  count: number;
}

interface LibrarySegmentedControlProps<TValue extends string> {
  options: readonly LibrarySegmentOption<TValue>[];
  value: TValue | null;
  onChange: (value: TValue) => void;
}

export function LibrarySegmentedControl<TValue extends string>({
  options,
  value,
  onChange,
}: LibrarySegmentedControlProps<TValue>) {
  return (
    <View accessibilityRole="tablist" style={styles.track}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityLabel={`${option.label}，${option.count}道错题`}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.item,
              selected ? styles.itemSelected : null,
              pressed ? styles.itemPressed : null,
            ]}>
            <Text
              adjustsFontSizeToFit
              minimumFontScale={0.82}
              numberOfLines={1}
              style={[styles.label, selected ? styles.labelSelected : null]}>
              {option.label} {option.count}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    minHeight: 52,
    flexDirection: 'row',
    padding: spacing.xs,
    borderRadius: radius.lg,
    backgroundColor: '#ECEDEF',
  },
  item: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
  },
  itemSelected: {
    backgroundColor: colors.surface,
    shadowColor: colors.shadow,
    shadowOpacity: 0.05,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  itemPressed: {
    opacity: 0.62,
  },
  label: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  labelSelected: {
    color: colors.textPrimary,
    fontWeight: '700',
  },
});

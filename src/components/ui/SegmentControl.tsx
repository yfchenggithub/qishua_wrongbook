import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing, typography } from '@/src/styles/tokens';

export interface SegmentOption {
  label: string;
  value: string;
}

export interface SegmentControlProps {
  options: SegmentOption[] | string[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  style?: StyleProp<ViewStyle>;
}

export function SegmentControl({
  options,
  value,
  defaultValue,
  onChange,
  style,
}: SegmentControlProps) {
  const normalizedOptions = useMemo<SegmentOption[]>(
    () =>
      options.map((item) => (typeof item === 'string' ? { label: item, value: item } : item)),
    [options]
  );

  const initialValue = defaultValue ?? normalizedOptions[0]?.value ?? '';
  const [innerValue, setInnerValue] = useState(initialValue);

  useEffect(() => {
    if (value !== undefined) {
      setInnerValue(value);
    }
  }, [value]);

  const selectedValue = value ?? innerValue;

  const handlePress = (nextValue: string) => {
    if (value === undefined) {
      setInnerValue(nextValue);
    }
    onChange?.(nextValue);
  };

  return (
    <View style={[styles.wrapper, style]}>
      {normalizedOptions.map((option) => {
        const selected = option.value === selectedValue;

        return (
          <Pressable
            key={option.value}
            style={[styles.item, selected && styles.itemSelected]}
            onPress={() => handlePress(option.value)}>
            <Text style={[styles.itemText, selected && styles.itemTextSelected]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: 'row',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.xs,
  },
  item: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
  },
  itemSelected: {
    backgroundColor: colors.black,
  },
  itemText: {
    ...typography.body,
    color: colors.textPrimary,
  },
  itemTextSelected: {
    color: colors.white,
    fontWeight: '700',
  },
});


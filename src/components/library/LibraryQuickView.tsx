import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '@/src/styles/tokens';

export interface LibraryQuickViewOption<TValue extends string> {
  value: TValue;
  label: string;
  icon: ComponentProps<typeof MaterialIcons>['name'];
  count?: number;
  tone?: 'default' | 'danger';
}

interface LibraryQuickViewProps<TValue extends string> {
  options: readonly LibraryQuickViewOption<TValue>[];
  value: TValue | null;
  onChange: (value: TValue) => void;
}

export function LibraryQuickView<TValue extends string>({
  options,
  value,
  onChange,
}: LibraryQuickViewProps<TValue>) {
  return (
    <View style={styles.container}>
      {options.map((option, index) => {
        const selected = option.value === value;
        const iconColor = option.tone === 'danger' && !selected
          ? '#D97706'
          : selected
            ? colors.success
            : colors.textSecondary;
        return (
          <View key={option.value} style={styles.itemSlot}>
            {index > 0 ? <View style={styles.divider} /> : null}
            <Pressable
              accessibilityLabel={
                option.count === undefined
                  ? option.label
                  : `${option.label}，${option.count}道错题`
              }
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [
                styles.item,
                selected ? styles.itemSelected : null,
                pressed ? styles.itemPressed : null,
              ]}>
              <MaterialIcons name={option.icon} size={23} color={iconColor} />
              <Text numberOfLines={1} style={[styles.label, selected ? styles.labelSelected : null]}>
                {option.label}
              </Text>
              {option.count === undefined ? (
                <View style={styles.countPlaceholder} />
              ) : (
                <Text
                  style={[
                    styles.count,
                    option.tone === 'danger' ? styles.countDanger : null,
                    selected ? styles.countSelected : null,
                  ]}>
                  {option.count}
                </Text>
              )}
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 84,
    flexDirection: 'row',
    overflow: 'hidden',
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  itemSlot: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    height: 48,
    alignSelf: 'center',
    backgroundColor: colors.border,
  },
  item: {
    flex: 1,
    minWidth: 0,
    minHeight: 84,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: 2,
    borderRadius: radius.md,
  },
  itemSelected: {
    margin: spacing.xs,
    minHeight: 76,
    backgroundColor: colors.successBg,
  },
  itemPressed: {
    opacity: 0.58,
  },
  label: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
  },
  labelSelected: {
    color: colors.textPrimary,
    fontWeight: '700',
  },
  count: {
    minHeight: 18,
    color: colors.success,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
  },
  countDanger: {
    color: '#D97706',
  },
  countSelected: {
    color: colors.success,
  },
  countPlaceholder: {
    height: 18,
  },
});

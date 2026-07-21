import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius } from '@/src/styles/tokens';

export interface SmartFilterOption<TValue extends string> {
  value: TValue;
  label: string;
  count?: number;
}

interface SmartFilterProps<TValue extends string> {
  options: readonly SmartFilterOption<TValue>[];
  value: TValue;
  onChange: (value: TValue) => void;
  style?: StyleProp<ViewStyle>;
}

export function SmartFilter<TValue extends string>({
  options,
  value,
  onChange,
  style,
}: SmartFilterProps<TValue>) {
  return (
    <View accessibilityRole="tablist" style={[styles.track, style]}>
      {options.map((option) => {
        const selected = option.value === value;
        const label = option.count === undefined ? option.label : `${option.label} ${option.count}`;

        return (
          <Pressable
            key={option.value}
            accessibilityLabel={
              option.count === undefined ? option.label : `${option.label}，${option.count} 道`
            }
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
              maxFontSizeMultiplier={1.1}
              minimumFontScale={0.72}
              numberOfLines={1}
              style={[styles.label, selected ? styles.labelSelected : null]}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 44,
    flexDirection: 'row',
    padding: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  item: {
    flex: 1,
    minWidth: 0,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    paddingHorizontal: 3,
  },
  itemSelected: {
    backgroundColor: colors.accentSoft,
  },
  itemPressed: {
    opacity: 0.58,
  },
  label: {
    color: colors.textPrimary,
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  labelSelected: {
    color: colors.accent,
    fontWeight: '700',
  },
});

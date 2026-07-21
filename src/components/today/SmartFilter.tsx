import { Pressable, StyleSheet, Text, View } from 'react-native';

export interface SmartFilterOption<TValue extends string> {
  value: TValue;
  label: string;
  count?: number;
}

interface SmartFilterProps<TValue extends string> {
  options: readonly SmartFilterOption<TValue>[];
  value: TValue;
  onChange: (value: TValue) => void;
}

const GREEN = '#34C759';

export function SmartFilter<TValue extends string>({
  options,
  value,
  onChange,
}: SmartFilterProps<TValue>) {
  return (
    <View accessibilityRole="tablist" style={styles.track}>
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
    minHeight: 52,
    flexDirection: 'row',
    padding: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#D9D9DE',
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
  },
  item: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    paddingHorizontal: 3,
  },
  itemSelected: {
    backgroundColor: '#EDF8F0',
  },
  itemPressed: {
    opacity: 0.58,
  },
  label: {
    color: '#1D1D1F',
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  labelSelected: {
    color: GREEN,
    fontWeight: '700',
  },
});

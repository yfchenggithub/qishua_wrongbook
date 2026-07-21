import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, layout, spacing, typography } from '@/src/styles/tokens';

export interface SectionHeaderProps {
  title: string;
  variant?: 'major' | 'group';
  actionLabel?: string;
  onActionPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function SectionHeader({
  title,
  variant = 'major',
  actionLabel,
  onActionPress,
  style,
}: SectionHeaderProps) {
  return (
    <View style={[styles.row, variant === 'major' ? styles.majorRow : styles.groupRow, style]}>
      <Text
        numberOfLines={1}
        style={variant === 'major' ? styles.majorTitle : styles.groupTitle}>
        {title}
      </Text>
      {actionLabel && onActionPress ? (
        <Pressable
          accessibilityRole="button"
          onPress={onActionPress}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
          <Text style={styles.actionText}>{actionLabel}</Text>
          <MaterialIcons name="chevron-right" size={layout.chevronSize} color={colors.accent} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  majorRow: {
    minHeight: layout.minimumTouchSize,
  },
  groupRow: {
    minHeight: 20,
  },
  majorTitle: {
    ...typography.sectionMajor,
    flex: 1,
    minWidth: 0,
  },
  groupTitle: {
    ...typography.sectionGroup,
    flex: 1,
    minWidth: 0,
  },
  action: {
    minHeight: layout.minimumTouchSize,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.sm,
  },
  actionText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
    color: colors.accent,
  },
  pressed: {
    opacity: 0.55,
  },
});

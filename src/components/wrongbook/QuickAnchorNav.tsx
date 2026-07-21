import type { ComponentProps } from 'react';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CardContainer } from '@/src/components/ui';
import { colors, radius, spacing, typography } from '@/src/styles/tokens';

export type QuickAnchorNavIconName = ComponentProps<typeof MaterialIcons>['name'];

export interface QuickAnchorNavItem<AnchorId extends string = string> {
  id: AnchorId;
  label: string;
  shortLabel: string;
  icon: QuickAnchorNavIconName;
}

export interface QuickAnchorNavProps<AnchorId extends string = string> {
  items: readonly QuickAnchorNavItem<AnchorId>[];
  activeAnchorId: AnchorId;
  collapsed?: boolean;
  floating?: boolean;
  horizontalCompact?: boolean;
  title?: string;
  onToggleCollapsed?: () => void;
  onAnchorPress: (anchorId: AnchorId) => void;
}

export function QuickAnchorNav<AnchorId extends string>({
  items,
  activeAnchorId,
  collapsed = false,
  floating = false,
  horizontalCompact = false,
  title = '快速导航',
  onToggleCollapsed,
  onAnchorPress,
}: QuickAnchorNavProps<AnchorId>) {
  if (collapsed) {
    return (
      <CardContainer
        style={[
          styles.card,
          styles.floatingCard,
          styles.collapsedCard,
        ]}
        padding={spacing.xs}>
        <View style={styles.collapsedRow}>
          {horizontalCompact ? (
            <ScrollView
              horizontal
              style={styles.collapsedScroll}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.compactCollapsedListContent}>
            {items.map((item) => {
              const active = item.id === activeAnchorId;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={`跳转到${item.label}`}
                  onPress={() => onAnchorPress(item.id)}
                  style={({ pressed }) => [
                    styles.compactCollapsedItem,
                    active ? styles.collapsedItemActive : null,
                    pressed ? styles.itemPressed : null,
                  ]}>
                  <MaterialIcons
                    name={item.icon}
                    size={17}
                    color={active ? colors.success : colors.textSecondary}
                  />
                  <Text
                    numberOfLines={1}
                    maxFontSizeMultiplier={1.05}
                    style={[
                      styles.collapsedText,
                      active ? styles.collapsedTextActive : null,
                    ]}>
                    {item.shortLabel}
                  </Text>
                </Pressable>
              );
            })}
            </ScrollView>
          ) : (
            <View style={styles.collapsedList}>
              {items.map((item) => {
                const active = item.id === activeAnchorId;
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityLabel={`跳转到${item.label}`}
                    onPress={() => onAnchorPress(item.id)}
                    style={({ pressed }) => [
                      styles.collapsedItem,
                      active ? styles.collapsedItemActive : null,
                      pressed ? styles.itemPressed : null,
                    ]}>
                    <MaterialIcons
                      name={item.icon}
                      size={17}
                      color={active ? colors.success : colors.textSecondary}
                    />
                    <Text
                      numberOfLines={1}
                      maxFontSizeMultiplier={1.05}
                      style={[
                        styles.collapsedText,
                        active ? styles.collapsedTextActive : null,
                      ]}>
                      {item.shortLabel}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          {onToggleCollapsed ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="展开快速导航"
              onPress={onToggleCollapsed}
              style={({ pressed }) => [
                styles.toggleButton,
                pressed ? styles.itemPressed : null,
              ]}>
              <MaterialIcons name="keyboard-arrow-down" size={22} color={colors.success} />
            </Pressable>
          ) : null}
        </View>
      </CardContainer>
    );
  }

  return (
    <CardContainer
      style={[
        styles.card,
        horizontalCompact ? styles.compactCard : null,
        floating ? styles.floatingCard : null,
      ]}
      padding={horizontalCompact ? spacing.sm : spacing.md}>
      <View style={[styles.headerRow, horizontalCompact ? styles.compactHeaderRow : null]}>
        <View style={styles.titleWrap}>
          <MaterialIcons name="anchor" size={horizontalCompact ? 15 : 17} color={colors.success} />
          <Text style={[styles.title, horizontalCompact ? styles.compactTitle : null]}>{title}</Text>
        </View>
        {onToggleCollapsed ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="收起快速导航"
            onPress={onToggleCollapsed}
            style={({ pressed }) => [
              styles.headerButton,
              pressed ? styles.itemPressed : null,
            ]}>
            <Text style={styles.headerButtonText}>收起</Text>
            <MaterialIcons name="keyboard-arrow-up" size={18} color={colors.success} />
          </Pressable>
        ) : null}
      </View>

      {horizontalCompact ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.compactListContent}>
          {items.map((item) => {
            const active = item.id === activeAnchorId;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`跳转到${item.label}`}
                onPress={() => onAnchorPress(item.id)}
                style={({ pressed }) => [
                  styles.compactItem,
                  active ? styles.compactItemActive : null,
                  pressed ? styles.itemPressed : null,
                ]}>
                <View style={[styles.compactIconBubble, active ? styles.iconBubbleActive : null]}>
                  <MaterialIcons
                    name={item.icon}
                    size={18}
                    color={active ? colors.white : colors.success}
                  />
                </View>
                <Text
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.05}
                  style={[styles.compactItemText, active ? styles.itemTextActive : null]}>
                  {item.label}
                </Text>
                <View style={[styles.compactUnderline, active ? styles.underlineActive : null]} />
              </Pressable>
            );
          })}
        </ScrollView>
      ) : (
        <View style={styles.list}>
          {items.map((item) => {
            const active = item.id === activeAnchorId;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`跳转到${item.label}`}
                onPress={() => onAnchorPress(item.id)}
                style={({ pressed }) => [
                  styles.item,
                  active ? styles.itemActive : null,
                  pressed ? styles.itemPressed : null,
                ]}>
                <View style={[styles.iconBubble, active ? styles.iconBubbleActive : null]}>
                  <MaterialIcons
                    name={item.icon}
                    size={23}
                    color={active ? colors.white : colors.success}
                  />
                </View>
                <Text
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.1}
                  style={[styles.itemText, active ? styles.itemTextActive : null]}>
                  {item.label}
                </Text>
                <View style={[styles.underline, active ? styles.underlineActive : null]} />
              </Pressable>
            );
          })}
        </View>
      )}
    </CardContainer>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    borderColor: colors.successBorder,
    backgroundColor: colors.accentSoft,
    gap: spacing.md,
  },
  compactCard: {
    borderRadius: radius.lg,
    gap: spacing.sm,
  },
  floatingCard: {
    shadowColor: colors.shadow,
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 9,
  },
  collapsedCard: {
    borderRadius: radius.lg,
    gap: 0,
  },
  headerRow: {
    minHeight: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  compactHeaderRow: {
    minHeight: 18,
  },
  titleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  title: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    fontWeight: '900',
  },
  compactTitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  headerButton: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    paddingLeft: spacing.sm,
    paddingRight: spacing.xs,
    gap: 1,
  },
  headerButtonText: {
    ...typography.caption,
    color: colors.success,
    fontWeight: '900',
  },
  list: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'stretch',
    gap: spacing.sm,
  },
  item: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 58,
    minWidth: 58,
    minHeight: 72,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  itemActive: {
    backgroundColor: colors.successBg,
  },
  compactListContent: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.sm,
    paddingRight: spacing.xs,
  },
  compactItem: {
    width: 60,
    minHeight: 54,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
    paddingVertical: spacing.xs,
    gap: 3,
  },
  compactItemActive: {
    backgroundColor: colors.successBg,
  },
  itemPressed: {
    opacity: 0.82,
  },
  iconBubble: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: '#EEF8F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBubbleActive: {
    backgroundColor: colors.success,
  },
  compactIconBubble: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: '#EEF8F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '800',
  },
  itemTextActive: {
    color: colors.success,
    fontWeight: '900',
  },
  compactItemText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
  },
  underline: {
    width: 30,
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: 'transparent',
  },
  underlineActive: {
    backgroundColor: colors.success,
  },
  compactUnderline: {
    width: 24,
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: 'transparent',
  },
  collapsedRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  collapsedList: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  collapsedScroll: {
    flex: 1,
    minWidth: 0,
  },
  compactCollapsedListContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingRight: spacing.xs,
  },
  collapsedItem: {
    flex: 1,
    minWidth: 0,
    minHeight: 38,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: 2,
  },
  compactCollapsedItem: {
    width: 58,
    minHeight: 38,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: 2,
  },
  collapsedItemActive: {
    backgroundColor: colors.successBg,
  },
  collapsedText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
  },
  collapsedTextActive: {
    color: colors.success,
    fontWeight: '900',
  },
  toggleButton: {
    width: 34,
    height: 38,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.successBg,
  },
});

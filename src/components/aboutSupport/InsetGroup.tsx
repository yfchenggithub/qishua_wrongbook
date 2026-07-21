import { Children, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import {
  aboutSupportCardShadow,
  aboutSupportColors,
  aboutSupportLayout,
} from '@/src/styles/aboutSupportTokens';

export interface InsetGroupProps {
  children: ReactNode;
  dividerInset?: number;
  style?: StyleProp<ViewStyle>;
}

export function InsetGroup({ children, dividerInset = 20, style }: InsetGroupProps) {
  const items = Children.toArray(children);

  return (
    <View style={[styles.group, style]}>
      {items.map((child, index) => (
        <View key={index}>
          {index > 0 ? <View style={[styles.divider, { marginLeft: dividerInset }]} /> : null}
          {child}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    ...aboutSupportCardShadow,
    borderRadius: aboutSupportLayout.cardRadius,
    backgroundColor: aboutSupportColors.card,
    overflow: 'hidden',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: aboutSupportColors.separator,
  },
});

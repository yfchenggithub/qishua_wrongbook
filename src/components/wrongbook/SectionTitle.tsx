import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

import { typography } from '@/src/styles/tokens';

export interface SectionTitleProps {
  title: string;
  style?: StyleProp<TextStyle>;
}

export function SectionTitle({ title, style }: SectionTitleProps) {
  return (
    <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={[styles.title, style]}>
      {title}
    </Text>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.sectionMajor,
  },
});

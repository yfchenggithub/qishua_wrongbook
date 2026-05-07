import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

import { typography } from '@/src/styles/tokens';

export interface SectionTitleProps {
  title: string;
  style?: StyleProp<TextStyle>;
}

export function SectionTitle({ title, style }: SectionTitleProps) {
  return <Text style={[styles.title, style]}>{title}</Text>;
}

const styles = StyleSheet.create({
  title: {
    ...typography.sectionTitle,
  },
});


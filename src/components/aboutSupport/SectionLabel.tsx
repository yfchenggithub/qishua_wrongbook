import { StyleSheet, Text } from 'react-native';

import { aboutSupportTypography } from '@/src/styles/aboutSupportTokens';

export function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.label}>{children}</Text>;
}

const styles = StyleSheet.create({
  label: {
    ...aboutSupportTypography.sectionLabel,
    marginLeft: 4,
    marginBottom: 10,
  },
});

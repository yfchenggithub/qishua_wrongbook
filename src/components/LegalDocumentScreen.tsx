import { Stack } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { CardContainer } from '@/src/components/ui/CardContainer';
import { ScreenContainer } from '@/src/components/ui/ScreenContainer';
import { spacing } from '@/src/styles/tokens';

export interface LegalDocumentSection {
  title: string;
  content: string;
}

export interface LegalDocumentScreenProps {
  title: string;
  subtitle: string;
  updatedAt: string;
  sections: LegalDocumentSection[];
  footer?: string;
}

export function LegalDocumentScreen({
  title,
  subtitle,
  updatedAt,
  sections,
  footer,
}: LegalDocumentScreenProps) {
  return (
    <>
      <Stack.Screen options={{ title }} />

      <ScreenContainer
        scroll
        contentStyle={styles.content}
        safeAreaEdges={['bottom']}
        style={styles.screen}
      >
        <CardContainer padding={spacing.lg} style={styles.card}>
          <Text style={styles.documentTitle}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
          <Text style={styles.updatedAt}>更新日期：{updatedAt}</Text>
        </CardContainer>

        {sections.map((section, index) => (
          <CardContainer
            key={`${section.title}-${index.toString()}`}
            padding={spacing.lg}
            style={styles.card}
          >
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <Text style={styles.sectionContent}>{section.content}</Text>
          </CardContainer>
        ))}

        {footer ? (
          <CardContainer padding={spacing.lg} style={styles.card}>
            <Text style={styles.footerText}>{footer}</Text>
          </CardContainer>
        ) : null}
      </ScreenContainer>
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#F5F6F8',
  },
  content: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  card: {
    borderRadius: 22,
    borderColor: '#E9EBEE',
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOpacity: 0.05,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  documentTitle: {
    color: '#111827',
    fontSize: 22,
    lineHeight: 30,
    fontWeight: '700',
  },
  subtitle: {
    marginTop: spacing.xs,
    color: '#6B7280',
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '500',
  },
  updatedAt: {
    marginTop: spacing.sm,
    color: '#6B7280',
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '500',
  },
  sectionTitle: {
    color: '#111827',
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '700',
  },
  sectionContent: {
    marginTop: spacing.sm,
    color: '#4B5563',
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '500',
  },
  footerText: {
    color: '#4B5563',
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '500',
  },
});

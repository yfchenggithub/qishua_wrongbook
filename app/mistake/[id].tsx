import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  BrandHeader,
  CardContainer,
  PrimaryButton,
  ProgressDots,
  ScreenContainer,
  SectionTitle,
  StatusPill,
} from '@/src/components';
import { getMistakeDetailMock, mistakeDetailBrandMock, type DetailPreviewMock } from '@/src/mocks/mistakeDetail';
import { colors, radius, spacing, typography } from '@/src/styles/tokens';

function DiagramPlaceholder() {
  return (
    <View style={styles.diagramWrap}>
      <View style={styles.diagramAxisX} />
      <View style={styles.diagramAxisY} />
      <View style={styles.diagramCurve} />
    </View>
  );
}

function ContentPreviewCard({ preview }: { preview: DetailPreviewMock }) {
  return (
    <CardContainer style={styles.previewCard} padding={spacing.md}>
      <Text style={styles.previewTitle}>{preview.title}</Text>
      <View style={styles.previewInner}>
        {preview.type === 'diagram' ? (
          <DiagramPlaceholder />
        ) : (
          <Text style={styles.previewText}>{preview.content}</Text>
        )}
      </View>
    </CardContainer>
  );
}

export default function MistakeDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();

  const routeId = Array.isArray(id) ? id[0] : id ?? 'demo-1';
  const detail = getMistakeDetailMock(routeId);
  const summaryPillTone = detail.progressLabel === '已七刷' ? 'light' : 'dark';

  return (
    <ScreenContainer scroll contentStyle={styles.screenContent}>
      <Pressable style={styles.backButton} onPress={() => router.back()}>
        <Text style={styles.backText}>← 返回今日任务</Text>
      </Pressable>

      <BrandHeader title={mistakeDetailBrandMock.title} subtitle={mistakeDetailBrandMock.subtitle} />

      <CardContainer style={styles.summaryCard} padding={spacing.xl}>
        <Text style={styles.summaryMeta}>
          {detail.code} · {detail.module}
        </Text>
        <Text style={styles.summaryTitle}>{detail.title}</Text>

        <View style={styles.summaryBottomRow}>
          <View style={styles.progressLabelWrap}>
            <Text style={styles.progressNumber}>7</Text>
            <Text style={styles.progressText}>刷进度</Text>
          </View>

          <ProgressDots
            total={detail.progress.total}
            current={detail.progress.current}
            completed={detail.progress.completed}
            style={styles.summaryDots}
          />

          <StatusPill label={detail.progressLabel} tone={summaryPillTone} />
        </View>
      </CardContainer>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.previewRow}>
        {detail.previews.map((preview) => (
          <ContentPreviewCard key={preview.id} preview={preview} />
        ))}
      </ScrollView>

      <CardContainer style={styles.captureCard} padding={spacing.lg}>
        <SectionTitle title="本次复做记录" />

        <View style={styles.capturePlaceholder}>
          <View style={styles.cameraCircle}>
            <View style={styles.cameraBody}>
              <View style={styles.cameraLens} />
            </View>
          </View>

          <Text style={styles.captureTitle}>{detail.capture.title}</Text>
          <Text style={styles.captureSubtitle}>{detail.capture.subtitle}</Text>
        </View>
      </CardContainer>

      <PrimaryButton
        title={detail.completeButtonText}
        onPress={() => Alert.alert('占位提示', '当前为 UI 占位，后续接入复做逻辑')}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    paddingTop: spacing.lg,
    gap: spacing.lg,
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
  },
  backText: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  summaryCard: {
    borderRadius: radius.xl,
  },
  summaryMeta: {
    ...typography.titleMedium,
    fontSize: 20,
    lineHeight: 28,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  summaryTitle: {
    ...typography.titleMedium,
    marginTop: spacing.sm,
  },
  summaryBottomRow: {
    marginTop: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  progressLabelWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs,
  },
  progressNumber: {
    ...typography.titleMedium,
    fontSize: 44,
    lineHeight: 48,
  },
  progressText: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 22,
    lineHeight: 28,
  },
  summaryDots: {
    flex: 1,
    justifyContent: 'center',
  },
  previewRow: {
    gap: spacing.md,
    paddingRight: spacing.xs,
  },
  previewCard: {
    width: 220,
    borderRadius: radius.lg,
  },
  previewTitle: {
    ...typography.sectionTitle,
    textAlign: 'center',
    fontSize: 18,
    lineHeight: 24,
  },
  previewInner: {
    marginTop: spacing.md,
    minHeight: 246,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    padding: spacing.md,
  },
  diagramWrap: {
    flex: 1,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  diagramAxisX: {
    position: 'absolute',
    width: 136,
    height: 1.5,
    backgroundColor: '#8E949D',
  },
  diagramAxisY: {
    position: 'absolute',
    width: 1.5,
    height: 136,
    backgroundColor: '#8E949D',
  },
  diagramCurve: {
    width: 98,
    height: 68,
    borderWidth: 1.5,
    borderColor: '#8E949D',
    borderRadius: radius.pill,
    transform: [{ rotate: '-16deg' }],
  },
  previewText: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    lineHeight: 24,
  },
  captureCard: {
    borderRadius: radius.xl,
    gap: spacing.md,
  },
  capturePlaceholder: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#C4C8CE',
    borderRadius: radius.lg,
    minHeight: 250,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  cameraCircle: {
    width: 88,
    height: 88,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraBody: {
    width: 40,
    height: 28,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraLens: {
    width: 14,
    height: 14,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.black,
  },
  captureTitle: {
    ...typography.sectionTitle,
    fontSize: 32,
    lineHeight: 40,
  },
  captureSubtitle: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
});

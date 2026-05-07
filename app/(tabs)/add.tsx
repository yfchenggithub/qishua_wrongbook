import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  BrandHeader,
  CardContainer,
  PrimaryButton,
  ScreenContainer,
  SectionTitle,
  TagChip,
} from '@/src/components';
import { addMistakeMock, type CaptureEntryMock } from '@/src/mocks/addMistake';
import { colors, radius, spacing, typography } from '@/src/styles/tokens';

function IntroIconPlaceholder() {
  return (
    <View style={styles.introIconBox}>
      <View style={styles.introDocShape}>
        <View style={styles.introDocLine} />
        <View style={styles.introDocLineShort} />
        <View style={styles.introDocLine} />
      </View>
      <View style={styles.introPlusCircle}>
        <Text style={styles.introPlusText}>+</Text>
      </View>
    </View>
  );
}

function CapturePlaceholder() {
  return (
    <View style={styles.capturePlaceholder}>
      <View style={styles.cameraBody}>
        <View style={styles.cameraLens} />
      </View>
      <Text style={styles.capturePlaceholderText}>点击拍照</Text>
    </View>
  );
}

function CaptureEntryCard({ item }: { item: CaptureEntryMock }) {
  return (
    <Pressable
      onPress={() => Alert.alert('占位提示', `${item.title}：暂未接入相机`)}
      style={styles.capturePressable}>
      <CardContainer style={styles.captureCard} padding={spacing.lg}>
        <View style={styles.captureRow}>
          <CapturePlaceholder />

          <View style={styles.captureMain}>
            <Text style={styles.captureTitle}>{item.title}</Text>
            <Text style={styles.captureSubtitle}>{item.subtitle}</Text>
          </View>

          <Text style={styles.captureArrow}>›</Text>
        </View>
      </CardContainer>
    </Pressable>
  );
}

export default function AddScreen() {
  return (
    <ScreenContainer scroll contentStyle={styles.screenContent}>
      <BrandHeader title={addMistakeMock.brand.title} subtitle={addMistakeMock.brand.subtitle} />

      <View style={styles.sectionBlock}>
        <SectionTitle title={addMistakeMock.sectionTitle} />

        <CardContainer style={styles.introCard} padding={spacing.lg}>
          <View style={styles.introRow}>
            <IntroIconPlaceholder />
            <View style={styles.introTextWrap}>
              <Text style={styles.introTitle}>{addMistakeMock.introCard.title}</Text>
              <Text style={styles.introSubtitle}>{addMistakeMock.introCard.subtitle}</Text>
            </View>
          </View>
        </CardContainer>

        <View style={styles.captureList}>
          {addMistakeMock.captureEntries.map((entry) => (
            <CaptureEntryCard key={entry.id} item={entry} />
          ))}
        </View>
      </View>

      <View style={styles.sectionBlock}>
        <SectionTitle title={addMistakeMock.tagTitle} />
        <View style={styles.tagsRow}>
          {addMistakeMock.tags.map((tag) => (
            <TagChip key={tag} label={tag} />
          ))}
        </View>
      </View>

      <PrimaryButton
        title={addMistakeMock.submitText}
        onPress={() => Alert.alert('占位提示', '当前仅展示 UI，未接入保存逻辑')}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    paddingTop: spacing.lg,
    gap: spacing.xl,
  },
  sectionBlock: {
    gap: spacing.md,
  },
  introCard: {
    borderRadius: radius.xl,
  },
  introRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  introIconBox: {
    width: 78,
    height: 78,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    justifyContent: 'center',
    alignItems: 'center',
  },
  introDocShape: {
    width: 40,
    height: 48,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.xs,
    gap: spacing.xs,
  },
  introDocLine: {
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.textMuted,
  },
  introDocLineShort: {
    width: 22,
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.textMuted,
  },
  introPlusCircle: {
    position: 'absolute',
    right: spacing.xs,
    bottom: spacing.xs,
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: colors.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
  introPlusText: {
    color: colors.white,
    fontSize: 16,
    lineHeight: 16,
    fontWeight: '700',
  },
  introTextWrap: {
    flex: 1,
    gap: spacing.xs,
  },
  introTitle: {
    ...typography.sectionTitle,
    fontSize: 20,
    lineHeight: 28,
  },
  introSubtitle: {
    ...typography.body,
  },
  captureList: {
    gap: spacing.md,
  },
  capturePressable: {
    borderRadius: radius.xl,
  },
  captureCard: {
    borderRadius: radius.xl,
    minHeight: 160,
    justifyContent: 'center',
  },
  captureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  capturePlaceholder: {
    width: 102,
    height: 102,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#D9DCE1',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  },
  cameraBody: {
    width: 40,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: colors.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraLens: {
    width: 16,
    height: 16,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.white,
  },
  capturePlaceholderText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  captureMain: {
    flex: 1,
    gap: spacing.xs,
  },
  captureTitle: {
    ...typography.sectionTitle,
    fontSize: 20,
    lineHeight: 28,
  },
  captureSubtitle: {
    ...typography.body,
  },
  captureArrow: {
    ...typography.body,
    fontSize: 28,
    lineHeight: 28,
    color: colors.textMuted,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});

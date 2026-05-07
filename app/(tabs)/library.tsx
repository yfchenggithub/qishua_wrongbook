import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  BrandHeader,
  CardContainer,
  ProgressDots,
  ScreenContainer,
  SegmentControl,
  StatusPill,
} from '@/src/components';
import { libraryMock, type LibraryFilterValue, type LibraryMistakeMock } from '@/src/mocks/library';
import { colors, radius, spacing, typography } from '@/src/styles/tokens';

function ThumbnailPlaceholder() {
  return (
    <View style={styles.thumb}>
      <View style={styles.thumbAxisX} />
      <View style={styles.thumbAxisY} />
      <View style={styles.thumbCurve} />
    </View>
  );
}

function MistakeLibraryCard({
  item,
  onPress,
}: {
  item: LibraryMistakeMock;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.cardPressable}>
      <CardContainer padding={spacing.lg} style={styles.card}>
        <View style={styles.cardRow}>
          <ThumbnailPlaceholder />

          <View style={styles.cardMain}>
            <View style={styles.cardTopLine}>
              <Text style={styles.cardMeta}>
                {item.code} · {item.module}
              </Text>
              <Text style={styles.arrow}>›</Text>
            </View>

            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardSource}>{item.source}</Text>

            <Text style={styles.progressLabel}>进度：{item.progressLabel}</Text>

            <View style={styles.progressRow}>
              <ProgressDots
                total={item.progress.total}
                current={item.progress.current}
                completed={item.progress.completed}
              />
              <StatusPill label={item.statusLabel} tone={item.statusTone} />
            </View>
          </View>
        </View>
      </CardContainer>
    </Pressable>
  );
}

export default function LibraryScreen() {
  const router = useRouter();
  const [searchText, setSearchText] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<LibraryFilterValue>('all');

  return (
    <ScreenContainer scroll contentStyle={styles.screenContent}>
      <BrandHeader title={libraryMock.brand.title} subtitle={libraryMock.brand.subtitle} />

      <View style={styles.searchWrap}>
        <MaterialIcons size={24} name="search" color={colors.textMuted} />
        <TextInput
          value={searchText}
          onChangeText={setSearchText}
          placeholder={libraryMock.searchPlaceholder}
          placeholderTextColor={colors.textMuted}
          style={styles.searchInput}
        />
      </View>

      <SegmentControl
        options={libraryMock.filters}
        value={selectedFilter}
        onChange={(next) => setSelectedFilter(next as LibraryFilterValue)}
      />

      <View style={styles.listWrap}>
        {libraryMock.mistakes.map((item) => (
          <MistakeLibraryCard
            key={item.id}
            item={item}
            onPress={() => router.push(`/mistake/${item.routeId}` as never)}
          />
        ))}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    paddingTop: spacing.lg,
    gap: spacing.xl,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    minHeight: 60,
    paddingHorizontal: spacing.md,
  },
  searchInput: {
    flex: 1,
    ...typography.body,
    color: colors.textPrimary,
    paddingVertical: spacing.sm,
  },
  listWrap: {
    gap: spacing.md,
  },
  cardPressable: {
    borderRadius: radius.xl,
  },
  card: {
    borderRadius: radius.xl,
  },
  cardRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  cardMain: {
    flex: 1,
    gap: spacing.xs,
  },
  cardTopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardMeta: {
    ...typography.body,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  arrow: {
    ...typography.body,
    color: colors.textMuted,
    fontSize: 24,
    lineHeight: 24,
  },
  cardTitle: {
    ...typography.sectionTitle,
    fontSize: 20,
    lineHeight: 28,
  },
  cardSource: {
    ...typography.body,
    color: colors.textSecondary,
  },
  progressLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  progressRow: {
    marginTop: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  thumb: {
    width: 112,
    height: 112,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbAxisX: {
    position: 'absolute',
    width: 76,
    height: 1.5,
    backgroundColor: '#8E949D',
  },
  thumbAxisY: {
    position: 'absolute',
    width: 1.5,
    height: 76,
    backgroundColor: '#8E949D',
  },
  thumbCurve: {
    width: 54,
    height: 40,
    borderWidth: 1.5,
    borderColor: '#8E949D',
    borderRadius: radius.pill,
    transform: [{ rotate: '-18deg' }],
  },
});


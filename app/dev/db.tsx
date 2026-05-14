import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { checkDatabaseHealth, initDatabase, resetDatabaseForDev } from '@/src/db';
import type { DatabaseHealthReport } from '@/src/db/database';
import { MAX_REVIEW_COUNT, REVIEW_STATUS } from '@/src/constants/review';
import type { Mistake } from '@/src/models/Mistake';
import type { MistakeImage } from '@/src/models/MistakeImage';
import type { ReviewRecord } from '@/src/models/ReviewRecord';
import { MistakeImageRepository, MistakeRepository, ReviewRecordRepository } from '@/src/repositories';
import type { MistakeStats } from '@/src/repositories';
import { getImageInfo } from '@/src/services/ImageStorageService';
import { Logger } from '@/src/services/Logger';

const PAGE_SCOPE = 'DevDbPage';

type MistakeDebugItem = {
  id: string;
  title?: string | null;
  module: string;
  error_reason?: string | null;
  difficulty: number;
  review_count: number;
  status: string;
  next_review_at?: string | null;
  last_review_at?: string | null;
  last_review_result?: string | null;
  created_at: string;
  updated_at: string;
  question_count: number;
  my_solution_count: number;
  answer_count: number;
  review_solution_count: number;
  cover_uri?: string | null;
};

type MistakeImageDebugItem = {
  id: string;
  review_record_id?: string | null;
  type: string;
  uri: string;
  sort_order: number;
  created_at: string;
  exists: boolean;
  fileSize?: number | null;
};

type ReviewRecordDebugItem = {
  id: string;
  review_index: number;
  result: string | null;
  note?: string | null;
  created_at: string;
  review_solution_count: number;
};

type ImageExistenceCheck = {
  source: string;
  label: string;
  uri: string;
  exists: boolean;
  size: number | null;
};

type ConsistencyCheckLevel = 'pass' | 'fail' | 'warn';

type ConsistencyCheckItem = {
  key: string;
  label: string;
  level: ConsistencyCheckLevel;
  message: string;
};

type MistakeConsistencyReport = {
  mistake: Mistake;
  reviewRecords: ReviewRecordDebugItem[];
  mistakeImages: MistakeImageDebugItem[];
  imageChecks: ImageExistenceCheck[];
  checks: ConsistencyCheckItem[];
  generatedAt: string;
};

type ActionType =
  | 'init'
  | 'health'
  | 'insert'
  | 'list-recent'
  | 'images'
  | 'consistency'
  | 'stats'
  | 'reset'
  | null;

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function formatNullable(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') {
    return '(empty)';
  }
  return String(value);
}

function hasNonEmptyText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeMistakeId(id: string): string | null {
  const normalized = typeof id === 'string' ? id.trim() : '';
  return normalized.length > 0 ? normalized : null;
}

function toShortUri(uri: string | null | undefined): string {
  if (!hasNonEmptyText(uri)) {
    return '(empty)';
  }

  const trimmed = uri!.trim();
  if (trimmed.length <= 72) {
    return trimmed;
  }

  return `${trimmed.slice(0, 30)}...${trimmed.slice(-24)}`;
}

function buildExpectedReviewIndices(reviewCount: number): number[] {
  if (reviewCount <= 0) {
    return [];
  }

  return Array.from({ length: reviewCount }, (_, index) => index + 1);
}

function buildConsistencyChecks(
  mistake: Mistake,
  reviewRecords: ReviewRecordDebugItem[],
  mistakeImages: MistakeImageDebugItem[],
  imageChecks: ImageExistenceCheck[],
): ConsistencyCheckItem[] {
  const checks: ConsistencyCheckItem[] = [];

  const countMatches = reviewRecords.length === mistake.review_count;
  checks.push({
    key: 'count-match',
    label: 'review_count equals review_records count',
    level: countMatches ? 'pass' : 'fail',
    message: countMatches
      ? `pass: ${mistake.review_count} = ${reviewRecords.length}`
      : `fail: review_count=${mistake.review_count}, review_records=${reviewRecords.length}`,
  });

  const expectedIndices = buildExpectedReviewIndices(mistake.review_count);
  const actualIndices = reviewRecords.map((item) => item.review_index).sort((a, b) => a - b);
  const indexContinuous =
    expectedIndices.length === actualIndices.length &&
    expectedIndices.every((expected, index) => actualIndices[index] === expected);

  checks.push({
    key: 'index-continuity',
    label: 'review_index continuity',
    level: indexContinuous ? 'pass' : 'fail',
    message: indexContinuous
      ? `pass: ${actualIndices.length === 0 ? '(empty)' : actualIndices.join(', ')}`
      : `fail: expected=${expectedIndices.join(', ') || '(empty)'}, actual=${actualIndices.join(', ') || '(empty)'}`,
  });

  if (mistake.status === REVIEW_STATUS.MASTERED) {
    const masteredReviewCountOk = mistake.review_count === MAX_REVIEW_COUNT;
    const masteredNextReviewAtOk = mistake.next_review_at === null;
    const masteredRulePassed = masteredReviewCountOk && masteredNextReviewAtOk;

    checks.push({
      key: 'mastered-rule',
      label: 'mastered status rule',
      level: masteredRulePassed ? 'pass' : 'fail',
      message: masteredRulePassed
        ? 'pass: review_count=7 and next_review_at=null'
        : `fail: review_count=${mistake.review_count}, next_review_at=${formatNullable(mistake.next_review_at)}`,
    });
  } else {
    checks.push({
      key: 'mastered-rule',
      label: 'mastered status rule',
      level: 'pass',
      message: `pass: skipped, current status=${mistake.status}`,
    });
  }

  if (mistake.status === REVIEW_STATUS.ACTIVE) {
    const activeRulePassed = mistake.review_count < MAX_REVIEW_COUNT;
    checks.push({
      key: 'active-rule',
      label: 'active status rule',
      level: activeRulePassed ? 'pass' : 'fail',
      message: activeRulePassed
        ? `pass: review_count=${mistake.review_count} < ${MAX_REVIEW_COUNT}`
        : `fail: active with review_count=${mistake.review_count}`,
    });
  } else {
    checks.push({
      key: 'active-rule',
      label: 'active status rule',
      level: 'pass',
      message: `pass: skipped, current status=${mistake.status}`,
    });
  }

  const nonReviewWithBinding = mistakeImages.filter(
    (item) =>
      (item.type === 'question' || item.type === 'my_solution' || item.type === 'answer') &&
      hasNonEmptyText(item.review_record_id ?? null),
  );
  checks.push({
    key: 'non-review-binding',
    label: 'question/my_solution/answer must not bind review_record_id',
    level: nonReviewWithBinding.length > 0 ? 'fail' : 'pass',
    message:
      nonReviewWithBinding.length > 0
        ? `fail: found ${nonReviewWithBinding.length} image(s) with unexpected review_record_id`
        : 'pass',
  });

  const reviewSolutionMissingBinding = mistakeImages.filter(
    (item) => item.type === 'review_solution' && !hasNonEmptyText(item.review_record_id ?? null),
  );
  checks.push({
    key: 'review-solution-binding',
    label: 'review_solution must bind review_record_id',
    level: reviewSolutionMissingBinding.length > 0 ? 'fail' : 'pass',
    message:
      reviewSolutionMissingBinding.length > 0
        ? `fail: found ${reviewSolutionMissingBinding.length} unbound review_solution image(s)`
        : 'pass',
  });

  const missingReviewSolutionImageIndexes = reviewRecords
    .filter((record) => record.review_solution_count <= 0)
    .map((record) => record.review_index);
  checks.push({
    key: 'review-record-image-link',
    label: 'each review_record has bound review_solution images',
    level: missingReviewSolutionImageIndexes.length > 0 ? 'warn' : 'pass',
    message:
      missingReviewSolutionImageIndexes.length > 0
        ? `warn: review_index=${missingReviewSolutionImageIndexes.join(', ')} has no review_solution image`
        : 'pass',
  });

  const missingLocalFiles = imageChecks.filter((item) => !item.exists);
  checks.push({
    key: 'local-file-exists',
    label: 'all image URIs have local files',
    level: missingLocalFiles.length > 0 ? 'warn' : 'pass',
    message:
      missingLocalFiles.length > 0
        ? `warn: ${missingLocalFiles.length} URI(s) missing local files`
        : 'pass',
  });

  return checks;
}

async function buildMistakeImageDebugItems(images: MistakeImage[]): Promise<MistakeImageDebugItem[]> {
  return Promise.all(
    images.map(async (image) => {
      const info = await getImageInfo(image.uri);
      return {
        id: image.id,
        review_record_id: image.review_record_id ?? null,
        type: image.type,
        uri: image.uri,
        sort_order: image.sort_order,
        created_at: image.created_at,
        exists: info.exists,
        fileSize: info.size ?? null,
      };
    }),
  );
}

async function buildReviewRecordDebugItems(records: ReviewRecord[]): Promise<ReviewRecordDebugItem[]> {
  return Promise.all(
    records.map(async (record) => {
      const reviewSolutionImages = await MistakeImageRepository.getReviewSolutionImages(record.id);
      return {
        id: record.id,
        review_index: record.review_index,
        result: record.result,
        note: record.note ?? null,
        created_at: record.created_at,
        review_solution_count: reviewSolutionImages.length,
      };
    }),
  );
}

async function buildImageExistenceChecks(
  mistakeImages: MistakeImageDebugItem[],
): Promise<ImageExistenceCheck[]> {
  const checks: ImageExistenceCheck[] = [];

  for (const image of mistakeImages) {
    if (!hasNonEmptyText(image.uri)) {
      continue;
    }

    const info = await getImageInfo(image.uri);
    checks.push({
      source: 'mistake_images',
      label: `${image.type} (${image.id})`,
      uri: image.uri,
      exists: info.exists,
      size: info.size ?? null,
    });
  }

  return checks;
}

function getCheckTextColor(level: ConsistencyCheckLevel): string {
  if (level === 'pass') {
    return '#067647';
  }
  if (level === 'warn') {
    return '#b54708';
  }
  return '#b42318';
}

function countImagesByType(images: MistakeImage[], type: MistakeImage['type']): number {
  return images.filter((item) => item.type === type).length;
}

export default function DevDatabasePage() {
  const router = useRouter();

  const [activeAction, setActiveAction] = useState<ActionType>(null);
  const [statusMessage, setStatusMessage] = useState('Ready');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [healthReport, setHealthReport] = useState<DatabaseHealthReport | null>(null);
  const [createdMistakeId, setCreatedMistakeId] = useState<string | null>(null);
  const [recentMistakes, setRecentMistakes] = useState<MistakeDebugItem[]>([]);
  const [selectedMistakeId, setSelectedMistakeId] = useState<string | null>(null);
  const [mistakeImages, setMistakeImages] = useState<MistakeImageDebugItem[]>([]);
  const [stats, setStats] = useState<MistakeStats | null>(null);
  const [pendingResetConfirm, setPendingResetConfirm] = useState(false);
  const [consistencyReport, setConsistencyReport] = useState<MistakeConsistencyReport | null>(null);

  const isBusy = activeAction !== null;

  const actionLabel = useMemo(() => {
    switch (activeAction) {
      case 'init':
        return 'Initializing database...';
      case 'health':
        return 'Running health check...';
      case 'insert':
        return 'Inserting sample mistake...';
      case 'list-recent':
        return 'Loading recent mistakes...';
      case 'images':
        return 'Loading mistake images...';
      case 'consistency':
        return 'Running consistency checks...';
      case 'stats':
        return 'Loading stats...';
      case 'reset':
        return 'Resetting development database...';
      default:
        return '';
    }
  }, [activeAction]);

  async function runAction(action: Exclude<ActionType, null>, handler: () => Promise<void>) {
    setActiveAction(action);
    setErrorMessage(null);
    try {
      await handler();
    } catch (error) {
      Logger.error(PAGE_SCOPE, `${action} action failed.`, error);
      setErrorMessage(formatError(error));
      setStatusMessage(`${action} failed`);
    } finally {
      setActiveAction(null);
    }
  }

  function resetPendingConfirmState() {
    setPendingResetConfirm(false);
  }

  async function handleInitDatabase() {
    await runAction('init', async () => {
      await initDatabase();
      setStatusMessage('Database initialized');
      resetPendingConfirmState();
    });
  }

  async function handleHealthCheck() {
    await runAction('health', async () => {
      const report = await checkDatabaseHealth();
      setHealthReport(report);
      setStatusMessage('Health check completed');
      resetPendingConfirmState();
    });
  }

  async function handleInsertSampleMistake() {
    await runAction('insert', async () => {
      const created = await MistakeRepository.createMistake({
        module: 'conic',
        title: 'sample mistake',
        error_reason: 'dev debug seed',
        difficulty: 3,
        note: 'created from dev db page',
      });
      await MistakeImageRepository.insertMistakeImages(created.id, [
        {
          type: 'question',
          uri: `file://dev-sample/${created.id}/question-0.jpg`,
          sort_order: 0,
        },
      ]);
      setCreatedMistakeId(created.id);
      setStatusMessage(`Sample mistake inserted with one question image: ${created.id}`);
      resetPendingConfirmState();
    });
  }

  async function handleListRecentMistakes() {
    await runAction('list-recent', async () => {
      const rows = await MistakeRepository.listMistakes({
        limit: 10,
        offset: 0,
        sortBy: 'created_at',
        sortOrder: 'desc',
      });

      const items = await Promise.all(
        rows.map(async (row) => {
          const images = await MistakeImageRepository.getImagesByMistakeId(row.id);
          const cover = await MistakeImageRepository.getCoverImageForMistake(row.id);
          return {
            id: row.id,
            title: row.title,
            module: row.module,
            error_reason: row.error_reason,
            difficulty: row.difficulty,
            review_count: row.review_count,
            status: row.status,
            next_review_at: row.next_review_at,
            last_review_at: row.last_review_at,
            last_review_result: row.last_review_result ?? null,
            created_at: row.created_at,
            updated_at: row.updated_at,
            question_count: countImagesByType(images, 'question'),
            my_solution_count: countImagesByType(images, 'my_solution'),
            answer_count: countImagesByType(images, 'answer'),
            review_solution_count: countImagesByType(images, 'review_solution'),
            cover_uri: cover?.uri ?? null,
          };
        }),
      );

      setRecentMistakes(items);
      setStatusMessage(`Loaded ${rows.length} mistake(s)`);
      resetPendingConfirmState();
    });
  }

  function handleOpenMistakeDetail(mistakeId: string) {
    const routeId = normalizeMistakeId(mistakeId);
    if (!routeId) {
      Logger.warn(PAGE_SCOPE, 'Skip opening detail because mistake id is empty.', { mistakeId });
      return;
    }

    router.push(`/mistake/${routeId}` as never);
  }

  function handleOpenReviewPage(mistakeId: string) {
    const routeId = normalizeMistakeId(mistakeId);
    if (!routeId) {
      Logger.warn(PAGE_SCOPE, 'Skip opening review because mistake id is empty.', { mistakeId });
      return;
    }

    router.push(`/review/${routeId}` as never);
  }

  async function handleLoadImagesByMistakeId(mistakeId: string) {
    await runAction('images', async () => {
      const rows = await MistakeImageRepository.getImagesByMistakeId(mistakeId);
      const items = await buildMistakeImageDebugItems(rows);

      setSelectedMistakeId(mistakeId);
      setMistakeImages(items);
      setStatusMessage(`Loaded ${items.length} image record(s) for ${mistakeId}`);
      resetPendingConfirmState();
    });
  }

  async function handleCheckMistakeConsistency(mistakeId: string) {
    await runAction('consistency', async () => {
      const mistake = await MistakeRepository.getMistakeById(mistakeId);
      if (!mistake) {
        throw new Error('Mistake not found');
      }

      const [reviewRecordsRaw, mistakeImagesRaw] = await Promise.all([
        ReviewRecordRepository.listReviewRecordsByMistakeId(mistakeId),
        MistakeImageRepository.getImagesByMistakeId(mistakeId),
      ]);

      const [reviewRecords, mistakeImageItems] = await Promise.all([
        buildReviewRecordDebugItems(reviewRecordsRaw),
        buildMistakeImageDebugItems(mistakeImagesRaw),
      ]);

      const imageChecks = await buildImageExistenceChecks(mistakeImageItems);
      const checks = buildConsistencyChecks(mistake, reviewRecords, mistakeImageItems, imageChecks);

      const report: MistakeConsistencyReport = {
        mistake,
        reviewRecords,
        mistakeImages: mistakeImageItems,
        imageChecks,
        checks,
        generatedAt: new Date().toISOString(),
      };

      setSelectedMistakeId(mistakeId);
      setMistakeImages(mistakeImageItems);
      setConsistencyReport(report);

      const failCount = checks.filter((item) => item.level === 'fail').length;
      const warnCount = checks.filter((item) => item.level === 'warn').length;
      setStatusMessage(`Consistency checks completed: fail ${failCount}, warn ${warnCount}`);
      resetPendingConfirmState();
    });
  }

  async function handleGetStats() {
    await runAction('stats', async () => {
      const result = await MistakeRepository.getMistakeStats();
      setStats(result);
      setStatusMessage('Stats loaded');
      resetPendingConfirmState();
    });
  }

  async function handleResetDatabase() {
    if (!pendingResetConfirm) {
      setPendingResetConfirm(true);
      setStatusMessage('Click "Reset Development Data" again to confirm');
      return;
    }

    await runAction('reset', async () => {
      await resetDatabaseForDev();
      await initDatabase();

      setHealthReport(null);
      setCreatedMistakeId(null);
      setRecentMistakes([]);
      setSelectedMistakeId(null);
      setMistakeImages([]);
      setStats(null);
      setConsistencyReport(null);
      setPendingResetConfirm(false);
      setStatusMessage('Development database reset completed');
    });
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <Stack.Screen options={{ title: 'Database Debug', headerShown: false }} />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backButtonText}>Back</Text>
          </Pressable>
          <Text style={styles.pageTitle}>Database Debug</Text>
        </View>

        <Text style={styles.devOnlyText}>Development only</Text>

        {isBusy ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color="#111111" />
            <Text style={styles.loadingText}>{actionLabel}</Text>
          </View>
        ) : null}

        <View style={styles.buttonGroup}>
          <Pressable style={styles.actionButton} onPress={handleInitDatabase} disabled={isBusy}>
            <Text style={styles.actionButtonText}>Init Database</Text>
          </Pressable>

          <Pressable style={styles.actionButton} onPress={handleHealthCheck} disabled={isBusy}>
            <Text style={styles.actionButtonText}>Health Check</Text>
          </Pressable>

          <Pressable style={styles.actionButton} onPress={handleInsertSampleMistake} disabled={isBusy}>
            <Text style={styles.actionButtonText}>Insert Sample Mistake</Text>
          </Pressable>

          <Pressable style={styles.actionButton} onPress={handleListRecentMistakes} disabled={isBusy}>
            <Text style={styles.actionButtonText}>Load Recent 10 Mistakes</Text>
          </Pressable>

          <Pressable style={styles.actionButton} onPress={handleGetStats} disabled={isBusy}>
            <Text style={styles.actionButtonText}>Load Stats</Text>
          </Pressable>

          <Pressable
            style={[
              styles.actionButton,
              styles.dangerButton,
              pendingResetConfirm && styles.dangerButtonConfirm,
            ]}
            onPress={handleResetDatabase}
            disabled={isBusy}>
            <Text style={styles.actionButtonText}>
              {pendingResetConfirm ? 'Confirm Reset Development Data' : 'Reset Development Data'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Status</Text>
          <Text style={styles.monoText}>{statusMessage}</Text>
          {errorMessage ? <Text style={styles.errorText}>Error: {errorMessage}</Text> : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Health Report</Text>
          {healthReport ? (
            <>
              <Text style={styles.monoText}>ok: {String(healthReport.ok)}</Text>
              <Text style={styles.monoText}>version: {healthReport.version}</Text>
              <Text style={styles.monoText}>tables: {healthReport.tables.join(', ') || '(empty)'}</Text>
              <Text style={styles.monoText}>message: {healthReport.message}</Text>
            </>
          ) : (
            <Text style={styles.placeholderText}>No health report yet</Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Latest Inserted Sample Mistake ID</Text>
          <Text style={styles.monoText}>{createdMistakeId ?? '(none)'}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Mistakes (10)</Text>
          {recentMistakes.length === 0 ? (
            <Text style={styles.placeholderText}>No data</Text>
          ) : (
            recentMistakes.map((item) => (
              <View key={item.id} style={styles.listItem}>
                <Text style={styles.monoText}>id: {item.id}</Text>
                <Text style={styles.monoText}>title: {formatNullable(item.title)}</Text>
                <Text style={styles.monoText}>module: {formatNullable(item.module)}</Text>
                <Text style={styles.monoText}>error_reason: {formatNullable(item.error_reason)}</Text>
                <Text style={styles.monoText}>difficulty: {formatNullable(item.difficulty)}</Text>
                <Text style={styles.monoText}>review_count: {formatNullable(item.review_count)}</Text>
                <Text style={styles.monoText}>status: {formatNullable(item.status)}</Text>
                <Text style={styles.monoText}>next_review_at: {formatNullable(item.next_review_at)}</Text>
                <Text style={styles.monoText}>last_review_at: {formatNullable(item.last_review_at)}</Text>
                <Text style={styles.monoText}>last_review_result: {formatNullable(item.last_review_result)}</Text>
                <Text style={styles.monoText}>question_count: {item.question_count}</Text>
                <Text style={styles.monoText}>my_solution_count: {item.my_solution_count}</Text>
                <Text style={styles.monoText}>answer_count: {item.answer_count}</Text>
                <Text style={styles.monoText}>review_solution_count: {item.review_solution_count}</Text>
                <Text style={styles.monoText}>cover_uri: {toShortUri(item.cover_uri)}</Text>
                <Text style={styles.monoText}>created_at: {formatNullable(item.created_at)}</Text>
                <Text style={styles.monoText}>updated_at: {formatNullable(item.updated_at)}</Text>

                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => handleOpenMistakeDetail(item.id)}
                  disabled={isBusy}>
                  <Text style={styles.secondaryButtonText}>Open Detail</Text>
                </Pressable>

                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => handleOpenReviewPage(item.id)}
                  disabled={isBusy}>
                  <Text style={styles.secondaryButtonText}>Open Review</Text>
                </Pressable>

                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => {
                    void handleLoadImagesByMistakeId(item.id);
                  }}
                  disabled={isBusy}>
                  <Text style={styles.secondaryButtonText}>Load Mistake Images</Text>
                </Pressable>

                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => {
                    void handleCheckMistakeConsistency(item.id);
                  }}
                  disabled={isBusy}>
                  <Text style={styles.secondaryButtonText}>Run Consistency Check</Text>
                </Pressable>
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Image Records{selectedMistakeId ? ` (mistake_id: ${selectedMistakeId})` : ''}
          </Text>
          {!selectedMistakeId ? (
            <Text style={styles.placeholderText}>Select a mistake above first</Text>
          ) : mistakeImages.length === 0 ? (
            <Text style={styles.placeholderText}>No image records for this mistake</Text>
          ) : (
            mistakeImages.map((item) => (
              <View key={item.id} style={styles.listItem}>
                <Text style={styles.monoText}>id: {item.id}</Text>
                <Text style={styles.monoText}>type: {item.type}</Text>
                <Text style={styles.monoText}>review_record_id: {formatNullable(item.review_record_id)}</Text>
                <Text style={styles.monoText}>uri: {toShortUri(item.uri)}</Text>
                <Text style={styles.monoText}>sort_order: {item.sort_order}</Text>
                <Text style={styles.monoText}>created_at: {item.created_at}</Text>
                <Text style={styles.monoText}>exists: {String(item.exists)}</Text>
                <Text style={styles.monoText}>size: {item.fileSize ?? '(unknown)'}</Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Single Mistake Consistency Report</Text>
          {!consistencyReport ? (
            <Text style={styles.placeholderText}>Run Consistency Check from a mistake card above</Text>
          ) : (
            <>
              <Text style={styles.monoText}>generated_at: {consistencyReport.generatedAt}</Text>

              <View style={styles.subSection}>
                <Text style={styles.subSectionTitle}>1) mistakes row</Text>
                <Text style={styles.monoText}>id: {consistencyReport.mistake.id}</Text>
                <Text style={styles.monoText}>review_count: {consistencyReport.mistake.review_count}</Text>
                <Text style={styles.monoText}>status: {consistencyReport.mistake.status}</Text>
                <Text style={styles.monoText}>
                  next_review_at: {formatNullable(consistencyReport.mistake.next_review_at)}
                </Text>
                <Text style={styles.monoText}>
                  last_review_at: {formatNullable(consistencyReport.mistake.last_review_at)}
                </Text>
                <Text style={styles.monoText}>
                  last_review_result: {formatNullable(consistencyReport.mistake.last_review_result)}
                </Text>
              </View>

              <View style={styles.subSection}>
                <Text style={styles.subSectionTitle}>2) review_records list</Text>
                {consistencyReport.reviewRecords.length === 0 ? (
                  <Text style={styles.placeholderText}>No review records</Text>
                ) : (
                  consistencyReport.reviewRecords.map((item) => (
                    <View key={item.id} style={styles.listItem}>
                      <Text style={styles.monoText}>id: {item.id}</Text>
                      <Text style={styles.monoText}>review_index: {item.review_index}</Text>
                      <Text style={styles.monoText}>result: {formatNullable(item.result)}</Text>
                      <Text style={styles.monoText}>note: {formatNullable(item.note)}</Text>
                      <Text style={styles.monoText}>created_at: {item.created_at}</Text>
                      <Text style={styles.monoText}>
                        review_solution_count: {item.review_solution_count}
                      </Text>
                    </View>
                  ))
                )}
              </View>

              <View style={styles.subSection}>
                <Text style={styles.subSectionTitle}>3) mistake_images list</Text>
                {consistencyReport.mistakeImages.length === 0 ? (
                  <Text style={styles.placeholderText}>No image records</Text>
                ) : (
                  consistencyReport.mistakeImages.map((item) => (
                    <View key={item.id} style={styles.listItem}>
                      <Text style={styles.monoText}>type: {item.type}</Text>
                      <Text style={styles.monoText}>review_record_id: {formatNullable(item.review_record_id)}</Text>
                      <Text style={styles.monoText}>uri: {toShortUri(item.uri)}</Text>
                      <Text style={styles.monoText}>sort_order: {item.sort_order}</Text>
                      <Text style={styles.monoText}>created_at: {item.created_at}</Text>
                      <Text style={styles.monoText}>exists: {String(item.exists)}</Text>
                      <Text style={styles.monoText}>size: {item.fileSize ?? '(unknown)'}</Text>
                    </View>
                  ))
                )}
              </View>

              <View style={styles.subSection}>
                <Text style={styles.subSectionTitle}>4) image file existence</Text>
                {consistencyReport.imageChecks.length === 0 ? (
                  <Text style={styles.placeholderText}>No image URIs to check</Text>
                ) : (
                  consistencyReport.imageChecks.map((item, index) => (
                    <View key={`${item.source}-${item.label}-${index}`} style={styles.listItem}>
                      <Text style={styles.monoText}>source: {item.source}</Text>
                      <Text style={styles.monoText}>label: {item.label}</Text>
                      <Text style={styles.monoText}>uri: {toShortUri(item.uri)}</Text>
                      <Text style={styles.monoText}>exists: {String(item.exists)}</Text>
                      <Text style={styles.monoText}>size: {item.size ?? '(unknown)'}</Text>
                    </View>
                  ))
                )}
              </View>

              <View style={styles.subSection}>
                <Text style={styles.subSectionTitle}>5) rule checks</Text>
                {consistencyReport.checks.map((item) => (
                  <View key={item.key} style={styles.checkItem}>
                    <Text style={[styles.checkLabel, { color: getCheckTextColor(item.level) }]}>
                      {item.level === 'pass' ? 'PASS' : item.level === 'warn' ? 'WARN' : 'FAIL'} -{' '}
                      {item.label}
                    </Text>
                    <Text style={[styles.monoText, { color: getCheckTextColor(item.level) }]}>
                      {item.message}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Stats</Text>
          {stats ? (
            <>
              <Text style={styles.monoText}>total: {stats.total}</Text>
              <Text style={styles.monoText}>active: {stats.active}</Text>
              <Text style={styles.monoText}>mastered: {stats.mastered}</Text>
              <Text style={styles.monoText}>dueToday: {stats.dueToday}</Text>
            </>
          ) : (
            <Text style={styles.placeholderText}>No stats loaded yet</Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  container: {
    padding: 16,
    gap: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backButton: {
    borderWidth: 1,
    borderColor: '#d0d0d0',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  backButtonText: {
    color: '#111111',
    fontSize: 14,
    fontWeight: '600',
  },
  pageTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111111',
  },
  devOnlyText: {
    color: '#8a1c1c',
    fontSize: 13,
    fontWeight: '600',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ffffff',
    borderRadius: 10,
    padding: 12,
  },
  loadingText: {
    color: '#333333',
    fontSize: 13,
  },
  buttonGroup: {
    gap: 8,
  },
  actionButton: {
    backgroundColor: '#111111',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  actionButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  dangerButton: {
    backgroundColor: '#8a1c1c',
  },
  dangerButtonConfirm: {
    backgroundColor: '#c0392b',
  },
  section: {
    backgroundColor: '#ffffff',
    borderRadius: 10,
    padding: 12,
    gap: 6,
    borderWidth: 1,
    borderColor: '#e5e5e5',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111111',
  },
  subSection: {
    gap: 6,
    marginTop: 6,
  },
  subSectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111111',
  },
  monoText: {
    color: '#222222',
    fontSize: 13,
    fontFamily: 'monospace',
  },
  placeholderText: {
    color: '#666666',
    fontSize: 13,
  },
  errorText: {
    color: '#b42318',
    fontSize: 13,
    fontWeight: '600',
  },
  listItem: {
    borderWidth: 1,
    borderColor: '#e8e8e8',
    borderRadius: 8,
    padding: 10,
    gap: 4,
  },
  checkItem: {
    borderWidth: 1,
    borderColor: '#e8e8e8',
    borderRadius: 8,
    padding: 10,
    gap: 4,
  },
  checkLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: '#f2f2f2',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#dcdcdc',
    alignSelf: 'flex-start',
    marginTop: 6,
  },
  secondaryButtonText: {
    color: '#111111',
    fontSize: 12,
    fontWeight: '600',
  },
});

import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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
  question_image_uri?: string | null;
  answer_image_uri?: string | null;
  question_image_has_value: boolean;
  answer_image_has_value: boolean;
  question_image_exists: boolean | null;
  answer_image_exists: boolean | null;
  created_at: string;
  updated_at: string;
};

type MistakeImageDebugItem = {
  id: string;
  type: string;
  uri: string;
  created_at: string;
  exists: boolean;
  fileSize?: number | null;
};

type ReviewRecordDebugItem = {
  id: string;
  review_index: number;
  solution_image_uri?: string | null;
  result: string;
  created_at: string;
  solution_exists: boolean | null;
  solution_file_size: number | null;
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
    return '(空)';
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
    return '(空)';
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
    label: 'review_count 与 review_records 数量',
    level: countMatches ? 'pass' : 'fail',
    message: countMatches
      ? `通过（${mistake.review_count} = ${reviewRecords.length}）`
      : `失败：review_count=${mistake.review_count}，review_records=${reviewRecords.length}`,
  });

  const expectedIndices = buildExpectedReviewIndices(mistake.review_count);
  const actualIndices = reviewRecords.map((item) => item.review_index).sort((a, b) => a - b);
  const indexContinuous =
    expectedIndices.length === actualIndices.length &&
    expectedIndices.every((expected, index) => actualIndices[index] === expected);

  checks.push({
    key: 'index-continuity',
    label: 'review_index 连续性',
    level: indexContinuous ? 'pass' : 'fail',
    message: indexContinuous
      ? `通过（${actualIndices.length === 0 ? '无复做记录' : actualIndices.join(', ')}）`
      : `失败：期望 ${expectedIndices.join(', ') || '(空)'}，实际 ${actualIndices.join(', ') || '(空)'}`,
  });

  if (mistake.status === REVIEW_STATUS.MASTERED) {
    const masteredReviewCountOk = mistake.review_count === MAX_REVIEW_COUNT;
    const masteredNextReviewAtOk = mistake.next_review_at === null;
    const masteredRulePassed = masteredReviewCountOk && masteredNextReviewAtOk;

    checks.push({
      key: 'mastered-rule',
      label: 'mastered 状态规则',
      level: masteredRulePassed ? 'pass' : 'fail',
      message: masteredRulePassed
        ? '通过（review_count=7 且 next_review_at=null）'
        : `失败：review_count=${mistake.review_count}，next_review_at=${formatNullable(mistake.next_review_at)}`,
    });
  } else {
    checks.push({
      key: 'mastered-rule',
      label: 'mastered 状态规则',
      level: 'pass',
      message: `通过（当前 status=${mistake.status}，此规则不触发）`,
    });
  }

  if (mistake.status === REVIEW_STATUS.ACTIVE) {
    const activeRulePassed = mistake.review_count < MAX_REVIEW_COUNT;
    checks.push({
      key: 'active-rule',
      label: 'active 状态规则',
      level: activeRulePassed ? 'pass' : 'fail',
      message: activeRulePassed
        ? `通过（review_count=${mistake.review_count} < ${MAX_REVIEW_COUNT}）`
        : `失败：active 但 review_count=${mistake.review_count}`,
    });
  } else {
    checks.push({
      key: 'active-rule',
      label: 'active 状态规则',
      level: 'pass',
      message: `通过（当前 status=${mistake.status}，此规则不触发）`,
    });
  }

  const missingReviewSolutionImageIndexes: number[] = [];
  for (const record of reviewRecords) {
    if (!hasNonEmptyText(record.solution_image_uri)) {
      missingReviewSolutionImageIndexes.push(record.review_index);
      continue;
    }

    const matched = mistakeImages.some(
      (image) => image.type === 'review_solution' && image.uri === record.solution_image_uri,
    );
    if (!matched) {
      missingReviewSolutionImageIndexes.push(record.review_index);
    }
  }

  const hasReviewSolutionMismatch = missingReviewSolutionImageIndexes.length > 0;
  checks.push({
    key: 'review-solution-mapping',
    label: 'review_records 与 review_solution 图片映射',
    level: hasReviewSolutionMismatch ? 'fail' : 'pass',
    message: hasReviewSolutionMismatch
      ? `失败：第 ${missingReviewSolutionImageIndexes.join(', ')} 刷缺少对应 review_solution 图片记录`
      : '通过',
  });

  const missingLocalFiles = imageChecks.filter((item) => !item.exists);
  checks.push({
    key: 'local-file-exists',
    label: '数据库图片 URI 本地文件存在性',
    level: missingLocalFiles.length > 0 ? 'warn' : 'pass',
    message:
      missingLocalFiles.length > 0
        ? `警告：${missingLocalFiles.length} 条 URI 对应本地文件不存在`
        : '通过',
  });

  return checks;
}

async function buildMistakeImageDebugItems(images: MistakeImage[]): Promise<MistakeImageDebugItem[]> {
  return Promise.all(
    images.map(async (image) => {
      const info = await getImageInfo(image.uri);
      return {
        id: image.id,
        type: image.type,
        uri: image.uri,
        created_at: image.created_at,
        exists: info.exists,
        fileSize: info.size ?? null,
      };
    }),
  );
}

async function buildReviewRecordDebugItems(
  records: ReviewRecord[],
): Promise<ReviewRecordDebugItem[]> {
  return Promise.all(
    records.map(async (record) => {
      if (!hasNonEmptyText(record.solution_image_uri)) {
        return {
          id: record.id,
          review_index: record.review_index,
          solution_image_uri: record.solution_image_uri,
          result: record.result,
          created_at: record.created_at,
          solution_exists: null,
          solution_file_size: null,
        };
      }

      const info = await getImageInfo(record.solution_image_uri!);
      return {
        id: record.id,
        review_index: record.review_index,
        solution_image_uri: record.solution_image_uri,
        result: record.result,
        created_at: record.created_at,
        solution_exists: info.exists,
        solution_file_size: info.size ?? null,
      };
    }),
  );
}

async function buildImageExistenceChecks(
  mistake: Mistake,
  reviewRecords: ReviewRecordDebugItem[],
  mistakeImages: MistakeImageDebugItem[],
): Promise<ImageExistenceCheck[]> {
  const checks: ImageExistenceCheck[] = [];

  async function pushCheck(source: string, label: string, uri: string | null | undefined) {
    if (!hasNonEmptyText(uri)) {
      return;
    }

    const info = await getImageInfo(uri!);
    checks.push({
      source,
      label,
      uri: uri!,
      exists: info.exists,
      size: info.size ?? null,
    });
  }

  await pushCheck('mistakes', 'question_image_uri', mistake.question_image_uri);
  await pushCheck('mistakes', 'answer_image_uri', mistake.answer_image_uri);

  for (const record of reviewRecords) {
    await pushCheck(
      'review_records',
      `第 ${record.review_index} 刷 solution_image_uri`,
      record.solution_image_uri,
    );
  }

  for (const image of mistakeImages) {
    await pushCheck('mistake_images', `${image.type} (${image.id})`, image.uri);
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

export default function DevDatabasePage() {
  const router = useRouter();

  const [activeAction, setActiveAction] = useState<ActionType>(null);
  const [statusMessage, setStatusMessage] = useState('等待操作');
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
        return '正在初始化数据库...';
      case 'health':
        return '正在执行健康检查...';
      case 'insert':
        return '正在插入示例错题...';
      case 'list-recent':
        return '正在查询最近错题...';
      case 'images':
        return '正在查询图片记录...';
      case 'consistency':
        return '正在执行单题一致性检查...';
      case 'stats':
        return '正在查询统计...';
      case 'reset':
        return '正在清空开发数据...';
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
      setStatusMessage(`${action} 失败`);
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
      setStatusMessage('数据库初始化成功');
      resetPendingConfirmState();
    });
  }

  async function handleHealthCheck() {
    await runAction('health', async () => {
      const report = await checkDatabaseHealth();
      setHealthReport(report);
      setStatusMessage('健康检查完成');
      resetPendingConfirmState();
    });
  }

  async function handleInsertSampleMistake() {
    await runAction('insert', async () => {
      const created = await MistakeRepository.createMistake({
        module: '圆锥曲线',
        title: '椭圆切线条件应用错误',
        error_reason: '公式误用',
        difficulty: 4,
        question_image_uri: null,
        answer_image_uri: null,
        note: '开发调试数据',
      });
      setCreatedMistakeId(created.id);
      setStatusMessage(`示例错题插入成功：${created.id}`);
      resetPendingConfirmState();
    });
  }

  async function handleListRecentMistakes() {
    await runAction('list-recent', async () => {
      const rows = await MistakeRepository.listMistakes({
        limit: 10,
        offset: 0,
      });

      const items = await Promise.all(
        rows.map(async (row) => {
          const questionImageHasValue = hasNonEmptyText(row.question_image_uri);
          const answerImageHasValue = hasNonEmptyText(row.answer_image_uri);
          const questionImageExists = questionImageHasValue
            ? (await getImageInfo(row.question_image_uri!)).exists
            : null;
          const answerImageExists = answerImageHasValue
            ? (await getImageInfo(row.answer_image_uri!)).exists
            : null;

          return {
            id: row.id,
            title: row.title,
            module: row.module,
            error_reason: row.error_reason,
            difficulty: row.difficulty,
            review_count: row.review_count,
            status: row.status,
            next_review_at: row.next_review_at,
            question_image_uri: row.question_image_uri,
            answer_image_uri: row.answer_image_uri,
            question_image_has_value: questionImageHasValue,
            answer_image_has_value: answerImageHasValue,
            question_image_exists: questionImageExists,
            answer_image_exists: answerImageExists,
            created_at: row.created_at,
            updated_at: row.updated_at,
          };
        }),
      );

      setRecentMistakes(items);
      setStatusMessage(`已查询最近 ${rows.length} 条错题`);
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
      const rows = await MistakeImageRepository.listImagesByMistakeId(mistakeId);
      const items = await buildMistakeImageDebugItems(rows);

      setSelectedMistakeId(mistakeId);
      setMistakeImages(items);
      setStatusMessage(`已查询错题 ${mistakeId} 的 ${items.length} 条图片记录`);
      resetPendingConfirmState();
    });
  }

  async function handleCheckMistakeConsistency(mistakeId: string) {
    await runAction('consistency', async () => {
      const mistake = await MistakeRepository.getMistakeById(mistakeId);
      if (!mistake) {
        throw new Error('没有找到该错题，无法执行一致性检查');
      }

      const [reviewRecordsRaw, mistakeImagesRaw] = await Promise.all([
        ReviewRecordRepository.listReviewRecordsByMistakeId(mistakeId),
        MistakeImageRepository.listImagesByMistakeId(mistakeId),
      ]);

      const [reviewRecords, mistakeImageItems] = await Promise.all([
        buildReviewRecordDebugItems(reviewRecordsRaw),
        buildMistakeImageDebugItems(mistakeImagesRaw),
      ]);

      const imageChecks = await buildImageExistenceChecks(mistake, reviewRecords, mistakeImageItems);
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
      setStatusMessage(`一致性检查完成：失败 ${failCount}，警告 ${warnCount}`);
      resetPendingConfirmState();
    });
  }

  async function handleGetStats() {
    await runAction('stats', async () => {
      const result = await MistakeRepository.getMistakeStats();
      setStats(result);
      setStatusMessage('统计查询完成');
      resetPendingConfirmState();
    });
  }

  async function handleResetDatabase() {
    if (!pendingResetConfirm) {
      setPendingResetConfirm(true);
      setStatusMessage('请再次点击“清空开发数据”确认操作');
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
      setStatusMessage('数据库已清空并重新初始化');
    });
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <Stack.Screen options={{ title: '数据库健康检查', headerShown: false }} />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backButtonText}>返回</Text>
          </Pressable>
          <Text style={styles.pageTitle}>数据库健康检查</Text>
        </View>

        <Text style={styles.devOnlyText}>仅开发调试使用</Text>

        {isBusy ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color="#111111" />
            <Text style={styles.loadingText}>{actionLabel}</Text>
          </View>
        ) : null}

        <View style={styles.buttonGroup}>
          <Pressable style={styles.actionButton} onPress={handleInitDatabase} disabled={isBusy}>
            <Text style={styles.actionButtonText}>初始化数据库</Text>
          </Pressable>

          <Pressable style={styles.actionButton} onPress={handleHealthCheck} disabled={isBusy}>
            <Text style={styles.actionButtonText}>健康检查</Text>
          </Pressable>

          <Pressable
            style={styles.actionButton}
            onPress={handleInsertSampleMistake}
            disabled={isBusy}>
            <Text style={styles.actionButtonText}>插入示例错题</Text>
          </Pressable>

          <Pressable
            style={styles.actionButton}
            onPress={handleListRecentMistakes}
            disabled={isBusy}>
            <Text style={styles.actionButtonText}>查询最近 10 条错题</Text>
          </Pressable>

          <Pressable style={styles.actionButton} onPress={handleGetStats} disabled={isBusy}>
            <Text style={styles.actionButtonText}>查询统计</Text>
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
              {pendingResetConfirm ? '再次点击确认清空' : '清空开发数据'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>状态</Text>
          <Text style={styles.monoText}>{statusMessage}</Text>
          {errorMessage ? <Text style={styles.errorText}>错误：{errorMessage}</Text> : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>健康检查结果</Text>
          {healthReport ? (
            <>
              <Text style={styles.monoText}>ok: {String(healthReport.ok)}</Text>
              <Text style={styles.monoText}>version: {healthReport.version}</Text>
              <Text style={styles.monoText}>tables: {healthReport.tables.join(', ') || '(空)'}</Text>
              <Text style={styles.monoText}>message: {healthReport.message}</Text>
            </>
          ) : (
            <Text style={styles.placeholderText}>尚未执行健康检查</Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>最近插入的示例错题 ID</Text>
          <Text style={styles.monoText}>{createdMistakeId ?? '(暂无)'}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>最近错题（10 条）</Text>
          {recentMistakes.length === 0 ? (
            <Text style={styles.placeholderText}>暂无数据</Text>
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
                <Text style={styles.monoText}>
                  question_image_uri_has_value: {String(item.question_image_has_value)}
                </Text>
                <Text style={styles.monoText}>
                  answer_image_uri_has_value: {String(item.answer_image_has_value)}
                </Text>
                <Text style={styles.monoText}>
                  question_image_exists:{' '}
                  {item.question_image_exists === null ? '(无题目图)' : String(item.question_image_exists)}
                </Text>
                <Text style={styles.monoText}>
                  answer_image_exists:{' '}
                  {item.answer_image_exists === null ? '(无答案图)' : String(item.answer_image_exists)}
                </Text>
                <Text style={styles.monoText}>
                  question_image_uri: {toShortUri(item.question_image_uri)}
                </Text>
                <Text style={styles.monoText}>answer_image_uri: {toShortUri(item.answer_image_uri)}</Text>
                <Text style={styles.monoText}>created_at: {formatNullable(item.created_at)}</Text>
                <Text style={styles.monoText}>updated_at: {formatNullable(item.updated_at)}</Text>

                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => handleOpenMistakeDetail(item.id)}
                  disabled={isBusy}>
                  <Text style={styles.secondaryButtonText}>打开详情页</Text>
                </Pressable>

                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => handleOpenReviewPage(item.id)}
                  disabled={isBusy}>
                  <Text style={styles.secondaryButtonText}>打开复做页</Text>
                </Pressable>

                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => {
                    void handleLoadImagesByMistakeId(item.id);
                  }}
                  disabled={isBusy}>
                  <Text style={styles.secondaryButtonText}>查看该错题图片记录</Text>
                </Pressable>

                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => {
                    void handleCheckMistakeConsistency(item.id);
                  }}
                  disabled={isBusy}>
                  <Text style={styles.secondaryButtonText}>检查该错题一致性</Text>
                </Pressable>
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            图片记录{selectedMistakeId ? `（mistake_id: ${selectedMistakeId}）` : ''}
          </Text>
          {!selectedMistakeId ? (
            <Text style={styles.placeholderText}>请先在上方错题列表中选择一个错题</Text>
          ) : mistakeImages.length === 0 ? (
            <Text style={styles.placeholderText}>该错题暂无图片记录</Text>
          ) : (
            mistakeImages.map((item) => (
              <View key={item.id} style={styles.listItem}>
                <Text style={styles.monoText}>id: {item.id}</Text>
                <Text style={styles.monoText}>type: {item.type}</Text>
                <Text style={styles.monoText}>uri: {toShortUri(item.uri)}</Text>
                <Text style={styles.monoText}>created_at: {item.created_at}</Text>
                <Text style={styles.monoText}>exists: {String(item.exists)}</Text>
                <Text style={styles.monoText}>size: {item.fileSize ?? '(未知)'}</Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>单题一致性检查</Text>
          {!consistencyReport ? (
            <Text style={styles.placeholderText}>请在最近错题区域点击“检查该错题一致性”</Text>
          ) : (
            <>
              <Text style={styles.monoText}>generated_at: {consistencyReport.generatedAt}</Text>

              <View style={styles.subSection}>
                <Text style={styles.subSectionTitle}>1) mistakes 当前状态</Text>
                <Text style={styles.monoText}>id: {consistencyReport.mistake.id}</Text>
                <Text style={styles.monoText}>review_count: {consistencyReport.mistake.review_count}</Text>
                <Text style={styles.monoText}>status: {consistencyReport.mistake.status}</Text>
                <Text style={styles.monoText}>
                  next_review_at: {formatNullable(consistencyReport.mistake.next_review_at)}
                </Text>
              </View>

              <View style={styles.subSection}>
                <Text style={styles.subSectionTitle}>2) review_records 列表</Text>
                {consistencyReport.reviewRecords.length === 0 ? (
                  <Text style={styles.placeholderText}>无复做记录</Text>
                ) : (
                  consistencyReport.reviewRecords.map((item) => (
                    <View key={item.id} style={styles.listItem}>
                      <Text style={styles.monoText}>review_index: {item.review_index}</Text>
                      <Text style={styles.monoText}>solution_image_uri: {toShortUri(item.solution_image_uri)}</Text>
                      <Text style={styles.monoText}>result: {item.result}</Text>
                      <Text style={styles.monoText}>created_at: {item.created_at}</Text>
                      <Text style={styles.monoText}>
                        solution_exists:{' '}
                        {item.solution_exists === null ? '(无 solution_image_uri)' : String(item.solution_exists)}
                      </Text>
                      <Text style={styles.monoText}>solution_size: {item.solution_file_size ?? '(未知)'}</Text>
                    </View>
                  ))
                )}
              </View>

              <View style={styles.subSection}>
                <Text style={styles.subSectionTitle}>3) mistake_images 列表</Text>
                {consistencyReport.mistakeImages.length === 0 ? (
                  <Text style={styles.placeholderText}>无图片记录</Text>
                ) : (
                  consistencyReport.mistakeImages.map((item) => (
                    <View key={item.id} style={styles.listItem}>
                      <Text style={styles.monoText}>type: {item.type}</Text>
                      <Text style={styles.monoText}>uri: {toShortUri(item.uri)}</Text>
                      <Text style={styles.monoText}>created_at: {item.created_at}</Text>
                      <Text style={styles.monoText}>exists: {String(item.exists)}</Text>
                      <Text style={styles.monoText}>size: {item.fileSize ?? '(未知)'}</Text>
                    </View>
                  ))
                )}
              </View>

              <View style={styles.subSection}>
                <Text style={styles.subSectionTitle}>4) 图片文件存在性</Text>
                {consistencyReport.imageChecks.length === 0 ? (
                  <Text style={styles.placeholderText}>无可检查图片 URI</Text>
                ) : (
                  consistencyReport.imageChecks.map((item, index) => (
                    <View key={`${item.source}-${item.label}-${index}`} style={styles.listItem}>
                      <Text style={styles.monoText}>source: {item.source}</Text>
                      <Text style={styles.monoText}>label: {item.label}</Text>
                      <Text style={styles.monoText}>uri: {toShortUri(item.uri)}</Text>
                      <Text style={styles.monoText}>exists: {String(item.exists)}</Text>
                      <Text style={styles.monoText}>size: {item.size ?? '(未知)'}</Text>
                    </View>
                  ))
                )}
              </View>

              <View style={styles.subSection}>
                <Text style={styles.subSectionTitle}>5) 一致性规则检查结果</Text>
                {consistencyReport.checks.map((item) => (
                  <View key={item.key} style={styles.checkItem}>
                    <Text style={[styles.checkLabel, { color: getCheckTextColor(item.level) }]}>
                      {item.level === 'pass' ? '通过' : item.level === 'warn' ? '警告' : '失败'} - {item.label}
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
          <Text style={styles.sectionTitle}>统计</Text>
          {stats ? (
            <>
              <Text style={styles.monoText}>total: {stats.total}</Text>
              <Text style={styles.monoText}>active: {stats.active}</Text>
              <Text style={styles.monoText}>mastered: {stats.mastered}</Text>
              <Text style={styles.monoText}>dueToday: {stats.dueToday}</Text>
            </>
          ) : (
            <Text style={styles.placeholderText}>尚未查询统计</Text>
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

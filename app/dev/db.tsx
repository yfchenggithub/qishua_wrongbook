import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { checkDatabaseHealth, initDatabase, resetDatabaseForDev } from '@/src/db';
import type { DatabaseHealthReport } from '@/src/db/database';
import { MistakeImageRepository, MistakeRepository } from '@/src/repositories';
import type { MistakeStats } from '@/src/repositories';
import { getImageInfo } from '@/src/services/ImageStorageService';
import { Logger } from '@/src/services/Logger';

const PAGE_SCOPE = 'DevDbPage';

type MistakeDebugItem = {
  id: string;
  title?: string | null;
  module: string;
  question_image_has_value: boolean;
  question_image_exists: boolean | null;
  error_reason?: string | null;
  difficulty: number;
  question_image_uri?: string | null;
  answer_image_uri?: string | null;
  review_count: number;
  status: string;
  created_at: string;
};

type MistakeImageDebugItem = {
  id: string;
  type: string;
  uri: string;
  created_at: string;
  exists: boolean;
  fileSize?: number | null;
};

type ActionType =
  | 'init'
  | 'health'
  | 'insert'
  | 'list-recent'
  | 'images'
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
      case 'stats':
        return '正在查询统计...';
      case 'reset':
        return '正在重置数据库...';
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
          const questionImageExists = questionImageHasValue
            ? (await getImageInfo(row.question_image_uri!)).exists
            : null;

          return {
          id: row.id,
          title: row.title,
          module: row.module,
          question_image_has_value: questionImageHasValue,
          question_image_exists: questionImageExists,
          error_reason: row.error_reason,
          difficulty: row.difficulty,
          question_image_uri: row.question_image_uri,
          answer_image_uri: row.answer_image_uri,
          review_count: row.review_count,
          status: row.status,
          created_at: row.created_at,
          };
        }),
      );
      setRecentMistakes(items);

      setSelectedMistakeId(null);
      setMistakeImages([]);
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

  async function handleLoadImagesByMistakeId(mistakeId: string) {
    await runAction('images', async () => {
      const rows = await MistakeImageRepository.listImagesByMistakeId(mistakeId);
      const items = await Promise.all(
        rows.map(async (row) => {
          const info = await getImageInfo(row.uri);
          return {
            id: row.id,
            type: row.type,
            uri: row.uri,
            created_at: row.created_at,
            exists: info.exists,
            fileSize: info.size ?? null,
          };
        }),
      );

      setSelectedMistakeId(mistakeId);
      setMistakeImages(items);
      setStatusMessage(`已查询 ${mistakeId} 的 ${items.length} 条图片记录`);
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
            <Text style={styles.actionButtonText}>查询最近10条错题</Text>
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
          <Text style={styles.sectionTitle}>最近错题（10条）</Text>
          {recentMistakes.length === 0 ? (
            <Text style={styles.placeholderText}>暂无数据</Text>
          ) : (
            recentMistakes.map((item) => (
              <View key={item.id} style={styles.listItem}>
                <Text style={styles.monoText}>id: {item.id}</Text>
                <Text style={styles.monoText}>title: {formatNullable(item.title)}</Text>
                <Text style={styles.monoText}>module: {formatNullable(item.module)}</Text>
                <Text style={styles.monoText}>
                  question_image_uri_has_value: {String(item.question_image_has_value)}
                </Text>
                <Text style={styles.monoText}>
                  question_image_exists: {item.question_image_exists === null ? '(无题目图)' : String(item.question_image_exists)}
                </Text>
                <Text style={styles.monoText}>error_reason: {formatNullable(item.error_reason)}</Text>
                <Text style={styles.monoText}>difficulty: {formatNullable(item.difficulty)}</Text>
                <Text style={styles.monoText}>
                  question_image_uri: {formatNullable(item.question_image_uri)}
                </Text>
                <Text style={styles.monoText}>
                  answer_image_uri: {formatNullable(item.answer_image_uri)}
                </Text>
                <Text style={styles.monoText}>review_count: {formatNullable(item.review_count)}</Text>
                <Text style={styles.monoText}>status: {formatNullable(item.status)}</Text>
                <Text style={styles.monoText}>created_at: {formatNullable(item.created_at)}</Text>

                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => handleOpenMistakeDetail(item.id)}
                  disabled={isBusy}>
                  <Text style={styles.secondaryButtonText}>打开详情页</Text>
                </Pressable>

                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => {
                    void handleLoadImagesByMistakeId(item.id);
                  }}
                  disabled={isBusy}>
                  <Text style={styles.secondaryButtonText}>查看该错题图片记录</Text>
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
            <Text style={styles.placeholderText}>请先在上方错题列表中点击“查看该错题图片记录”</Text>
          ) : mistakeImages.length === 0 ? (
            <Text style={styles.placeholderText}>该错题暂无图片记录</Text>
          ) : (
            mistakeImages.map((item) => (
              <View key={item.id} style={styles.listItem}>
                <Text style={styles.monoText}>type: {item.type}</Text>
                <Text style={styles.monoText}>uri: {item.uri}</Text>
                <Text style={styles.monoText}>created_at: {item.created_at}</Text>
                <Text style={styles.monoText}>exists: {String(item.exists)}</Text>
                <Text style={styles.monoText}>size: {item.fileSize ?? '(未知)'}</Text>
              </View>
            ))
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

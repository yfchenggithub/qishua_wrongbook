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
import { MistakeRepository } from '@/src/repositories';
import type { DatabaseHealthReport } from '@/src/db/database';
import type { MistakeStats } from '@/src/repositories';
import { Logger } from '@/src/services/Logger';

const PAGE_SCOPE = 'DevDbPage';

type MistakeListItem = {
  id: string;
  title?: string | null;
  module: string;
  review_count: number;
  status: string;
};

type ActionType =
  | 'init'
  | 'health'
  | 'insert'
  | 'list'
  | 'stats'
  | 'reset'
  | null;

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export default function DevDatabasePage() {
  const router = useRouter();

  const [activeAction, setActiveAction] = useState<ActionType>(null);
  const [statusMessage, setStatusMessage] = useState('等待操作');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [healthReport, setHealthReport] = useState<DatabaseHealthReport | null>(null);
  const [createdMistakeId, setCreatedMistakeId] = useState<string | null>(null);
  const [mistakes, setMistakes] = useState<MistakeListItem[]>([]);
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
      case 'list':
        return '正在查询错题列表...';
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

  async function handleListMistakes() {
    await runAction('list', async () => {
      const rows = await MistakeRepository.listMistakes({
        limit: 20,
        offset: 0,
      });
      setMistakes(
        rows.map((row) => ({
          id: row.id,
          title: row.title,
          module: row.module,
          review_count: row.review_count,
          status: row.status,
        })),
      );
      setStatusMessage(`已查询 ${rows.length} 条错题`);
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
      setMistakes([]);
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

          <Pressable style={styles.actionButton} onPress={handleListMistakes} disabled={isBusy}>
            <Text style={styles.actionButtonText}>查询错题列表（前20条）</Text>
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
          <Text style={styles.sectionTitle}>错题列表（前20条）</Text>
          {mistakes.length === 0 ? (
            <Text style={styles.placeholderText}>暂无数据</Text>
          ) : (
            mistakes.map((item) => (
              <View key={item.id} style={styles.listItem}>
                <Text style={styles.monoText}>id: {item.id}</Text>
                <Text style={styles.monoText}>title: {item.title ?? '(无标题)'}</Text>
                <Text style={styles.monoText}>module: {item.module}</Text>
                <Text style={styles.monoText}>review_count: {item.review_count}</Text>
                <Text style={styles.monoText}>status: {item.status}</Text>
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
});

export interface BulkDeleteExecutionSuccess<TSnapshot> {
  ok: true;
  deletedCount: number;
  snapshot: TSnapshot;
}

export interface BulkDeleteExecutionFailure {
  ok: false;
  errorMessage: string;
}

export type BulkDeleteExecutionResult<TSnapshot> =
  | BulkDeleteExecutionSuccess<TSnapshot>
  | BulkDeleteExecutionFailure;

export interface BulkDeleteExecutor<TSnapshot> {
  deleteInTransaction: (ids: string[]) => Promise<TSnapshot>;
  getDeletedCount: (snapshot: TSnapshot) => number;
}

export interface BulkDeleteUndoExecutor<TSnapshot> {
  restoreInTransaction: (snapshot: TSnapshot) => Promise<number>;
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

export async function executeBulkDelete<TSnapshot>(
  idsInput: Iterable<unknown>,
  executor: BulkDeleteExecutor<TSnapshot>,
): Promise<BulkDeleteExecutionResult<TSnapshot>> {
  const ids = normalizeSelectionIds(idsInput);
  if (ids.length === 0) {
    return { ok: false, errorMessage: '请先选择要删除的题目。' };
  }

  try {
    const snapshot = await executor.deleteInTransaction(ids);
    const deletedCount = executor.getDeletedCount(snapshot);
    if (deletedCount !== ids.length) {
      throw new Error('选中的题目已发生变化，请刷新后重试。');
    }
    return { ok: true, deletedCount, snapshot };
  } catch (error) {
    return {
      ok: false,
      errorMessage: toErrorMessage(error, '删除题目失败，请稍后重试。'),
    };
  }
}

export async function executeBulkDeleteUndo<TSnapshot>(
  snapshot: TSnapshot,
  expectedCount: number,
  executor: BulkDeleteUndoExecutor<TSnapshot>,
): Promise<{ ok: true; restoredCount: number } | BulkDeleteExecutionFailure> {
  try {
    const restoredCount = await executor.restoreInTransaction(snapshot);
    if (restoredCount !== expectedCount) {
      throw new Error('恢复的数据数量不完整，请重试。');
    }
    return { ok: true, restoredCount };
  } catch (error) {
    return {
      ok: false,
      errorMessage: toErrorMessage(error, '撤销删除失败，请稍后重试。'),
    };
  }
}

function normalizeSelectionIds(values: Iterable<unknown>): string[] {
  const normalized = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }
    const id = value.trim();
    if (id) {
      normalized.add(id);
    }
  }
  return Array.from(normalized);
}

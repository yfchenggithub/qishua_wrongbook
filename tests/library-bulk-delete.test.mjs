import assert from 'node:assert/strict';
import test from 'node:test';

import {
  areAllVisibleIdsSelected,
  reconcileSelectionWithVisibleIds,
  selectAllVisibleIds,
  toggleSelectionId,
} from '../src/utils/libraryBulkSelection.ts';
import {
  executeBulkDelete,
  executeBulkDeleteUndo,
} from '../src/utils/bulkMistakeDeletion.ts';

test('全选只包含当前筛选结果，不扩大到筛选范围外', () => {
  const selected = selectAllVisibleIds(['M-2', 'M-4', 'M-6']);

  assert.deepEqual(Array.from(selected), ['M-2', 'M-4', 'M-6']);
  assert.equal(selected.has('M-1'), false);
  assert.equal(areAllVisibleIdsSelected(selected, ['M-2', 'M-4', 'M-6']), true);
});

test('全选后可以取消其中几道，选中状态始终使用题目 ID', () => {
  let selected = selectAllVisibleIds(['M-1', 'M-2', 'M-3']);
  selected = toggleSelectionId(selected, 'M-2');

  assert.deepEqual(Array.from(selected), ['M-1', 'M-3']);
  assert.equal(areAllVisibleIdsSelected(selected, ['M-1', 'M-2', 'M-3']), false);
});

test('列表刷新后移除已经消失的选中题目', () => {
  const selected = new Set(['M-1', 'M-2', 'M-3']);
  const reconciled = reconcileSelectionWithVisibleIds(selected, ['M-1', 'M-3', 'M-4']);

  assert.deepEqual(Array.from(reconciled), ['M-1', 'M-3']);
});

test('空筛选结果不会被判断为已经全选', () => {
  assert.equal(areAllVisibleIdsSelected(new Set(), []), false);
  assert.deepEqual(Array.from(selectAllVisibleIds([])), []);
});

test('批量删除失败时返回错误且不改动调用方的选择集合', async () => {
  const selected = new Set(['M-1', 'M-2']);
  const result = await executeBulkDelete(selected, {
    deleteInTransaction: async () => {
      throw new Error('database failed');
    },
    getDeletedCount: () => 0,
  });

  assert.deepEqual(result, { ok: false, errorMessage: 'database failed' });
  assert.deepEqual(Array.from(selected), ['M-1', 'M-2']);
});

test('事务返回的删除数量不完整时按失败处理', async () => {
  const result = await executeBulkDelete(['M-1', 'M-2'], {
    deleteInTransaction: async () => ({ rows: ['M-1'] }),
    getDeletedCount: (snapshot) => snapshot.rows.length,
  });

  assert.equal(result.ok, false);
  assert.match(result.errorMessage, /发生变化/);
});

test('撤销通过同一快照恢复全部题目', async () => {
  const snapshot = { mistakes: ['M-1', 'M-2'], relatedRows: 7 };
  let restoredSnapshot = null;
  const result = await executeBulkDeleteUndo(snapshot, 2, {
    restoreInTransaction: async (value) => {
      restoredSnapshot = value;
      return value.mistakes.length;
    },
  });

  assert.deepEqual(result, { ok: true, restoredCount: 2 });
  assert.equal(restoredSnapshot, snapshot);
});

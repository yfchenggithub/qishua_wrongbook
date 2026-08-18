import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveDetailBrowseContext,
} from '../src/services/DetailBrowseContextResolver.ts';
import {
  buildDetailSwitchRouteParams,
  resolveDeletedMistakeBrowseTarget,
  resolveLibraryBrowseTarget,
} from '../src/services/DetailBrowseNavigation.ts';
import {
  createLibraryBrowseSession,
  getLibraryBrowseSession,
  removeMistakesFromLibraryBrowseSession,
} from '../src/services/DetailBrowseSessionService.ts';

test('浏览会话保持传入顺序', () => {
  const sessionId = createLibraryBrowseSession(['M-3', 'M-1', 'M-2']);
  assert.ok(sessionId);
  assert.deepEqual(
    [...getLibraryBrowseSession(sessionId).mistakeIds],
    ['M-3', 'M-1', 'M-2'],
  );
});

test('浏览会话去除空 ID 和重复 ID，同时保留首次出现顺序', () => {
  const sessionId = createLibraryBrowseSession([' M-2 ', '', 'M-1', 'M-2', '   ', 'M-1']);
  assert.ok(sessionId);
  assert.deepEqual([...getLibraryBrowseSession(sessionId).mistakeIds], ['M-2', 'M-1']);
});

test('不同浏览会话互不影响', () => {
  const firstSessionId = createLibraryBrowseSession(['A-1', 'A-2']);
  const secondSessionId = createLibraryBrowseSession(['B-1', 'B-2']);
  assert.ok(firstSessionId);
  assert.ok(secondSessionId);

  removeMistakesFromLibraryBrowseSession(firstSessionId, ['A-2']);

  assert.deepEqual([...getLibraryBrowseSession(firstSessionId).mistakeIds], ['A-1']);
  assert.deepEqual([...getLibraryBrowseSession(secondSessionId).mistakeIds], ['B-1', 'B-2']);
});

test('无效浏览会话安全降级为当前单题，且不读取今日队列', async () => {
  let todayQueueLoadCount = 0;
  const context = await resolveDetailBrowseContext(
    {
      mistakeId: 'M-current',
      module: '函数',
      browseSessionId: 'missing-session',
    },
    {
      getLibraryBrowseSession: () => null,
      getTodayDueIds: async () => {
        todayQueueLoadCount += 1;
        return ['M-current'];
      },
      getSameModuleIds: async () => ['M-current', 'M-other'],
    },
  );

  assert.deepEqual(context, {
    mode: 'none',
    ids: ['M-current'],
    currentIndex: 0,
  });
  assert.equal(todayQueueLoadCount, 0);
});

test('切题路由继续携带原浏览会话标识', () => {
  const params = buildDetailSwitchRouteParams({
    targetId: 'M-next',
    direction: 'next',
    browseSessionId: 'library-session-1',
    skippedUnavailableCount: 1,
  });

  assert.deepEqual(params, {
    id: 'M-next',
    switchFrom: 'bottom',
    browseSessionId: 'library-session-1',
    skippedUnavailableCount: '1',
  });
});

test('有效错题库会话优先于今日复做队列', async () => {
  const sessionId = createLibraryBrowseSession(['M-first', 'M-current', 'M-last']);
  assert.ok(sessionId);
  let todayQueueLoadCount = 0;

  const context = await resolveDetailBrowseContext(
    {
      mistakeId: 'M-current',
      module: '函数',
      browseSessionId: sessionId,
    },
    {
      getLibraryBrowseSession,
      getTodayDueIds: async () => {
        todayQueueLoadCount += 1;
        return ['M-current', 'M-today'];
      },
      getSameModuleIds: async () => ['M-current', 'M-module'],
    },
  );

  assert.deepEqual(context, {
    mode: 'library_filter',
    ids: ['M-first', 'M-current', 'M-last'],
    currentIndex: 1,
  });
  assert.equal(todayQueueLoadCount, 0);
});

test('连续失效题目会被按顺序跳过并定位到下一道可用题', async () => {
  const checkedIds = [];
  const result = await resolveLibraryBrowseTarget({
    ids: ['M-current', 'M-missing', 'M-archived', 'M-next'],
    currentMistakeId: 'M-current',
    direction: 'next',
    isCandidateAvailable: async (mistakeId) => {
      checkedIds.push(mistakeId);
      return mistakeId === 'M-next';
    },
  });

  assert.deepEqual(checkedIds, ['M-missing', 'M-archived', 'M-next']);
  assert.deepEqual(result, {
    kind: 'target',
    currentIndex: 0,
    targetId: 'M-next',
    targetIndex: 3,
    skippedIds: ['M-missing', 'M-archived'],
  });
});

test('当前方向剩余题目全部失效时停止切换并返回全部跳过项', async () => {
  const result = await resolveLibraryBrowseTarget({
    ids: ['M-current', 'M-missing', 'M-archived'],
    currentMistakeId: 'M-current',
    direction: 'next',
    isCandidateAvailable: async () => false,
  });

  assert.deepEqual(result, {
    kind: 'no_available',
    currentIndex: 0,
    targetId: null,
    targetIndex: -1,
    skippedIds: ['M-missing', 'M-archived'],
  });
});

test('单题筛选在两个方向都返回边界且不会检查候选题', async () => {
  let availabilityCheckCount = 0;
  const isCandidateAvailable = async () => {
    availabilityCheckCount += 1;
    return true;
  };

  const [previousResult, nextResult] = await Promise.all([
    resolveLibraryBrowseTarget({
      ids: ['M-only'],
      currentMistakeId: 'M-only',
      direction: 'prev',
      isCandidateAvailable,
    }),
    resolveLibraryBrowseTarget({
      ids: ['M-only'],
      currentMistakeId: 'M-only',
      direction: 'next',
      isCandidateAvailable,
    }),
  ]);

  assert.equal(previousResult.kind, 'boundary');
  assert.equal(previousResult.boundary, 'start');
  assert.equal(nextResult.kind, 'boundary');
  assert.equal(nextResult.boundary, 'end');
  assert.equal(availabilityCheckCount, 0);
});

test('多题筛选的第一题和最后一题不会首尾循环', async () => {
  const isCandidateAvailable = async () => true;
  const firstResult = await resolveLibraryBrowseTarget({
    ids: ['M-first', 'M-middle', 'M-last'],
    currentMistakeId: 'M-first',
    direction: 'prev',
    isCandidateAvailable,
  });
  const lastResult = await resolveLibraryBrowseTarget({
    ids: ['M-first', 'M-middle', 'M-last'],
    currentMistakeId: 'M-last',
    direction: 'next',
    isCandidateAvailable,
  });

  assert.equal(firstResult.kind, 'boundary');
  assert.equal(firstResult.boundary, 'start');
  assert.equal(lastResult.kind, 'boundary');
  assert.equal(lastResult.boundary, 'end');
});

test('deleting a browsed mistake prefers the next available mistake', async () => {
  const checkedIds = [];
  const result = await resolveDeletedMistakeBrowseTarget({
    ids: ['M-prev', 'M-current', 'M-next', 'M-last'],
    deletedMistakeId: 'M-current',
    isCandidateAvailable: async (mistakeId) => {
      checkedIds.push(mistakeId);
      return true;
    },
  });

  assert.deepEqual(checkedIds, ['M-next']);
  assert.deepEqual(result, {
    kind: 'target',
    currentIndex: 1,
    direction: 'next',
    targetId: 'M-next',
    targetIndex: 2,
    skippedIds: [],
  });
});

test('deleting the final browsed mistake falls back to the nearest previous mistake', async () => {
  const result = await resolveDeletedMistakeBrowseTarget({
    ids: ['M-first', 'M-previous', 'M-current'],
    deletedMistakeId: 'M-current',
    isCandidateAvailable: async () => true,
  });

  assert.deepEqual(result, {
    kind: 'target',
    currentIndex: 2,
    direction: 'prev',
    targetId: 'M-previous',
    targetIndex: 1,
    skippedIds: [],
  });
});

test('deleting the only available browsed mistake returns no target', async () => {
  const result = await resolveDeletedMistakeBrowseTarget({
    ids: ['M-missing-prev', 'M-current', 'M-missing-next'],
    deletedMistakeId: 'M-current',
    isCandidateAvailable: async () => false,
  });

  assert.deepEqual(result, {
    kind: 'no_available',
    currentIndex: 1,
    direction: null,
    targetId: null,
    targetIndex: -1,
    skippedIds: ['M-missing-next', 'M-missing-prev'],
  });
});

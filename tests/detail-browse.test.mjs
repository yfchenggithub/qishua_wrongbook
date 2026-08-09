import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveDetailBrowseContext,
} from '../src/services/DetailBrowseContextResolver.ts';
import { buildDetailSwitchRouteParams } from '../src/services/DetailBrowseNavigation.ts';
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

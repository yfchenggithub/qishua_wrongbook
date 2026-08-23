import assert from 'node:assert/strict';
import test from 'node:test';

import { createSerialTaskQueue } from '../src/db/writeQueue.ts';

function createDeferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

test('数据库写队列等待前一项完成后再开始下一项', async () => {
  const queue = createSerialTaskQueue();
  const firstStarted = createDeferred();
  const releaseFirst = createDeferred();
  const events = [];

  const first = queue.enqueue(async () => {
    events.push('first:start');
    firstStarted.resolve();
    await releaseFirst.promise;
    events.push('first:end');
    return 1;
  });
  await firstStarted.promise;

  const second = queue.enqueue(async () => {
    events.push('second:start');
    return 2;
  });
  await Promise.resolve();

  assert.deepEqual(events, ['first:start']);
  releaseFirst.resolve();
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(events, ['first:start', 'first:end', 'second:start']);
});

test('数据库写入失败不会阻塞后续队列任务', async () => {
  const queue = createSerialTaskQueue();
  const expectedError = new Error('expected write failure');

  const failed = queue.enqueue(async () => {
    throw expectedError;
  });
  const recovered = queue.enqueue(async () => 'recovered');

  await assert.rejects(failed, expectedError);
  assert.equal(await recovered, 'recovered');
});

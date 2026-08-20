import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findAdjacentReviewIndex,
} from '../src/services/ReviewSessionNavigation.ts';

const queue = [
  { id: 'M-1', module: '算法' },
  { id: 'M-2', module: '算法' },
  { id: 'M-3', module: '函数' },
  { id: 'M-4', module: '算法' },
];

test('手动返回上一题时允许进入已完成题', () => {
  const submittedIds = new Set(['M-1']);

  const targetIndex = findAdjacentReviewIndex(queue, 0, 'prev');

  assert.equal(targetIndex, 0);
  assert.equal(submittedIds.has(queue[targetIndex].id), true);
});

test('手动切题仍遵守当前模块筛选', () => {
  assert.equal(findAdjacentReviewIndex(queue, 2, 'next', '算法'), 3);
  assert.equal(findAdjacentReviewIndex(queue, 2, 'prev', '算法'), 1);
});

test('相邻方向没有题目时返回边界', () => {
  assert.equal(findAdjacentReviewIndex(queue, -1, 'prev'), null);
  assert.equal(findAdjacentReviewIndex(queue, queue.length, 'next'), null);
});

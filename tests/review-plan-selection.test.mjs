import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeReviewPlanMistakeIds } from '../src/utils/reviewPlan.ts';

test('批量加入七刷时去除空 ID 和重复 ID，并保留首次出现顺序', () => {
  assert.deepEqual(
    normalizeReviewPlanMistakeIds([' M-2 ', '', 'M-1', 'M-2', '   ', 'M-3', 'M-1']),
    ['M-2', 'M-1', 'M-3'],
  );
});

test('批量加入七刷时忽略非字符串 ID', () => {
  assert.deepEqual(
    normalizeReviewPlanMistakeIds(['M-1', null, undefined, 2, {}, 'M-2']),
    ['M-1', 'M-2'],
  );
});

test('没有有效 ID 时返回空数组', () => {
  assert.deepEqual(normalizeReviewPlanMistakeIds(['', '   ', null]), []);
});

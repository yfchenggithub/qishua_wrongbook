import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDailyReviewPlanSchedule,
  normalizeReviewPlanMistakeIds,
} from '../src/utils/reviewPlan.ts';

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

test('每日 10 道时第 11 道安排到次日，第 21 道安排到第三天', () => {
  const startAt = new Date(2026, 7, 21, 8, 30, 0, 0);
  const ids = Array.from({ length: 23 }, (_, index) => `M-${index + 1}`);
  const schedule = buildDailyReviewPlanSchedule(ids, startAt, 10);
  const nextDay = new Date(startAt.getTime());
  nextDay.setDate(nextDay.getDate() + 1);
  const thirdDay = new Date(startAt.getTime());
  thirdDay.setDate(thirdDay.getDate() + 2);

  assert.equal(schedule.length, 23);
  assert.deepEqual(schedule.slice(0, 10).map((item) => item.dayOffset), Array(10).fill(0));
  assert.equal(schedule[9].nextReviewAt, startAt.toISOString());
  assert.equal(schedule[10].nextReviewAt, nextDay.toISOString());
  assert.equal(schedule[20].nextReviewAt, thirdDay.toISOString());
  assert.equal(schedule[22].dayOffset, 2);
});

test('分批计划去重后仍保留首次出现顺序', () => {
  const startAt = new Date(2026, 7, 21, 8, 30, 0, 0);
  const schedule = buildDailyReviewPlanSchedule(['M-2', 'M-1', 'M-2', 'M-3'], startAt, 2);

  assert.deepEqual(schedule.map((item) => item.mistakeId), ['M-2', 'M-1', 'M-3']);
  assert.deepEqual(schedule.map((item) => item.dayOffset), [0, 0, 1]);
});

test('每日安排数量不是正整数时拒绝生成计划', () => {
  const startAt = new Date(2026, 7, 21, 8, 30, 0, 0);
  assert.throws(() => buildDailyReviewPlanSchedule(['M-1'], startAt, 0));
  assert.throws(() => buildDailyReviewPlanSchedule(['M-1'], startAt, Number.NaN));
});

export type LibraryFilterValue = 'all' | 'pending' | 'mastered';

export interface LibraryFilterOptionMock {
  label: string;
  value: LibraryFilterValue;
}

export interface LibraryMistakeMock {
  id: string;
  routeId: string;
  code: string;
  module: string;
  title: string;
  source: string;
  progressLabel: string;
  statusLabel: string;
  statusTone: 'dark' | 'light' | 'success';
  progress: {
    total: number;
    current?: number;
    completed: number;
  };
}

export const libraryMock = {
  brand: {
    title: '错题库',
    subtitle: '只记录错题、做法、答案和 7 次复做',
  },
  searchPlaceholder: '搜索：模块 / 错因 / 来源',
  filters: [
    { label: '全部', value: 'all' },
    { label: '待复做', value: 'pending' },
    { label: '已七刷', value: 'mastered' },
  ] satisfies LibraryFilterOptionMock[],
  mistakes: [
    {
      id: 'card-1',
      routeId: 'demo-1',
      code: 'C017',
      module: '圆锥曲线',
      title: '椭圆切线条件应用错误',
      source: '2026 春季月考 · 第 18 题',
      progressLabel: '第 4 刷',
      statusLabel: '今天第 4 刷',
      statusTone: 'dark',
      progress: {
        total: 7,
        current: 4,
        completed: 3,
      },
    },
    {
      id: 'card-2',
      routeId: 'demo-2',
      code: 'C032',
      module: '不等式',
      title: '绝对值不等式分类讨论遗漏',
      source: '2026 春季月考 · 第 22 题',
      progressLabel: '第 2 刷',
      statusLabel: '明天第 2 刷',
      statusTone: 'light',
      progress: {
        total: 7,
        current: 2,
        completed: 1,
      },
    },
    {
      id: 'card-3',
      routeId: 'demo-3',
      code: 'G045',
      module: '数列',
      title: '等差数列通项公式计算错误',
      source: '2026 春季月考 · 第 15 题',
      progressLabel: '已七刷',
      statusLabel: '已七刷',
      statusTone: 'light',
      progress: {
        total: 7,
        completed: 7,
      },
    },
  ] satisfies LibraryMistakeMock[],
} as const;


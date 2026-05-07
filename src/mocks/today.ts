export interface TodayTaskStatMock {
  label: string;
  value: string;
}

export interface TodayMistakeMock {
  id: string;
  code: string;
  module: string;
  title: string;
  source: string;
  statusLabel: string;
  statusTone: 'dark' | 'light';
  progress: {
    total: number;
    current: number;
    completed: number;
  };
}

export const todayMock = {
  brand: {
    title: '七刷错题本',
    subtitle: '只记录错题、做法、答案和 7 次复做',
  },
  taskSummary: {
    title: '今日任务',
    dueCount: 3,
    dueLabel: '道待复做',
    stats: [
      { label: '总错题', value: '21' },
      { label: '已七刷', value: '5' },
      { label: '完成率', value: '76%' },
    ] satisfies TodayTaskStatMock[],
  },
  priority: {
    id: 'demo-1',
    code: 'C017',
    module: '圆锥曲线',
    title: '椭圆切线条件应用错误',
    source: '2026 春季月考 · 第 18 题',
    statusLabel: '今天第 4 刷',
    statusTone: 'dark',
    progress: {
      total: 7,
      current: 4,
      completed: 3,
    },
  } satisfies TodayMistakeMock,
  queue: [
    {
      id: 'demo-2',
      code: 'C032',
      module: '解析几何',
      title: '抛物线焦点弦长计算失误',
      source: '2026 春季月考 · 第 22 题',
      statusLabel: '明天第 2 刷',
      statusTone: 'light',
      progress: {
        total: 7,
        current: 2,
        completed: 1,
      },
    },
    {
      id: 'demo-3',
      code: 'G045',
      module: '三角函数',
      title: '正弦定理边角转换错误',
      source: '2026 春季月考 · 第 15 题',
      statusLabel: '后天第 1 刷',
      statusTone: 'light',
      progress: {
        total: 7,
        current: 1,
        completed: 0,
      },
    },
  ] satisfies TodayMistakeMock[],
} as const;


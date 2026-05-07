export interface DetailPreviewMock {
  id: string;
  title: string;
  type: 'diagram' | 'text';
  content: string;
}

export interface MistakeDetailMock {
  id: string;
  code: string;
  module: string;
  title: string;
  progressLabel: string;
  progress: {
    total: number;
    current?: number;
    completed: number;
  };
  previews: DetailPreviewMock[];
  capture: {
    title: string;
    subtitle: string;
  };
  completeButtonText: string;
}

const detailMocks: Record<string, MistakeDetailMock> = {
  'demo-1': {
    id: 'demo-1',
    code: 'C017',
    module: '圆锥曲线',
    title: '椭圆切线条件应用错误',
    progressLabel: '第 4 刷',
    progress: {
      total: 7,
      current: 4,
      completed: 3,
    },
    previews: [
      {
        id: 'preview-question',
        title: '题目',
        type: 'diagram',
        content: '椭圆切线图形占位',
      },
      {
        id: 'preview-my-work',
        title: '我的做法',
        type: 'text',
        content: '设 A(x1,0), B(x2,0)\n由切线方程得 x1x2 为常量。\n代入后继续整理，得到固定值。',
      },
      {
        id: 'preview-answer',
        title: '答案',
        type: 'text',
        content: '由标准切线式推导：\nx0x/a^2 + y0y/b^2 = 1\n最终可得 OA·OB 为定值。',
      },
    ],
    capture: {
      title: '拍第 4 次复做',
      subtitle: '只保存照片，不强迫输入文字',
    },
    completeButtonText: '标记第 4 刷完成',
  },
  'demo-2': {
    id: 'demo-2',
    code: 'C032',
    module: '不等式',
    title: '绝对值不等式分类讨论遗漏',
    progressLabel: '第 2 刷',
    progress: {
      total: 7,
      current: 2,
      completed: 1,
    },
    previews: [
      {
        id: 'preview-question',
        title: '题目',
        type: 'diagram',
        content: '不等式图形占位',
      },
      {
        id: 'preview-my-work',
        title: '我的做法',
        type: 'text',
        content: '把绝对值拆分时遗漏了 x<0 的分支。\n只验证了一种区间，导致结论不完整。',
      },
      {
        id: 'preview-answer',
        title: '答案',
        type: 'text',
        content: '按零点分区间讨论：\n(-∞,a)、[a,b]、(b,+∞)\n分别求解后并集得到最终解集。',
      },
    ],
    capture: {
      title: '拍第 2 次复做',
      subtitle: '只保存照片，不强迫输入文字',
    },
    completeButtonText: '标记第 2 刷完成',
  },
  'demo-3': {
    id: 'demo-3',
    code: 'G045',
    module: '数列',
    title: '等差数列通项公式计算错误',
    progressLabel: '已七刷',
    progress: {
      total: 7,
      completed: 7,
    },
    previews: [
      {
        id: 'preview-question',
        title: '题目',
        type: 'diagram',
        content: '数列图形占位',
      },
      {
        id: 'preview-my-work',
        title: '我的做法',
        type: 'text',
        content: '曾将 a_n = a_1 + n·d 写错为 a_1 + (n+1)d。\n现在已改正并复核推导步骤。',
      },
      {
        id: 'preview-answer',
        title: '答案',
        type: 'text',
        content: '正确通项为：a_n = a_1 + (n-1)d。\n代入题目数据后可得到正确结果。',
      },
    ],
    capture: {
      title: '拍本次复做',
      subtitle: '只保存照片，不强迫输入文字',
    },
    completeButtonText: '标记已七刷',
  },
};

export function getMistakeDetailMock(id: string): MistakeDetailMock {
  return detailMocks[id] ?? detailMocks['demo-1'];
}

export const mistakeDetailBrandMock = {
  title: '七刷错题本',
  subtitle: '只记录错题、做法、答案和 7 次复做',
} as const;


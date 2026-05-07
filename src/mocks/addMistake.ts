export interface CaptureEntryMock {
  id: string;
  title: string;
  subtitle: string;
}

export const addMistakeMock = {
  brand: {
    title: '七刷错题本',
    subtitle: '只记录错题、做法、答案和 7 次复做',
  },
  sectionTitle: '拍照录入',
  introCard: {
    title: '新增错题',
    subtitle: '3 张照片即可保存，不做 OCR 也能跑通 MVP',
  },
  captureEntries: [
    {
      id: 'question',
      title: '题目照片',
      subtitle: '拍原题，建议只框住一道题',
    },
    {
      id: 'my-solution',
      title: '我的做法',
      subtitle: '拍自己的错误过程或订正过程',
    },
    {
      id: 'answer',
      title: '答案 / 解析',
      subtitle: '拍标准答案、老师讲解或参考解析',
    },
  ] satisfies CaptureEntryMock[],
  tagTitle: '最少标签',
  tags: ['高中数学', '圆锥曲线', '中高难度', '公式误用', '月考'],
  submitText: '保存错题，并加入 7 刷计划',
} as const;


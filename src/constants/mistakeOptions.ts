export interface MistakeOption<T extends string | number> {
  value: T;
  label: string;
}

export const MISTAKE_NOTE_MAX_LENGTH = 5000;

export const SUBJECT_OPTIONS = [
  { value: 'math', label: '高中数学' },
] as const satisfies readonly MistakeOption<string>[];

export const MODULE_OPTIONS = [
  { value: '函数', label: '函数' },
  { value: '数列', label: '数列' },
  { value: '导数', label: '导数' },
  { value: '圆锥曲线', label: '圆锥曲线' },
  { value: '立体几何', label: '立体几何' },
  { value: '平面几何', label: '平面几何' },
  { value: '三角函数', label: '三角函数' },
  { value: '概率统计', label: '概率统计' },
  { value: '不等式', label: '不等式' },
  { value: '其他', label: '其他' },
] as const satisfies readonly MistakeOption<string>[];

export const ERROR_REASON_OPTIONS = [
  { value: '粗心', label: '粗心' },
  { value: '不会', label: '不会' },
  { value: '思路卡住', label: '思路卡住' },
  { value: '计算错误', label: '计算错误' },
  { value: '概念不清', label: '概念不清' },
  { value: '公式误用', label: '公式误用' },
  { value: '分类讨论遗漏', label: '分类讨论遗漏' },
  { value: '其他', label: '其他' },
] as const satisfies readonly MistakeOption<string>[];

export const DIFFICULTY_OPTIONS = [
  { value: 1, label: '1 简单' },
  { value: 2, label: '2 偏易' },
  { value: 3, label: '3 中等' },
  { value: 4, label: '4 较难' },
  { value: 5, label: '5 很难' },
] as const satisfies readonly MistakeOption<number>[];

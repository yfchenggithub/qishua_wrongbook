export interface MistakeOption<T extends string | number> {
  id: string;
  value: T;
  label: string;
}

export const MISTAKE_NOTE_MAX_LENGTH = 5000;
export const MISTAKE_TITLE_MAX_LENGTH = 30;
export const ADD_MISTAKE_NOTE_MAX_LENGTH = 200;
export const SUPPLEMENT_TEXT_MAX_LENGTH = 500;
export const UNCLASSIFIED_MODULE = '未分类';

export const SUBJECT_OPTIONS = [
  { id: 'subject:math', value: 'math', label: '高中数学' },
] as const satisfies readonly MistakeOption<string>[];

export const MODULE_OPTIONS = [
  { id: 'builtin:module:function', value: '函数', label: '函数' },
  { id: 'builtin:module:sequence', value: '数列', label: '数列' },
  { id: 'builtin:module:derivative', value: '导数', label: '导数' },
  { id: 'builtin:module:conic', value: '圆锥曲线', label: '圆锥曲线' },
  { id: 'builtin:module:solid-geometry', value: '立体几何', label: '立体几何' },
  { id: 'builtin:module:plane-geometry', value: '平面几何', label: '平面几何' },
  { id: 'builtin:module:trigonometry', value: '三角函数', label: '三角函数' },
  { id: 'builtin:module:probability', value: '概率统计', label: '概率统计' },
  { id: 'builtin:module:inequality', value: '不等式', label: '不等式' },
  { id: 'builtin:module:other', value: '其他', label: '其他' },
] as const satisfies readonly MistakeOption<string>[];

export const ERROR_REASON_OPTIONS = [
  { id: 'builtin:reason:careless', value: '粗心', label: '粗心' },
  { id: 'builtin:reason:unknown', value: '不会', label: '不会' },
  { id: 'builtin:reason:blocked', value: '思路卡住', label: '思路卡住' },
  { id: 'builtin:reason:calculation', value: '计算错误', label: '计算错误' },
  { id: 'builtin:reason:concept', value: '概念不清', label: '概念不清' },
  { id: 'builtin:reason:formula', value: '公式误用', label: '公式误用' },
  { id: 'builtin:reason:case-missing', value: '分类讨论遗漏', label: '分类讨论遗漏' },
  { id: 'builtin:reason:other', value: '其他', label: '其他' },
] as const satisfies readonly MistakeOption<string>[];

export const DIFFICULTY_OPTIONS = [
  { id: 'difficulty:1', value: 1, label: '1 简单' },
  { id: 'difficulty:2', value: 2, label: '2 偏易' },
  { id: 'difficulty:3', value: 3, label: '3 中等' },
  { id: 'difficulty:4', value: 4, label: '4 较难' },
  { id: 'difficulty:5', value: 5, label: '5 很难' },
] as const satisfies readonly MistakeOption<number>[];

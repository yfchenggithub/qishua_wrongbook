export type ModuleType = 'system' | 'custom' | 'unclassified';

export interface SystemModuleDefinition {
  id: number;
  legacyId: string;
  name: string;
  displayCode: string;
  sortOrder: number;
}

export interface ParsedMistakeDisplayCode {
  moduleDisplayCode: string;
  questionNo: number;
}

export const SYSTEM_MODULE_DEFINITIONS = [
  { id: 1, legacyId: 'builtin:module:function', name: '函数', displayCode: 'A', sortOrder: 0 },
  { id: 2, legacyId: 'builtin:module:sequence', name: '数列', displayCode: 'B', sortOrder: 1 },
  { id: 3, legacyId: 'builtin:module:derivative', name: '导数', displayCode: 'C', sortOrder: 2 },
  { id: 4, legacyId: 'builtin:module:conic', name: '圆锥曲线', displayCode: 'D', sortOrder: 3 },
  { id: 5, legacyId: 'builtin:module:solid-geometry', name: '立体几何', displayCode: 'E', sortOrder: 4 },
  { id: 6, legacyId: 'builtin:module:plane-geometry', name: '平面几何', displayCode: 'F', sortOrder: 5 },
  { id: 7, legacyId: 'builtin:module:trigonometry', name: '三角函数', displayCode: 'G', sortOrder: 6 },
  { id: 8, legacyId: 'builtin:module:probability', name: '概率统计', displayCode: 'H', sortOrder: 7 },
  { id: 9, legacyId: 'builtin:module:inequality', name: '不等式', displayCode: 'I', sortOrder: 8 },
  { id: 10, legacyId: 'builtin:module:other', name: '其他', displayCode: 'J', sortOrder: 9 },
] as const satisfies readonly SystemModuleDefinition[];

export const UNCLASSIFIED_MODULE_ID = 11;
export const UNCLASSIFIED_MODULE_NAME = '未分类';
export const UNCLASSIFIED_MODULE_DISPLAY_CODE = 'Z';

export const CUSTOM_MODULE_ID_START = 1001;
export const CUSTOM_MODULE_NEW_NUMBER_FLOOR = 16;
export const CUSTOM_MODULE_MAX_NUMBER = 999;
export const MODULE_QUESTION_MAX_NUMBER = 999;

export function formatCustomModuleDisplayCode(customNo: number): string {
  return `U${customNo.toString().padStart(3, '0')}`;
}

export function formatMistakeDisplayCode(
  moduleDisplayCode: string | null | undefined,
  questionNo: number,
): string {
  const normalizedModuleCode = moduleDisplayCode?.trim().toUpperCase() ?? '';
  const normalizedQuestionNo = Math.floor(questionNo);
  const isSystemOrUnclassifiedCode = /^[A-Z]$/.test(normalizedModuleCode);
  const isCustomCode = /^U\d{3}$/.test(normalizedModuleCode);

  if (
    (!isSystemOrUnclassifiedCode && !isCustomCode)
    || !Number.isFinite(normalizedQuestionNo)
    || normalizedQuestionNo < 1
    || normalizedQuestionNo > MODULE_QUESTION_MAX_NUMBER
  ) {
    return '';
  }

  const questionCode = normalizedQuestionNo.toString().padStart(3, '0');
  return isCustomCode
    ? `${normalizedModuleCode}-${questionCode}`
    : `${normalizedModuleCode}${questionCode}`;
}

export function parseMistakeDisplayCode(
  value: string | null | undefined,
): ParsedMistakeDisplayCode | null {
  const normalizedValue = value?.trim().toUpperCase() ?? '';
  const systemMatch = /^([A-JZ])(\d{3})$/.exec(normalizedValue);
  if (systemMatch) {
    const questionNo = Number(systemMatch[2]);
    return questionNo >= 1 && questionNo <= MODULE_QUESTION_MAX_NUMBER
      ? { moduleDisplayCode: systemMatch[1], questionNo }
      : null;
  }

  const customMatch = /^(U\d{3})-(\d{3})$/.exec(normalizedValue);
  if (!customMatch) {
    return null;
  }

  const customModuleNo = Number(customMatch[1].slice(1));
  const questionNo = Number(customMatch[2]);
  if (
    customModuleNo < 1
    || customModuleNo > CUSTOM_MODULE_MAX_NUMBER
    || questionNo < 1
    || questionNo > MODULE_QUESTION_MAX_NUMBER
  ) {
    return null;
  }

  return {
    moduleDisplayCode: customMatch[1],
    questionNo,
  };
}

export function resolveSystemModuleByLegacyIdOrName(
  legacyId: string | null | undefined,
  name: string | null | undefined,
): SystemModuleDefinition | null {
  const normalizedLegacyId = typeof legacyId === 'string' ? legacyId.trim() : '';
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  return SYSTEM_MODULE_DEFINITIONS.find((item) => (
    item.legacyId === normalizedLegacyId || item.name === normalizedName
  )) ?? null;
}

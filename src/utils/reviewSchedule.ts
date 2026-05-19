import { parseLocalDateTime, toDateOnlyString } from '@/src/utils/date';

export interface NextReviewTextInput {
  reviewCount: number;
  maxReviewCount: number;
  nextReviewAt?: string | null;
  now?: Date;
}

export type NextReviewTextTone = 'default' | 'success' | 'muted' | 'danger';

export interface NextReviewTextResult {
  label: string;
  absoluteDate: string | null;
  displayText: string;
  tone: NextReviewTextTone;
}

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

function getDayDiff(baseDate: Date, targetDate: Date): number {
  const baseDay = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  const targetDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
  return Math.floor((targetDay.getTime() - baseDay.getTime()) / (24 * 60 * 60 * 1000));
}

function resolveLabelByDayDiff(dayDiff: number, parsed: Date, now: Date): string {
  if (dayDiff === 0) {
    return '今天';
  }
  if (dayDiff === 1) {
    return '明天';
  }
  if (dayDiff === 2) {
    return '后天';
  }

  if (parsed.getFullYear() === now.getFullYear()) {
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${month}-${day}`;
  }

  return toDateOnlyString(parsed);
}

function formatAbsoluteDateWithWeekday(parsed: Date): string {
  const weekday = WEEKDAY_LABELS[parsed.getDay()] ?? '';
  return `${weekday}，${toDateOnlyString(parsed)}`;
}

export function resolveNextReviewAtText(input: NextReviewTextInput): NextReviewTextResult {
  const reviewCount = Number.isFinite(input.reviewCount) ? input.reviewCount : 0;
  const maxReviewCount = Number.isFinite(input.maxReviewCount) ? input.maxReviewCount : 7;

  if (reviewCount >= maxReviewCount) {
    return {
      label: '无需复做',
      absoluteDate: null,
      displayText: '✓ 无需复做',
      tone: 'success',
    };
  }

  const parsed = parseLocalDateTime(input.nextReviewAt ?? null);
  if (!parsed) {
    return {
      label: '待安排',
      absoluteDate: null,
      displayText: '⏳ 待安排（完成本次复做后自动生成）',
      tone: 'muted',
    };
  }

  const now = input.now ?? new Date();
  const dayDiff = getDayDiff(now, parsed);
  const absoluteDate = toDateOnlyString(parsed);
  const absoluteWithWeekday = formatAbsoluteDateWithWeekday(parsed);

  if (dayDiff < 0) {
    const overdueDays = Math.abs(dayDiff);
    return {
      label: `已逾期${overdueDays}天`,
      absoluteDate,
      displayText: `⚠ 已逾期${overdueDays}天（应于${absoluteWithWeekday}复做）`,
      tone: 'danger',
    };
  }

  if (dayDiff === 0) {
    return {
      label: '今天应复做',
      absoluteDate,
      displayText: `📌 今天应复做（${absoluteWithWeekday}）`,
      tone: 'danger',
    };
  }

  if (dayDiff <= 2) {
    const label = resolveLabelByDayDiff(dayDiff, parsed, now);
    return {
      label: `${label}复做`,
      absoluteDate,
      displayText: `📅 ${label}复做（${absoluteWithWeekday}）`,
      tone: 'default',
    };
  }

  return {
    label: '计划复做',
    absoluteDate,
    displayText: `📅 计划复做（${absoluteWithWeekday}）`,
    tone: 'default',
  };
}

export function formatNextReviewAtText(input: NextReviewTextInput): string {
  return resolveNextReviewAtText(input).displayText;
}

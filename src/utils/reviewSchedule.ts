import { parseLocalDateTime, toDateOnlyString } from '@/src/utils/date';

export interface NextReviewTextInput {
  reviewCount: number;
  maxReviewCount: number;
  nextReviewAt?: string | null;
  now?: Date;
}

function getDayDiff(baseDate: Date, targetDate: Date): number {
  const baseDay = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  const targetDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
  return Math.floor((targetDay.getTime() - baseDay.getTime()) / (24 * 60 * 60 * 1000));
}

export function formatNextReviewAtText(input: NextReviewTextInput): string {
  const reviewCount = Number.isFinite(input.reviewCount) ? input.reviewCount : 0;
  const maxReviewCount = Number.isFinite(input.maxReviewCount) ? input.maxReviewCount : 7;

  if (reviewCount >= maxReviewCount) {
    return '无需复做';
  }

  const parsed = parseLocalDateTime(input.nextReviewAt ?? null);
  if (!parsed) {
    return '待安排';
  }

  const now = input.now ?? new Date();
  const dayDiff = getDayDiff(now, parsed);

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

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function addDays(date: Date, days: number): Date {
  const safeDays = Number.isFinite(days) ? Math.floor(days) : 0;
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + safeDays);
  return next;
}

export function toDateOnlyString(date: Date): string {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  return `${year}-${month}-${day}`;
}

export function formatDateShort(iso: string): string {
  const parsed = new Date(iso);
  if (!Number.isNaN(parsed.getTime())) {
    return toDateOnlyString(parsed);
  }

  const trimmed = typeof iso === 'string' ? iso.trim() : '';
  if (trimmed.length >= 10) {
    return trimmed.slice(0, 10);
  }
  return '';
}

export function isDueTodayOrBefore(iso?: string | null): boolean {
  if (!iso || typeof iso !== 'string' || iso.trim().length === 0) {
    return false;
  }

  const dueDate = new Date(iso);
  if (Number.isNaN(dueDate.getTime())) {
    return false;
  }

  return toDateOnlyString(dueDate) <= toDateOnlyString(new Date());
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

export function endOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

export function getLocalDayRange(baseDate = new Date(), offsetDays = 0): {
  start: Date;
  end: Date;
} {
  const day = addDays(startOfLocalDay(baseDate), offsetDays);
  return {
    start: startOfLocalDay(day),
    end: endOfLocalDay(day),
  };
}

export function parseLocalDateTime(value: string | null | undefined): Date | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const monthIndex = Number(dateOnlyMatch[2]) - 1;
    const day = Number(dateOnlyMatch[3]);
    const localDate = new Date(year, monthIndex, day, 0, 0, 0, 0);
    return Number.isNaN(localDate.getTime()) ? null : localDate;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
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

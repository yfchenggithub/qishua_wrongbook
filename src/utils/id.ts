const RANDOM_SUFFIX_LENGTH = 4;

function padTwoDigits(value: number): string {
  return value.toString().padStart(2, '0');
}

function formatTimestamp(now: Date): string {
  const year = now.getFullYear();
  const month = padTwoDigits(now.getMonth() + 1);
  const day = padTwoDigits(now.getDate());
  const hour = padTwoDigits(now.getHours());
  const minute = padTwoDigits(now.getMinutes());
  const second = padTwoDigits(now.getSeconds());

  return `${year}${month}${day}${hour}${minute}${second}`;
}

function buildRandomSuffix(length = RANDOM_SUFFIX_LENGTH): string {
  const randomPart = Math.random().toString(36).slice(2, 2 + length).toUpperCase();
  return randomPart.padEnd(length, '0');
}

function normalizePrefix(prefix: string): string {
  const normalized = prefix.trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (!normalized) {
    throw new Error('prefix must contain at least one alphanumeric character.');
  }

  return normalized;
}

export function createRecordId(prefix: string): string {
  const now = new Date();
  const safePrefix = normalizePrefix(prefix);
  return `${safePrefix}${formatTimestamp(now)}${buildRandomSuffix()}`;
}

export function createMistakeId(): string {
  return createRecordId('M');
}

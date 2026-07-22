import type { RuntimeLogItem } from '@/src/services/Logger';

export type RuntimeLogLevelFilter = 'all' | RuntimeLogItem['level'];
export type RuntimeLogTimeOrder = 'desc' | 'asc';
export type RuntimeLogCountScope = 'all' | 'recent50';

export interface RuntimeLogQuery {
  levelFilter: RuntimeLogLevelFilter;
  keyword: string;
  countScope: RuntimeLogCountScope;
  timeOrder: RuntimeLogTimeOrder;
}

function safeMetadataSearchText(metadata: unknown): string {
  if (metadata === undefined) {
    return '';
  }

  if (typeof metadata === 'string') {
    return metadata;
  }

  try {
    const seen = new WeakSet<object>();
    const serialized = JSON.stringify(metadata, (_key, value: unknown) => {
      if (typeof value === 'bigint') {
        return value.toString();
      }
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular]';
        }
        seen.add(value);
      }
      return value;
    });
    return typeof serialized === 'string' ? serialized : String(metadata);
  } catch {
    try {
      return String(metadata);
    } catch {
      return '[无法序列化]';
    }
  }
}

function getTimestampValue(timestamp: string): number {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatSearchTimestamp(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return timestamp;
  }

  const pad2 = (value: number) => String(value).padStart(2, '0');
  const milliseconds = String(parsed.getMilliseconds()).padStart(3, '0');
  return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())} ${pad2(parsed.getHours())}:${pad2(parsed.getMinutes())}:${pad2(parsed.getSeconds())}.${milliseconds}`;
}

/**
 * Produces the one canonical result set shared by the runtime-log list and TXT export.
 * The order intentionally follows: level -> keyword -> range -> time order.
 */
export function selectRuntimeLogs(
  logs: readonly RuntimeLogItem[],
  query: RuntimeLogQuery,
): RuntimeLogItem[] {
  const normalizedKeyword = query.keyword.trim().toLowerCase();
  let selectedLogs = query.levelFilter === 'all'
    ? logs.slice()
    : logs.filter((log) => log.level === query.levelFilter);

  if (normalizedKeyword) {
    selectedLogs = selectedLogs.filter((log) => {
      const haystack = [
        log.timestamp,
        formatSearchTimestamp(log.timestamp),
        log.level,
        log.scope ?? '',
        log.message,
        safeMetadataSearchText(log.metadata),
      ].join(' ').toLowerCase();
      return haystack.includes(normalizedKeyword);
    });
  }

  if (query.countScope === 'recent50' && selectedLogs.length > 50) {
    selectedLogs = selectedLogs.slice(-50);
  }

  return selectedLogs.slice().sort((left, right) => {
    const difference = getTimestampValue(left.timestamp) - getTimestampValue(right.timestamp);
    return query.timeOrder === 'asc' ? difference : -difference;
  });
}

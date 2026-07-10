import type { TextHighlightColor, TextHighlightRange } from '@/src/models/TextHighlight';

const TEXT_HIGHLIGHT_COLORS: TextHighlightColor[] = ['yellow', 'red', 'green'];

export const TEXT_HIGHLIGHT_BACKGROUND: Record<TextHighlightColor, string> = {
  yellow: 'rgba(250, 204, 21, 0.42)',
  red: 'rgba(248, 113, 113, 0.34)',
  green: 'rgba(74, 222, 128, 0.34)',
};

export type TextHighlightSelection = {
  start: number;
  end: number;
};

export type TextHighlightSegment = {
  text: string;
  color?: TextHighlightColor;
};

function getTextLength(text: string | number): number {
  if (typeof text === 'number') {
    return Number.isFinite(text) ? Math.max(0, Math.floor(text)) : 0;
  }
  return text.length;
}

function isTextHighlightColor(value: unknown): value is TextHighlightColor {
  return typeof value === 'string' && TEXT_HIGHLIGHT_COLORS.includes(value as TextHighlightColor);
}

function normalizeBoundary(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.floor(value));
}

function compareHighlights(left: TextHighlightRange, right: TextHighlightRange): number {
  if (left.start !== right.start) {
    return left.start - right.start;
  }
  if (left.end !== right.end) {
    return left.end - right.end;
  }
  return left.color.localeCompare(right.color);
}

function mergeAdjacentHighlights(highlights: TextHighlightRange[]): TextHighlightRange[] {
  const merged: TextHighlightRange[] = [];

  for (const highlight of highlights) {
    const previous = merged[merged.length - 1];
    if (previous && previous.color === highlight.color && previous.end === highlight.start) {
      previous.end = highlight.end;
      continue;
    }
    merged.push({ ...highlight });
  }

  return merged;
}

export function normalizeTextHighlights(
  value: unknown,
  text: string | number,
): TextHighlightRange[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const textLength = getTextLength(text);
  if (textLength <= 0) {
    return [];
  }

  const normalized: TextHighlightRange[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const candidate = item as Partial<TextHighlightRange>;
    const start = normalizeBoundary(candidate.start);
    const end = normalizeBoundary(candidate.end);
    if (start === null || end === null || !isTextHighlightColor(candidate.color)) {
      continue;
    }

    const clampedStart = Math.min(start, textLength);
    const clampedEnd = Math.min(end, textLength);
    if (clampedEnd <= clampedStart) {
      continue;
    }

    normalized.push({
      start: clampedStart,
      end: clampedEnd,
      color: candidate.color,
    });
  }

  return mergeAdjacentHighlights(normalized.sort(compareHighlights));
}

export function parseStoredTextHighlights(
  value: string | null | undefined,
  text: string | null | undefined,
): TextHighlightRange[] {
  if (typeof value !== 'string') {
    return [];
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  try {
    return normalizeTextHighlights(JSON.parse(trimmed) as unknown, text ?? '');
  } catch {
    return [];
  }
}

export function serializeTextHighlights(
  highlights: TextHighlightRange[] | null | undefined,
  text: string | null | undefined,
): string | null {
  const normalized = normalizeTextHighlights(highlights ?? [], text ?? '');
  return normalized.length > 0 ? JSON.stringify(normalized) : null;
}

export function areTextHighlightsEqual(
  left: TextHighlightRange[] | null | undefined,
  right: TextHighlightRange[] | null | undefined,
  text: string | number,
): boolean {
  const normalizedLeft = normalizeTextHighlights(left ?? [], text);
  const normalizedRight = normalizeTextHighlights(right ?? [], text);
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }

  return normalizedLeft.every((item, index) => {
    const other = normalizedRight[index];
    return item.start === other.start && item.end === other.end && item.color === other.color;
  });
}

function normalizeSelection(
  selection: TextHighlightSelection | null | undefined,
  text: string,
): TextHighlightSelection | null {
  if (!selection || text.length <= 0) {
    return null;
  }

  const start = normalizeBoundary(selection.start);
  const end = normalizeBoundary(selection.end);
  if (start === null || end === null) {
    return null;
  }

  const normalizedStart = Math.max(0, Math.min(Math.min(start, end), text.length));
  const normalizedEnd = Math.max(0, Math.min(Math.max(start, end), text.length));
  if (normalizedEnd <= normalizedStart) {
    return null;
  }

  return {
    start: normalizedStart,
    end: normalizedEnd,
  };
}

function removeSelectionOverlap(
  highlights: TextHighlightRange[],
  selection: TextHighlightSelection,
): TextHighlightRange[] {
  const nextHighlights: TextHighlightRange[] = [];

  for (const highlight of highlights) {
    const hasOverlap = highlight.start < selection.end && selection.start < highlight.end;
    if (!hasOverlap) {
      nextHighlights.push(highlight);
      continue;
    }

    if (highlight.start < selection.start) {
      nextHighlights.push({
        start: highlight.start,
        end: Math.min(selection.start, highlight.end),
        color: highlight.color,
      });
    }

    if (highlight.end > selection.end) {
      nextHighlights.push({
        start: Math.max(selection.end, highlight.start),
        end: highlight.end,
        color: highlight.color,
      });
    }
  }

  return nextHighlights;
}

export function applyTextHighlightSelection(
  highlights: TextHighlightRange[] | null | undefined,
  text: string,
  selection: TextHighlightSelection | null | undefined,
  color: TextHighlightColor,
): TextHighlightRange[] {
  const normalizedSelection = normalizeSelection(selection, text);
  if (!normalizedSelection) {
    return normalizeTextHighlights(highlights ?? [], text);
  }

  const baseHighlights = normalizeTextHighlights(highlights ?? [], text);
  const withoutOverlap = removeSelectionOverlap(baseHighlights, normalizedSelection);
  withoutOverlap.push({
    start: normalizedSelection.start,
    end: normalizedSelection.end,
    color,
  });

  return normalizeTextHighlights(withoutOverlap, text);
}

export function clearTextHighlightSelection(
  highlights: TextHighlightRange[] | null | undefined,
  text: string,
  selection: TextHighlightSelection | null | undefined,
): TextHighlightRange[] {
  const normalizedSelection = normalizeSelection(selection, text);
  if (!normalizedSelection) {
    return normalizeTextHighlights(highlights ?? [], text);
  }

  return normalizeTextHighlights(
    removeSelectionOverlap(normalizeTextHighlights(highlights ?? [], text), normalizedSelection),
    text,
  );
}

export function buildTextHighlightSegments(
  text: string,
  highlights: TextHighlightRange[] | null | undefined,
): TextHighlightSegment[] {
  if (text.length <= 0) {
    return [];
  }

  const segments: TextHighlightSegment[] = [];
  const normalizedHighlights = normalizeTextHighlights(highlights ?? [], text);
  let cursor = 0;

  for (const highlight of normalizedHighlights) {
    if (highlight.start > cursor) {
      segments.push({ text: text.slice(cursor, highlight.start) });
    }

    segments.push({
      text: text.slice(highlight.start, highlight.end),
      color: highlight.color,
    });
    cursor = highlight.end;
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor) });
  }

  return segments;
}

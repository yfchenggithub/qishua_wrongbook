export type DetailBrowseDirection = 'next' | 'prev';

export type LibraryBrowseTargetResolution =
  | {
      kind: 'target';
      currentIndex: number;
      targetId: string;
      targetIndex: number;
      skippedIds: string[];
    }
  | {
      kind: 'boundary';
      boundary: 'start' | 'end';
      currentIndex: number;
      targetId: null;
      targetIndex: -1;
      skippedIds: [];
    }
  | {
      kind: 'no_available';
      currentIndex: number;
      targetId: null;
      targetIndex: -1;
      skippedIds: string[];
    }
  | {
      kind: 'invalid_current';
      currentIndex: -1;
      targetId: null;
      targetIndex: -1;
      skippedIds: string[];
    }
  | {
      kind: 'cancelled';
      currentIndex: -1;
      targetId: null;
      targetIndex: -1;
      skippedIds: string[];
    };

export type DetailSwitchRouteParams = {
  id: string;
  switchFrom: 'bottom' | 'top';
  browseSessionId?: string;
  skippedUnavailableCount?: string;
};

export function buildDetailSwitchRouteParams(input: {
  targetId: string;
  direction: DetailBrowseDirection;
  browseSessionId?: string | null;
  skippedUnavailableCount?: number;
}): DetailSwitchRouteParams {
  const browseSessionId = input.browseSessionId?.trim() ?? '';
  const skippedUnavailableCount = Number.isInteger(input.skippedUnavailableCount)
    ? Math.max(0, input.skippedUnavailableCount ?? 0)
    : 0;

  return {
    id: input.targetId.trim(),
    switchFrom: input.direction === 'next' ? 'bottom' : 'top',
    ...(browseSessionId ? { browseSessionId } : {}),
    ...(skippedUnavailableCount > 0
      ? { skippedUnavailableCount: String(skippedUnavailableCount) }
      : {}),
  };
}

export async function resolveLibraryBrowseTarget(input: {
  ids: readonly string[];
  currentMistakeId: string;
  direction: DetailBrowseDirection;
  isCandidateAvailable: (mistakeId: string) => Promise<boolean>;
  isCancelled?: () => boolean;
}): Promise<LibraryBrowseTargetResolution> {
  const currentMistakeId = input.currentMistakeId.trim();
  const currentIndex = input.ids.indexOf(currentMistakeId);
  if (!currentMistakeId || currentIndex < 0) {
    return {
      kind: 'invalid_current',
      currentIndex: -1,
      targetId: null,
      targetIndex: -1,
      skippedIds: [],
    };
  }

  const reachedStart = input.direction === 'prev' && currentIndex === 0;
  const reachedEnd = input.direction === 'next' && currentIndex === input.ids.length - 1;
  if (reachedStart || reachedEnd) {
    return {
      kind: 'boundary',
      boundary: reachedStart ? 'start' : 'end',
      currentIndex,
      targetId: null,
      targetIndex: -1,
      skippedIds: [],
    };
  }

  const step = input.direction === 'next' ? 1 : -1;
  const skippedIds: string[] = [];
  let targetIndex = currentIndex + step;
  while (targetIndex >= 0 && targetIndex < input.ids.length) {
    if (input.isCancelled?.()) {
      return {
        kind: 'cancelled',
        currentIndex: -1,
        targetId: null,
        targetIndex: -1,
        skippedIds,
      };
    }

    const candidateId = input.ids[targetIndex];
    const available = candidateId
      ? await input.isCandidateAvailable(candidateId)
      : false;
    if (input.isCancelled?.()) {
      return {
        kind: 'cancelled',
        currentIndex: -1,
        targetId: null,
        targetIndex: -1,
        skippedIds,
      };
    }
    if (candidateId && available) {
      return {
        kind: 'target',
        currentIndex,
        targetId: candidateId,
        targetIndex,
        skippedIds,
      };
    }
    if (candidateId) {
      skippedIds.push(candidateId);
    }
    targetIndex += step;
  }

  return {
    kind: 'no_available',
    currentIndex,
    targetId: null,
    targetIndex: -1,
    skippedIds,
  };
}

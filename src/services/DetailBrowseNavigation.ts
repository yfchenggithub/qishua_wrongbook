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

export type DeletedMistakeBrowseTargetResolution =
  | {
      kind: 'target';
      currentIndex: number;
      direction: DetailBrowseDirection;
      targetId: string;
      targetIndex: number;
      skippedIds: string[];
    }
  | {
      kind: 'no_available';
      currentIndex: number;
      direction: null;
      targetId: null;
      targetIndex: -1;
      skippedIds: string[];
    }
  | {
      kind: 'invalid_current';
      currentIndex: -1;
      direction: null;
      targetId: null;
      targetIndex: -1;
      skippedIds: [];
    }
  | {
      kind: 'cancelled';
      currentIndex: -1;
      direction: null;
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

export async function resolveDeletedMistakeBrowseTarget(input: {
  ids: readonly string[];
  deletedMistakeId: string;
  isCandidateAvailable: (mistakeId: string) => Promise<boolean>;
  isCancelled?: () => boolean;
}): Promise<DeletedMistakeBrowseTargetResolution> {
  const deletedMistakeId = input.deletedMistakeId.trim();
  const currentIndex = input.ids.indexOf(deletedMistakeId);
  if (!deletedMistakeId || currentIndex < 0) {
    return {
      kind: 'invalid_current',
      currentIndex: -1,
      direction: null,
      targetId: null,
      targetIndex: -1,
      skippedIds: [],
    };
  }

  const skippedIds: string[] = [];
  const candidateIndexes: {
    direction: DetailBrowseDirection;
    targetIndex: number;
  }[] = [];

  for (let targetIndex = currentIndex + 1; targetIndex < input.ids.length; targetIndex += 1) {
    candidateIndexes.push({ direction: 'next', targetIndex });
  }
  for (let targetIndex = currentIndex - 1; targetIndex >= 0; targetIndex -= 1) {
    candidateIndexes.push({ direction: 'prev', targetIndex });
  }

  for (const candidate of candidateIndexes) {
    if (input.isCancelled?.()) {
      return {
        kind: 'cancelled',
        currentIndex: -1,
        direction: null,
        targetId: null,
        targetIndex: -1,
        skippedIds,
      };
    }

    const candidateId = input.ids[candidate.targetIndex];
    const available = candidateId
      ? await input.isCandidateAvailable(candidateId)
      : false;
    if (input.isCancelled?.()) {
      return {
        kind: 'cancelled',
        currentIndex: -1,
        direction: null,
        targetId: null,
        targetIndex: -1,
        skippedIds,
      };
    }
    if (candidateId && available) {
      return {
        kind: 'target',
        currentIndex,
        direction: candidate.direction,
        targetId: candidateId,
        targetIndex: candidate.targetIndex,
        skippedIds,
      };
    }
    if (candidateId) {
      skippedIds.push(candidateId);
    }
  }

  return {
    kind: 'no_available',
    currentIndex,
    direction: null,
    targetId: null,
    targetIndex: -1,
    skippedIds,
  };
}

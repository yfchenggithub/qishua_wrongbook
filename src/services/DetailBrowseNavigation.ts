export type DetailBrowseDirection = 'next' | 'prev';

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

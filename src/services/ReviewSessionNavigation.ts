export type ReviewNavigationDirection = 'prev' | 'next';
export type ModuleFilterValue = string | null;

type ReviewQueueItemWithModule = {
  module?: string | null;
};

export function normalizeModuleFilterValue(moduleName: string | null | undefined): string {
  const normalized = typeof moduleName === 'string' ? moduleName.trim() : '';
  return normalized.length > 0 ? normalized : '未分类';
}

export function isQueueItemInModuleFilter(
  item: ReviewQueueItemWithModule,
  moduleFilter: ModuleFilterValue,
): boolean {
  if (moduleFilter === null) {
    return true;
  }
  return normalizeModuleFilterValue(item.module) === moduleFilter;
}

export function findAdjacentReviewIndex(
  queue: readonly ReviewQueueItemWithModule[],
  startIndex: number,
  direction: ReviewNavigationDirection,
  moduleFilter: ModuleFilterValue = null,
): number | null {
  const step = direction === 'prev' ? -1 : 1;
  let index = startIndex;

  while (index >= 0 && index < queue.length) {
    const item = queue[index];
    if (item && isQueueItemInModuleFilter(item, moduleFilter)) {
      return index;
    }
    index += step;
  }

  return null;
}

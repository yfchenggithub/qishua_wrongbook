export type DetailBrowseMode = 'library_filter' | 'today_due' | 'same_module' | 'none';

export type DetailBrowseContext = {
  mode: DetailBrowseMode;
  ids: string[];
  currentIndex: number;
};

export type DetailBrowseContextResolverParams = {
  mistakeId: string;
  module: string;
  browseSessionId?: string | null;
};

export type DetailBrowseContextResolverDependencies = {
  getLibraryBrowseSession: (
    sessionId: string,
  ) => { mistakeIds: readonly string[] } | null;
  getTodayDueIds: () => Promise<readonly string[]>;
  getSameModuleIds: (moduleName: string) => Promise<readonly string[]>;
};

function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.length > 0 ? normalized : null;
}

function normalizeMistakeIdList(ids: readonly string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const id of ids) {
    const mistakeId = normalizeOptionalText(id);
    if (!mistakeId || seen.has(mistakeId)) {
      continue;
    }
    normalized.push(mistakeId);
    seen.add(mistakeId);
  }

  return normalized;
}

export function buildDetailBrowseContext(
  mode: DetailBrowseMode,
  ids: readonly string[],
  currentMistakeId: string,
): DetailBrowseContext {
  const normalizedCurrentId = normalizeOptionalText(currentMistakeId) ?? '';
  const normalizedIds = normalizeMistakeIdList(ids);
  if (!normalizedCurrentId) {
    return {
      mode: 'none',
      ids: [],
      currentIndex: -1,
    };
  }
  if (normalizedIds.length <= 0) {
    return {
      mode: 'none',
      ids: [normalizedCurrentId],
      currentIndex: 0,
    };
  }

  const currentIndex = normalizedIds.indexOf(normalizedCurrentId);
  if (currentIndex >= 0) {
    return {
      mode,
      ids: normalizedIds,
      currentIndex,
    };
  }

  return {
    mode,
    ids: [normalizedCurrentId, ...normalizedIds],
    currentIndex: 0,
  };
}

export async function resolveDetailBrowseContext(
  params: DetailBrowseContextResolverParams,
  dependencies: DetailBrowseContextResolverDependencies,
): Promise<DetailBrowseContext> {
  const mistakeId = normalizeOptionalText(params.mistakeId) ?? '';
  if (!mistakeId) {
    return buildDetailBrowseContext('none', [], '');
  }

  const browseSessionId = normalizeOptionalText(params.browseSessionId);
  if (browseSessionId) {
    const session = dependencies.getLibraryBrowseSession(browseSessionId);
    if (session?.mistakeIds.includes(mistakeId)) {
      return buildDetailBrowseContext('library_filter', session.mistakeIds, mistakeId);
    }
    return buildDetailBrowseContext('none', [mistakeId], mistakeId);
  }

  const dueIds = normalizeMistakeIdList(await dependencies.getTodayDueIds());
  if (dueIds.includes(mistakeId)) {
    return buildDetailBrowseContext('today_due', dueIds, mistakeId);
  }

  const moduleName = normalizeOptionalText(params.module);
  if (!moduleName) {
    return buildDetailBrowseContext('none', [mistakeId], mistakeId);
  }

  const sameModuleIds = normalizeMistakeIdList(
    await dependencies.getSameModuleIds(moduleName),
  );
  if (sameModuleIds.length > 0) {
    return buildDetailBrowseContext('same_module', sameModuleIds, mistakeId);
  }
  return buildDetailBrowseContext('none', [mistakeId], mistakeId);
}

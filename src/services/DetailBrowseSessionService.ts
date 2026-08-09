const MAX_LIBRARY_BROWSE_SESSIONS = 8;

type LibraryBrowseSession = {
  id: string;
  mistakeIds: readonly string[];
};

const libraryBrowseSessions = new Map<string, LibraryBrowseSession>();
let sessionSequence = 0;

function normalizeMistakeIds(values: readonly string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const mistakeId = typeof value === 'string' ? value.trim() : '';
    if (!mistakeId || seen.has(mistakeId)) {
      continue;
    }
    normalized.push(mistakeId);
    seen.add(mistakeId);
  }

  return normalized;
}

function normalizeSessionId(value: string | null | undefined): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.length > 0 ? normalized : null;
}

function removeOldestSessionIfNeeded(): void {
  while (libraryBrowseSessions.size >= MAX_LIBRARY_BROWSE_SESSIONS) {
    const oldestSessionId = libraryBrowseSessions.keys().next().value;
    if (typeof oldestSessionId !== 'string') {
      return;
    }
    libraryBrowseSessions.delete(oldestSessionId);
  }
}

export function createLibraryBrowseSession(mistakeIds: readonly string[]): string | null {
  const normalizedIds = normalizeMistakeIds(mistakeIds);
  if (normalizedIds.length <= 0) {
    return null;
  }

  removeOldestSessionIfNeeded();
  sessionSequence += 1;
  const sessionId = `library-${Date.now().toString(36)}-${sessionSequence.toString(36)}`;
  libraryBrowseSessions.set(sessionId, {
    id: sessionId,
    mistakeIds: Object.freeze([...normalizedIds]),
  });
  return sessionId;
}

export function getLibraryBrowseSession(
  sessionId: string | null | undefined,
): LibraryBrowseSession | null {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId) {
    return null;
  }
  return libraryBrowseSessions.get(normalizedSessionId) ?? null;
}

export function removeMistakesFromLibraryBrowseSession(
  sessionId: string | null | undefined,
  mistakeIds: readonly string[],
): readonly string[] | null {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId) {
    return null;
  }

  const session = libraryBrowseSessions.get(normalizedSessionId);
  if (!session) {
    return null;
  }

  const removedIds = new Set(normalizeMistakeIds(mistakeIds));
  if (removedIds.size <= 0) {
    return session.mistakeIds;
  }

  const remainingIds = session.mistakeIds.filter((mistakeId) => !removedIds.has(mistakeId));
  const frozenIds = Object.freeze([...remainingIds]);
  libraryBrowseSessions.set(normalizedSessionId, {
    ...session,
    mistakeIds: frozenIds,
  });
  return frozenIds;
}

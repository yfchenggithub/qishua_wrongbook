export function normalizeSelectionIds(values: Iterable<unknown>): string[] {
  const normalized = new Set<string>();

  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }
    const id = value.trim();
    if (id) {
      normalized.add(id);
    }
  }

  return Array.from(normalized);
}

export function toggleSelectionId(selectedIds: ReadonlySet<string>, idInput: string): Set<string> {
  const id = idInput.trim();
  const next = new Set(selectedIds);
  if (!id) {
    return next;
  }

  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

export function selectAllVisibleIds(visibleIds: Iterable<unknown>): Set<string> {
  return new Set(normalizeSelectionIds(visibleIds));
}

export function reconcileSelectionWithVisibleIds(
  selectedIds: ReadonlySet<string>,
  visibleIds: Iterable<unknown>,
): Set<string> {
  const visible = new Set(normalizeSelectionIds(visibleIds));
  return new Set(Array.from(selectedIds).filter((id) => visible.has(id)));
}

export function areAllVisibleIdsSelected(
  selectedIds: ReadonlySet<string>,
  visibleIds: Iterable<unknown>,
): boolean {
  const visible = normalizeSelectionIds(visibleIds);
  return visible.length > 0 && visible.every((id) => selectedIds.has(id));
}

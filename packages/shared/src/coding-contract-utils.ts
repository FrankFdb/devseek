export function snapshotCodingValue(value: unknown, label: string, seen = new Set<object>()): unknown {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value === undefined) return undefined;
  if (typeof value !== 'object') throw new Error(`coding-contract:invalid-${label}`);
  if (seen.has(value)) throw new Error(`coding-contract:cyclic-${label}`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return Object.freeze(value.map(child => snapshotCodingValue(child, label, seen)));
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new Error(`coding-contract:non-plain-${label}`);
    }
    return Object.freeze(Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .map(([key, child]) => [key, snapshotCodingValue(child, label, seen)]),
    ));
  } finally {
    seen.delete(value);
  }
}

export function canonicalCodingJson(value: unknown): string {
  return JSON.stringify(sortObjectKeys(value));
}

export function normalizedCodingId(value: string, label: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new Error(`coding-contract:missing-${label}`);
  return normalized;
}

export function normalizeCodingErrorCode(value: string | undefined): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '')
    : '';
}

export function uniqueCodingRefs(values: readonly string[]): string[] {
  return [...new Set(values.map(value => typeof value === 'string' ? value.trim() : '').filter(Boolean))];
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortObjectKeys(child)]),
  );
}

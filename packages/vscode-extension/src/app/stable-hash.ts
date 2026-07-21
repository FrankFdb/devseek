import * as crypto from 'crypto';

export function stableHash(input: unknown, length = 16): string {
  const digest = stableSha256(input);
  return length > 0 ? digest.slice(0, length) : digest;
}

export function stableSha256(input: unknown): string {
  return crypto.createHash('sha256').update(stableStringify(input)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value !== 'object') {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? '"[undefined]"' : serialized;
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(',')}}`;
}

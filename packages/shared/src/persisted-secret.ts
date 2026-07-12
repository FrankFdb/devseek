export const DEVSEEK_AUTHORITY_CAPABILITY_PREFIX = 'devseek-ra1_' as const;
export const DEVSEEK_AUTHORITY_CAPABILITY_BYTES = 32 as const;

const CAPABILITY_BODY_LENGTH = Math.ceil(DEVSEEK_AUTHORITY_CAPABILITY_BYTES * 4 / 3);
export const DEVSEEK_AUTHORITY_CAPABILITY_LENGTH = DEVSEEK_AUTHORITY_CAPABILITY_PREFIX.length
  + CAPABILITY_BODY_LENGTH;
const CAPABILITY_SOURCE = `${DEVSEEK_AUTHORITY_CAPABILITY_PREFIX}[A-Za-z0-9_-]{${CAPABILITY_BODY_LENGTH}}`;
const CAPABILITY_RE = new RegExp(CAPABILITY_SOURCE);
const CAPABILITY_GLOBAL_RE = new RegExp(CAPABILITY_SOURCE, 'g');
const REDACTED_CAPABILITY = '[REDACTED-DEVSEEK-CAPABILITY]';

export class DevSeekCapabilityBoundaryError extends Error {
  readonly code = 'INVALID_INPUT' as const;

  constructor(message = 'External text contains forbidden secret material') {
    super(message);
    this.name = 'DevSeekCapabilityBoundaryError';
  }
}

/** Detects a complete DevSeek bearer capability, including one embedded in larger text. */
export function containsDevSeekAuthorityCapability(value: string): boolean {
  return CAPABILITY_RE.test(value);
}

/** Removes complete DevSeek bearer capabilities before diagnostic text is persisted. */
export function redactDevSeekAuthorityCapabilities(value: string): string {
  return value.replace(CAPABILITY_GLOBAL_RE, REDACTED_CAPABILITY);
}

/**
 * Recursively inspects both JSON values and object keys. Object keys matter
 * because they are persisted just as literally as string values.
 */
export function containsPersistedDevSeekAuthorityCapability(value: unknown): boolean {
  return visit(value, new WeakSet<object>());
}

/**
 * Delays the trailing capability-width window so a capability split across
 * arbitrary stream chunks is rejected before any portion of it is released.
 */
export class DevSeekCapabilityTextStreamGuard {
  private pending = '';
  private rejected = false;

  push(value: unknown): string {
    if (this.rejected) throw new DevSeekCapabilityBoundaryError();
    if (typeof value !== 'string') {
      this.rejected = true;
      throw new DevSeekCapabilityBoundaryError('External stream chunks must be primitive text');
    }
    const combined = this.pending + value;
    if (containsDevSeekAuthorityCapability(combined)) {
      this.pending = '';
      this.rejected = true;
      throw new DevSeekCapabilityBoundaryError();
    }
    const retainedLength = DEVSEEK_AUTHORITY_CAPABILITY_LENGTH - 1;
    const releaseLength = Math.max(0, combined.length - retainedLength);
    this.pending = combined.slice(releaseLength);
    return combined.slice(0, releaseLength);
  }

  finish(): string {
    if (this.rejected) throw new DevSeekCapabilityBoundaryError();
    if (containsDevSeekAuthorityCapability(this.pending)) {
      this.pending = '';
      this.rejected = true;
      throw new DevSeekCapabilityBoundaryError();
    }
    const value = this.pending;
    this.pending = '';
    return value;
  }
}

function visit(value: unknown, seen: WeakSet<object>): boolean {
  if (typeof value === 'string') return containsDevSeekAuthorityCapability(value);
  if (!value || typeof value !== 'object') return false;
  try {
    if (value instanceof String) {
      return containsDevSeekAuthorityCapability(String.prototype.valueOf.call(value));
    }
  } catch {
    return true;
  }
  if (seen.has(value)) return false;
  seen.add(value);
  try {
    if (value instanceof Error) {
      for (const field of ['name', 'message', 'stack', 'cause'] as const) {
        if (visit(Reflect.get(value, field), seen)) return true;
      }
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') continue;
      if (containsDevSeekAuthorityCapability(key)) return true;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable) continue;
      if (visit(Reflect.get(value, key), seen)) return true;
    }
    return false;
  } catch {
    // Scanner uncertainty is a security decision: fail closed without echoing
    // a potentially secret-bearing getter/Proxy error.
    return true;
  }
}

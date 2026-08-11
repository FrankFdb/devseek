import { redactDevSeekAuthorityCapabilitiesWithCount } from './persisted-secret';

export const CODING_SECRET_REDACTION_VERSION = 'devseek.coding-secret-redaction/v1' as const;
export const CODING_SECRET_REDACTION = '[REDACTED_SECRET]' as const;
export const CODING_SECRET_FIELD_REDACTION = '[REDACTED]' as const;

export type CodingSecretKind =
  | 'devseek-authority-capability'
  | 'private-key'
  | 'provider-token'
  | 'github-token'
  | 'slack-token'
  | 'aws-access-key'
  | 'authorization-header'
  | 'secret-assignment'
  | 'sensitive-field';

export interface CodingSecretRedactionOptions {
  /** Overrides category markers when a boundary requires one stable placeholder. */
  readonly replacement?: string;
  /** Redacts values whose object key denotes secret-bearing material. */
  readonly redactSensitiveFields?: boolean;
  readonly sensitiveFieldReplacement?: string;
}

export interface CodingSecretTextRedaction {
  readonly version: typeof CODING_SECRET_REDACTION_VERSION;
  readonly text: string;
  readonly matches: readonly CodingSecretKind[];
  readonly redactionCount: number;
  readonly redacted: boolean;
}

export interface CodingSecretValueRedaction<T> {
  readonly version: typeof CODING_SECRET_REDACTION_VERSION;
  readonly value: T;
  readonly matches: readonly CodingSecretKind[];
  readonly redactionCount: number;
  readonly redacted: boolean;
}

export interface SecretRedactionPort {
  redactText(value: string, options?: CodingSecretRedactionOptions): CodingSecretTextRedaction;
  redactValue<T>(value: T, options?: CodingSecretRedactionOptions): CodingSecretValueRedaction<T>;
  contains(value: unknown): boolean;
}

interface CodingSecretPattern {
  readonly kind: Exclude<CodingSecretKind, 'devseek-authority-capability' | 'sensitive-field'>;
  readonly source: string;
  readonly flags: string;
  readonly replace: (match: readonly string[], marker: string) => string;
}

const SECRET_PATTERNS: readonly CodingSecretPattern[] = Object.freeze([
  {
    kind: 'private-key',
    source: '-----BEGIN\\s+(?:RSA\\s+|OPENSSH\\s+|EC\\s+|DSA\\s+)?PRIVATE KEY-----[\\s\\S]*?-----END\\s+(?:RSA\\s+|OPENSSH\\s+|EC\\s+|DSA\\s+)?PRIVATE KEY-----',
    flags: 'giu',
    replace: (_match, marker) => marker,
  },
  {
    kind: 'github-token',
    source: '\\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\\b|\\bgithub_pat_[A-Za-z0-9_]{20,}\\b',
    flags: 'gu',
    replace: (_match, marker) => marker,
  },
  {
    kind: 'slack-token',
    source: '\\bxox[baprs]-[A-Za-z0-9-]{10,}\\b',
    flags: 'gu',
    replace: (_match, marker) => marker,
  },
  {
    kind: 'aws-access-key',
    source: '\\bAKIA[0-9A-Z]{16}\\b',
    flags: 'gu',
    replace: (_match, marker) => marker,
  },
  {
    kind: 'provider-token',
    source: '\\bsk-[A-Za-z0-9_-]{8,}\\b',
    flags: 'gu',
    replace: (_match, marker) => marker,
  },
  {
    kind: 'authorization-header',
    source: '\\b(authorization\\s*[:=]\\s*(?:bearer|basic)\\s+)(?!\\[REDACTED)[A-Za-z0-9._~+/=-]{6,}\\b|\\b(bearer\\s+)(?!\\[REDACTED)[A-Za-z0-9._~+/=-]{8,}\\b',
    flags: 'giu',
    replace: (match, marker) => `${match[1] || match[2] || ''}${marker}`,
  },
  {
    kind: 'secret-assignment',
    source: String.raw`\b((?:api[_-]?key|token|password|passwd|pwd|secret|cookie|session|credential)\s*[:=]\s*["']?)(?!\[REDACTED)[^\s,;"']{4,}`,
    flags: 'giu',
    replace: (match, marker) => `${match[1] || ''}${marker}`,
  },
]);

const SENSITIVE_FIELD_RE = /(?:^|[_-])(?:token|cookie|authorization|password|passwd|pwd|secret|api[_-]?key|session|credential|headers?)(?:$|[_-])/iu;

export class CanonicalSecretRedactionService implements SecretRedactionPort {
  redactText(
    value: string,
    options: CodingSecretRedactionOptions = {},
  ): CodingSecretTextRedaction {
    let text = String(value ?? '');
    let redactionCount = 0;
    const matches = new Set<CodingSecretKind>();

    const capability = redactDevSeekAuthorityCapabilitiesWithCount(text);
    if (capability.count > 0) {
      text = options.replacement
        ? capability.text.replace(/\[REDACTED-DEVSEEK-CAPABILITY\]/gu, options.replacement)
        : capability.text;
      redactionCount += capability.count;
      matches.add('devseek-authority-capability');
    }

    for (const rule of SECRET_PATTERNS) {
      const pattern = new RegExp(rule.source, rule.flags);
      text = text.replace(pattern, (...args: unknown[]) => {
        redactionCount += 1;
        matches.add(rule.kind);
        const captures = args.slice(0, -2).map(item => String(item ?? ''));
        return rule.replace(captures, markerFor(rule.kind, options.replacement));
      });
    }

    return Object.freeze({
      version: CODING_SECRET_REDACTION_VERSION,
      text,
      matches: Object.freeze([...matches]),
      redactionCount,
      redacted: redactionCount > 0,
    });
  }

  redactValue<T>(
    value: T,
    options: CodingSecretRedactionOptions = {},
  ): CodingSecretValueRedaction<T> {
    const matches = new Set<CodingSecretKind>();
    let redactionCount = 0;
    const seen = new WeakMap<object, unknown>();

    const visit = (item: unknown): unknown => {
      if (typeof item === 'string') {
        const receipt = this.redactText(item, options);
        receipt.matches.forEach(kind => matches.add(kind));
        redactionCount += receipt.redactionCount;
        return receipt.text;
      }
      if (!item || typeof item !== 'object') return item;
      const prior = seen.get(item);
      if (prior !== undefined) return prior;
      if (Array.isArray(item)) {
        const output: unknown[] = [];
        seen.set(item, output);
        item.forEach(child => output.push(visit(child)));
        return output;
      }
      const output: Record<string, unknown> = {};
      seen.set(item, output);
      try {
        for (const [rawKey, child] of Object.entries(item as Record<string, unknown>)) {
          const keyReceipt = this.redactText(rawKey, options);
          keyReceipt.matches.forEach(kind => matches.add(kind));
          redactionCount += keyReceipt.redactionCount;
          const key = keyReceipt.text;
          if (options.redactSensitiveFields !== false && isCodingSecretFieldName(rawKey)) {
            output[key] = options.sensitiveFieldReplacement
              ?? options.replacement
              ?? CODING_SECRET_FIELD_REDACTION;
            matches.add('sensitive-field');
            redactionCount += 1;
          } else {
            output[key] = visit(child);
          }
        }
      } catch {
        matches.add('sensitive-field');
        redactionCount += 1;
        return options.sensitiveFieldReplacement ?? options.replacement ?? CODING_SECRET_FIELD_REDACTION;
      }
      return output;
    };

    const redactedValue = visit(value) as T;
    return Object.freeze({
      version: CODING_SECRET_REDACTION_VERSION,
      value: redactedValue,
      matches: Object.freeze([...matches]),
      redactionCount,
      redacted: redactionCount > 0,
    });
  }

  contains(value: unknown): boolean {
    return this.redactValue(value).redacted;
  }
}

const CANONICAL_SECRET_REDACTION = new CanonicalSecretRedactionService();

export function redactCodingSecretsInText(
  value: string,
  options?: CodingSecretRedactionOptions,
): CodingSecretTextRedaction {
  return CANONICAL_SECRET_REDACTION.redactText(value, options);
}

export function redactCodingSecretsInValue<T>(
  value: T,
  options?: CodingSecretRedactionOptions,
): CodingSecretValueRedaction<T> {
  return CANONICAL_SECRET_REDACTION.redactValue(value, options);
}

export function containsCodingSecrets(value: unknown): boolean {
  return CANONICAL_SECRET_REDACTION.contains(value);
}

export function isCodingSecretFieldName(value: string): boolean {
  return SENSITIVE_FIELD_RE.test(String(value || ''));
}

function markerFor(kind: CodingSecretKind, replacement: string | undefined): string {
  if (replacement !== undefined) return replacement;
  if (kind === 'private-key') return '[REDACTED_PRIVATE_KEY]';
  if (kind === 'provider-token' || kind === 'github-token' || kind === 'slack-token' || kind === 'aws-access-key') {
    return '[REDACTED_TOKEN]';
  }
  return CODING_SECRET_REDACTION;
}

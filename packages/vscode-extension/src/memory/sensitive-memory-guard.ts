export interface SensitiveMemoryCheck {
  allowed: boolean;
  reason?: string;
  matches: string[];
}

export interface SensitiveMemoryRedaction {
  text: string;
  matches: string[];
  redactionCount: number;
  redacted: boolean;
}

interface SensitivePattern {
  label: string;
  pattern: RegExp;
  redactionPattern: RegExp;
  replacement: string;
}

const SENSITIVE_PATTERNS: SensitivePattern[] = [
  {
    label: 'private-key',
    pattern: /-----BEGIN\s+(?:RSA\s+|OPENSSH\s+|EC\s+|DSA\s+)?PRIVATE KEY-----/i,
    redactionPattern: /-----BEGIN\s+(?:RSA\s+|OPENSSH\s+|EC\s+|DSA\s+)?PRIVATE KEY-----[\s\S]*?-----END\s+(?:RSA\s+|OPENSSH\s+|EC\s+|DSA\s+)?PRIVATE KEY-----/gi,
    replacement: '[REDACTED_PRIVATE_KEY]',
  },
  {
    label: 'openai-style-token',
    pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/,
    redactionPattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g,
    replacement: '[REDACTED_TOKEN]',
  },
  {
    label: 'github-token',
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/,
    redactionPattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g,
    replacement: '[REDACTED_TOKEN]',
  },
  {
    label: 'github-fine-grained-token',
    pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
    redactionPattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    replacement: '[REDACTED_TOKEN]',
  },
  {
    label: 'slack-token',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
    redactionPattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    replacement: '[REDACTED_TOKEN]',
  },
  {
    label: 'aws-access-key',
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
    redactionPattern: /\bAKIA[0-9A-Z]{16}\b/g,
    replacement: '[REDACTED_TOKEN]',
  },
  {
    label: 'secret-assignment',
    pattern: /\b(?:password|passwd|pwd|token|api[_-]?key|secret|cookie)\s*[:=]\s*['"]?[^'"\s]{8,}/i,
    redactionPattern: /\b(password|passwd|pwd|token|api[_-]?key|secret|cookie)\s*[:=]\s*['"]?[^'"\s]{8,}/gi,
    replacement: '$1=[REDACTED]',
  },
  {
    label: 'authorization-header',
    pattern: /\bauthorization\s*[:=]\s*(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{12,}/i,
    redactionPattern: /\bauthorization\s*[:=]\s*(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi,
    replacement: 'authorization=[REDACTED]',
  },
];

export class SensitiveMemoryGuard {
  check(content: string): SensitiveMemoryCheck {
    const matches = this.matchLabels(content);

    if (matches.length === 0) {
      return { allowed: true, matches: [] };
    }

    return {
      allowed: false,
      reason: `记忆内容疑似包含敏感信息：${matches.join(', ')}`,
      matches,
    };
  }

  redact(content: string): SensitiveMemoryRedaction {
    let text = String(content || '');
    const matches: string[] = [];
    let redactionCount = 0;
    for (const rule of SENSITIVE_PATTERNS) {
      const before = text;
      const next = text.replace(rule.redactionPattern, rule.replacement);
      if (next !== before) {
        matches.push(rule.label);
        redactionCount += countRedactions(before, rule.redactionPattern);
      }
      text = next;
    }
    return {
      text,
      matches,
      redactionCount,
      redacted: redactionCount > 0,
    };
  }

  private matchLabels(content: string): string[] {
    return SENSITIVE_PATTERNS
      .filter((rule) => rule.pattern.test(content))
      .map((rule) => rule.label);
  }
}

function countRedactions(text: string, pattern: RegExp): number {
  return [...String(text || '').matchAll(pattern)].length;
}

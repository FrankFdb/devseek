export interface SensitiveMemoryCheck {
  allowed: boolean;
  reason?: string;
  matches: string[];
}

interface SensitivePattern {
  label: string;
  pattern: RegExp;
}

const SENSITIVE_PATTERNS: SensitivePattern[] = [
  { label: 'private-key', pattern: /-----BEGIN\s+(?:RSA\s+|OPENSSH\s+|EC\s+|DSA\s+)?PRIVATE KEY-----/i },
  { label: 'openai-style-token', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { label: 'github-token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/ },
  { label: 'github-fine-grained-token', pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { label: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { label: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: 'secret-assignment', pattern: /\b(?:password|passwd|pwd|token|api[_-]?key|secret|cookie)\s*[:=]\s*['"]?[^'"\s]{8,}/i },
  { label: 'authorization-header', pattern: /\bauthorization\s*[:=]\s*(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{12,}/i },
];

export class SensitiveMemoryGuard {
  check(content: string): SensitiveMemoryCheck {
    const matches = SENSITIVE_PATTERNS
      .filter((rule) => rule.pattern.test(content))
      .map((rule) => rule.label);

    if (matches.length === 0) {
      return { allowed: true, matches: [] };
    }

    return {
      allowed: false,
      reason: `记忆内容疑似包含敏感信息：${matches.join(', ')}`,
      matches,
    };
  }
}

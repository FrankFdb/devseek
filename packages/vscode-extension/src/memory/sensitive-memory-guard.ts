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

const SECRET_REDACTION = new CanonicalSecretRedactionService();

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
    const receipt = SECRET_REDACTION.redactText(content);
    return {
      text: receipt.text,
      matches: receipt.matches.map(memoryLabel),
      redactionCount: receipt.redactionCount,
      redacted: receipt.redacted,
    };
  }

  private matchLabels(content: string): string[] {
    return SECRET_REDACTION.redactText(content).matches.map(memoryLabel);
  }
}

function memoryLabel(kind: CodingSecretKind): string {
  if (kind === 'provider-token') return 'openai-style-token';
  if (kind === 'devseek-authority-capability') return 'devseek-authority-capability';
  return kind;
}
import {
  CanonicalSecretRedactionService,
  type CodingSecretKind,
} from '@devseek-netai/shared';

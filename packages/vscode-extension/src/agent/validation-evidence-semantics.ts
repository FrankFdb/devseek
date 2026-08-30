import type { AgenticHistoryQualityGate } from './agentic-history';
import type { TerminalEvidence } from './completion-evidence';

/** Shared interpretation rules for model-authored reviews of validation evidence. */
export const VALIDATION_EVIDENCE_REVIEW_RULES = Object.freeze([
  'Validation expected values describe observable acceptance conditions; they are not literal artifact schemas unless the original requirement or an explicitly delegated contract declares the same schema.',
  'Treat matcher notation such as minimum, maximum, pattern, anyOf, and contains as predicates on the parent value, never as properties to add to production output.',
  'When matcher metadata appears to conflict with an explicit artifact type or shape, preserve the declared artifact contract and apply the matcher as a predicate. Do not invent a schema migration from test-report formatting.',
  'A host-bound PASS for the exact current-cohort command directly supersedes an older failure of that command in the original request. Reject any finding whose counterexample says that same command still fails unless the final source changed after the PASS.',
]);

const MAX_VALIDATION_FACTS = 8;
const MAX_FACT_TEXT_CHARS = 1_200;

export function renderCurrentCohortValidationFact(input: {
  qualityGate?: AgenticHistoryQualityGate;
  terminalEvidence?: readonly TerminalEvidence[];
}): string | undefined {
  const terminalEvidence = input.terminalEvidence ?? [];
  if (!input.qualityGate && terminalEvidence.length === 0) return undefined;

  const lines = ['Host-bound validation facts for the current final-source cohort:'];
  if (input.qualityGate) {
    lines.push(
      `- QUALITY_GATE status=${input.qualityGate.status} summary=${quoteFact(input.qualityGate.summary)}`,
    );
  }
  terminalEvidence.slice(-MAX_VALIDATION_FACTS).forEach((evidence, index) => {
    const exitCode = evidence.exitCode === null ? 'null' : String(evidence.exitCode);
    lines.push(
      `- COMMAND_${index + 1} result=${evidence.ok ? 'PASS' : 'FAIL'} kind=${evidence.kind} exitCode=${exitCode} command=${quoteFact(evidence.command)}`,
    );
    if (evidence.detail) {
      lines.push(`  detail=${quoteFact(evidence.detail)}`);
    }
  });
  return lines.join('\n');
}

function quoteFact(value: string): string {
  const normalized = String(value || '').trim();
  const bounded = normalized.length <= MAX_FACT_TEXT_CHARS
    ? normalized
    : `${normalized.slice(0, MAX_FACT_TEXT_CHARS - 3).trimEnd()}...`;
  return JSON.stringify(bounded);
}

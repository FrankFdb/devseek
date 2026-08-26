import type { AutoValidationResult, ValidationMode } from '../workspace/validation-service';
import {
  classifyTerminalEvidenceCommand,
  type TerminalEvidence,
  type TerminalEvidenceKind,
} from './completion-evidence';
import {
  normalizeVerificationResult,
  shouldEmitTerminalEvidenceForVerification,
} from '../app/verification-result-authority';
import {
  projectActionableDiagnosticExcerpt,
  projectDiagnosticOutputExcerpt,
} from '../app/diagnostic-output-projection';

export function validationResultToTerminalEvidence(
  result: AutoValidationResult,
): TerminalEvidence | undefined {
  const verification = normalizeVerificationResult(result);
  if (!shouldEmitTerminalEvidenceForVerification(verification)) return undefined;
  const command = result.command || (result.mode === 'readback' ? 'file-readback' : '');
  const rawDetail = [result.reason, result.output].filter(Boolean).join('\n');
  const detail = result.ok
    ? projectDiagnosticOutputExcerpt(rawDetail, 1200)
    : projectActionableDiagnosticExcerpt(rawDetail, 1800);
  return {
    command,
    kind: validationModeToTerminalEvidenceKind(result.mode, command),
    ok: result.ok,
    exitCode: result.exitCode,
    ...(detail ? { detail } : {}),
  };
}

function validationModeToTerminalEvidenceKind(
  mode: ValidationMode | undefined,
  command: string,
): TerminalEvidenceKind {
  switch (mode) {
    case 'readback':
      return 'other';
    case 'syntax':
    case 'typecheck':
    case 'compile-only':
    case 'build':
      return 'compile';
    case 'test':
      return 'test';
    case 'project': {
      const classified = classifyTerminalEvidenceCommand(command);
      return classified === 'other' ? 'compile' : classified;
    }
    default:
      return classifyTerminalEvidenceCommand(command);
  }
}

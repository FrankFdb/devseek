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
import { projectDiagnosticOutputExcerpt } from '../app/diagnostic-output-projection';

export function validationResultToTerminalEvidence(
  result: AutoValidationResult,
): TerminalEvidence | undefined {
  const verification = normalizeVerificationResult(result);
  if (!shouldEmitTerminalEvidenceForVerification(verification)) return undefined;
  const command = result.command || (result.mode === 'readback' ? 'file-readback' : '');
  const detail = projectDiagnosticOutputExcerpt(
    [result.reason, result.output].filter(Boolean).join('\n'),
    1200,
  );
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

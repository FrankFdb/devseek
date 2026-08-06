import {
  CanonicalRunEvidenceRetentionService,
  ProductRunEvidenceSession,
  type CodingRunLifecycleSnapshot,
} from '@devseek-netai/shared';

export interface VsCodeCodingRunEvidenceRetentionInput {
  readonly workspaceRoot: string;
  readonly runId: string;
  readonly participantToken?: string;
  readonly lifecycle: CodingRunLifecycleSnapshot;
  readonly onError?: (error: unknown) => void;
}

export function retainVsCodeCodingRunLifecycle(
  input: VsCodeCodingRunEvidenceRetentionInput,
): boolean {
  const participantToken = input.participantToken?.trim();
  if (!participantToken) {
    input.onError?.(new Error('vscode-coding-run-evidence:missing-participant-authority'));
    return false;
  }
  try {
    const session = ProductRunEvidenceSession.forWorkspace({
      workspaceRoot: input.workspaceRoot,
      runId: input.runId,
      surface: 'vscode',
      authority: { role: 'participant', token: participantToken },
      openIfMissing: false,
    });
    new CanonicalRunEvidenceRetentionService(input.runId, session).retainLifecycle(input.lifecycle);
    return true;
  } catch (error) {
    input.onError?.(error);
    return false;
  }
}

import type { RunEvidenceJson } from '@devseek-netai/shared';

export const RUN_SETTLEMENT_SEAL_BINDING_PROTOCOL = 'devseek.settlement-seal-binding/v1' as const;

export interface RunSettlementBuildIdentity {
  app_version: string | null;
  build_channel: string | null;
  build_id: string | null;
  git_commit: string | null;
}

export interface RunSettlementSealBindingInput extends RunSettlementBuildIdentity {
  runId: string;
  ownerSurface: string;
  taskContractFingerprint: string;
  requiresSourceClaimArtifactVerification: boolean;
}

export function buildRunSettlementSealBinding(
  input: RunSettlementSealBindingInput,
): Record<string, RunEvidenceJson> {
  return {
    protocol: RUN_SETTLEMENT_SEAL_BINDING_PROTOCOL,
    owner_surface: input.ownerSurface,
    run_id: input.runId,
    task_contract_fingerprint: input.taskContractFingerprint,
    requires_source_claim_artifact_verification: input.requiresSourceClaimArtifactVerification,
    app_version: input.app_version,
    build_channel: input.build_channel,
    build_id: input.build_id,
    git_commit: input.git_commit,
  };
}

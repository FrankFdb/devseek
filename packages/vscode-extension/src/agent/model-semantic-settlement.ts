import type {
  CodingToolExecutionReceipt,
  CodingVerificationReceipt,
  CodingWorkspaceMutationReceipt,
} from '@devseek-netai/shared';
import type { TerminalEvidence, WrittenFileEvidence } from './completion-evidence';
import type { AgentLoopCallbacks } from './loop-types';
import { recordNewlyAcceptedTerminalVerifications } from './terminal-verification-adapter';
import type { WriteAuthority } from './write-authority';

export interface ModelSemanticSettlementRound {
  readonly toolExecutionReceipts?: readonly CodingToolExecutionReceipt<unknown>[];
  readonly changeReceipts?: readonly CodingWorkspaceMutationReceipt<unknown>[];
  readonly terminalEvidence?: readonly TerminalEvidence[];
}

export interface ModelSemanticSettlementResult {
  readonly settled: boolean;
  readonly verificationReceipts: readonly CodingVerificationReceipt[];
  readonly observationPaths: readonly string[];
}

export interface ModelSemanticSettlementService {
  observe(round: ModelSemanticSettlementRound): Promise<ModelSemanticSettlementResult>;
}

export interface ModelSemanticSettlementServiceInput {
  readonly authority: WriteAuthority;
  readonly callbacks: AgentLoopCallbacks;
  readonly workspaceRoot: string;
  readonly writtenFiles: () => readonly WrittenFileEvidence[];
  readonly verificationReceipts: () => readonly CodingVerificationReceipt[];
}

/** Settles tentative provider semantics only from concrete local action evidence. */
export function createModelSemanticSettlementService(
  input: ModelSemanticSettlementServiceInput,
): ModelSemanticSettlementService {
  return {
    async observe(round) {
      const toolReceipts = round.toolExecutionReceipts ?? [];
      const settlement = input.authority.settleModelSemanticProposal(toolReceipts);
      if (!settlement) return { settled: false, verificationReceipts: [], observationPaths: [] };

      input.authority.callbacks.onSettledModelSemanticContract?.({
        semanticContract: settlement.semanticContract,
        semanticFragments: settlement.semanticFragments,
        toolReceipts: settlement.toolReceipts,
        changeReceipts: round.changeReceipts ?? [],
      });
      const verification = input.callbacks.canonicalVerification;
      const acceptance = input.callbacks.canonicalVerificationAcceptance ?? [];
      if (!verification || acceptance.length === 0 || !round.terminalEvidence?.length) {
        return {
          settled: true,
          verificationReceipts: [],
          observationPaths: [...(settlement.observationPaths ?? [])],
        };
      }
      const verificationReceipts = await recordNewlyAcceptedTerminalVerifications({
        toolReceipts,
        evidence: round.terminalEvidence,
        existingReceipts: input.verificationReceipts(),
        workspaceRoot: input.workspaceRoot,
        writtenFiles: input.writtenFiles(),
        acceptance,
        verification,
      });
      return {
        settled: true,
        verificationReceipts,
        observationPaths: [...(settlement.observationPaths ?? [])],
      };
    },
  };
}

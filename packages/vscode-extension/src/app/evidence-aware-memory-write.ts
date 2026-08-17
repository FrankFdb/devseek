import type { AgentLoopCallbacks } from '../agent/loop-types';
import { MemoryService } from './memory-service';
import { ProductMutationCoordinator } from './product-mutation-coordinator';
import { adaptPreparedProductTool } from './prepared-product-tool-adapter';
import type { DevSeekRunContext } from './run-context';
import type { TerminalConfirmationResult } from './terminal-permission-coordinator';

type PrepareMemoryWrite = NonNullable<AgentLoopCallbacks['onPrepareMemoryWrite']>;

export function createEvidenceAwareMemoryWriteFactory(deps: {
  requestConfirmation(label: string): Promise<TerminalConfirmationResult>;
}): (
  runContext: DevSeekRunContext,
  workspaceRoot: string,
  userIntentConfirmed: boolean,
) => PrepareMemoryWrite {
  return (runContext, workspaceRoot, userIntentConfirmed) => {
    const mutations = new ProductMutationCoordinator(runContext, 'vscode-memory-write');
    const memory = new MemoryService({ workspaceRoot });
    return async proposal => {
      let approvalRef = '';
      let approvedBy = '';
      const prepared = await mutations.prepare({
        kind: 'memory-write',
        label: 'repository-scoped ad-hoc memory write',
        authorize: async () => {
          if (userIntentConfirmed) {
            approvalRef = `confirmed-user-intent:${runContext.runId}:memory-write`;
            approvedBy = 'confirmed-current-user-intent';
            return {
              allowed: true,
              source: 'user-confirmed',
              reason: 'current-user-confirmed-memory-write',
            };
          }
          const confirmation = await deps.requestConfirmation('允许 DevSeek 记录这条项目记忆？');
          if (!confirmation.allow || !confirmation.confirmationRef) {
            return {
              allowed: false,
              source: 'user-confirmed',
              reason: confirmation.reason ?? 'user-rejected-memory-write',
            };
          }
          approvalRef = confirmation.confirmationRef;
          approvedBy = 'interactive-user-confirmation';
          return {
            allowed: true,
            source: 'user-confirmed',
            reason: 'user-approved-visible-memory-write',
          };
        },
        invoke: () => {
          if (!approvalRef || !approvedBy) throw new Error('memory-write:missing-user-approval');
          return memory.acceptWriteProposal(memory.approveWriteProposal(proposal, {
            approvalRef,
            approvedBy,
          }));
        },
        completionEvidence: {
          kind: 'verified-postcondition',
          verify: record => memory.viewManagementEntry(record.id)?.status === 'active',
          proof: record => ({
            record_id: record.id,
            repository_id: memory.getLocation().repositoryId,
            status: record.status,
            receipt: 'memory-record-readback-active',
          }),
        },
      });
      return adaptPreparedProductTool({
        prepared,
        constraintRef: `memory-write-constraint:${runContext.runId}`,
        completedEvidenceRef: `memory-write-record:${runContext.runId}`,
        formatResult: record => JSON.stringify({ id: record.id, status: record.status }),
      });
    };
  };
}

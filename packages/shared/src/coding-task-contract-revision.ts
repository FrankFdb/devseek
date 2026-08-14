import {
  snapshotCodingKernelTaskContract,
  type CodingKernelTaskContract,
} from './coding-task-contract';
import { normalizedCodingId, uniqueCodingRefs } from './coding-contract-utils';
import { codingSemanticDigest } from './coding-semantic-digest';

export const CODING_TASK_CONTRACT_REVISION_VERSION = 'devseek.coding-task-contract-revision/v1' as const;

export interface CodingTaskContractRevisionReceipt {
  readonly version: typeof CODING_TASK_CONTRACT_REVISION_VERSION;
  readonly revisionId: string;
  readonly sequence: number;
  readonly previousContractSha256: string;
  readonly contractSha256: string;
  readonly evidenceRefs: readonly string[];
  readonly receiptSha256: string;
}

export interface CodingTaskContractRevisionCandidate {
  readonly revisionId: string;
  readonly taskContract: CodingKernelTaskContract;
  readonly evidenceRefs: readonly string[];
}

export interface CodingTaskContractSourcePort {
  current(): CodingKernelTaskContract;
}

export interface CodingTaskContractRevisionSessionPort extends CodingTaskContractSourcePort {
  revise(candidate: CodingTaskContractRevisionCandidate): CodingTaskContractRevisionReceipt;
  revisions(): readonly CodingTaskContractRevisionReceipt[];
}

export interface TaskContractRevisionPort {
  bind(input: { readonly taskContract: CodingKernelTaskContract }): CodingTaskContractRevisionSessionPort;
}

/** Owns ordered, immutable TaskContract snapshots for one active Kernel run. */
export class CanonicalTaskContractRevisionService implements TaskContractRevisionPort {
  bind(input: { readonly taskContract: CodingKernelTaskContract }): CodingTaskContractRevisionSessionPort {
    let current = snapshotCodingKernelTaskContract(input.taskContract);
    let currentSha256 = codingSemanticDigest(current);
    const receipts: CodingTaskContractRevisionReceipt[] = [];
    const revisionsById = new Map<string, {
      readonly contractSha256: string;
      readonly receipt: CodingTaskContractRevisionReceipt;
    }>();

    return Object.freeze({
      current: () => current,
      revise: (candidate: CodingTaskContractRevisionCandidate) => {
        const revisionId = normalizedCodingId(candidate?.revisionId, 'task-contract-revision-id');
        const taskContract = snapshotCodingKernelTaskContract(candidate?.taskContract);
        const contractSha256 = codingSemanticDigest(taskContract);
        const evidenceRefs = uniqueCodingRefs(candidate?.evidenceRefs ?? []);
        if (evidenceRefs.length === 0) {
          throw new Error('coding-task-contract-revision:missing-evidence');
        }
        const existing = revisionsById.get(revisionId);
        if (existing) {
          if (existing.contractSha256 !== contractSha256) {
            throw new Error(`coding-task-contract-revision:conflicting-revision-id:${revisionId}`);
          }
          return existing.receipt;
        }
        const payload = {
          version: CODING_TASK_CONTRACT_REVISION_VERSION,
          revisionId,
          sequence: receipts.length + 1,
          previousContractSha256: currentSha256,
          contractSha256,
          evidenceRefs: Object.freeze(uniqueCodingRefs([
            ...evidenceRefs,
            `task-contract-revision:${revisionId}`,
          ])),
        };
        const receipt = Object.freeze({
          ...payload,
          receiptSha256: codingSemanticDigest(payload),
        });
        current = taskContract;
        currentSha256 = contractSha256;
        receipts.push(receipt);
        revisionsById.set(revisionId, { contractSha256, receipt });
        return receipt;
      },
      revisions: () => Object.freeze([...receipts]),
    });
  }
}

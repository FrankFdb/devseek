import type { ExactGroundedArtifactContract } from './evidence-grounding';

export type TaskShape =
  | 'existing-project'
  | 'standalone'
  | 'inspection'
  | 'documentation'
  | 'verification'
  | 'repair'
  | 'resume'
  | 'destructive';

export type QualityObligation =
  | 'source-evidence'
  | 'protocol-facts'
  | 'interface-contract'
  | 'modification-plan'
  | 'project-communication-chain'
  | 'validation';

/**
 * Structured task facts accumulated from normalized model actions and local
 * settlement. Raw user text is retained elsewhere and is never parsed here.
 */
export interface TaskContract {
  taskShapes: TaskShape[];
  objectives: string[];
  inputs: string[];
  deliverableTargets: string[];
  deliverables: Array<'report' | 'source-change' | 'verification-result'>;
  constraints: string[];
  qualityObligations: QualityObligation[];
  evidenceRequirements: Array<{
    kind: 'source-claim';
    symbol: string;
    validator: 'exact-or-numeric';
    sourcePath?: string;
  }>;
  verificationContract: {
    requireSourceClaimGrounding: boolean;
    requireTitle: boolean;
    requiredSourcePaths: string[];
    exactClaimTable?: {
      symbols: string[];
      rowCount: number;
      forbidAdditionalRows: boolean;
    };
    exactCodeBlocks: Array<{
      language?: string;
      content: string;
    }>;
    exactArtifactRequested: boolean;
    exactArtifact?: ExactGroundedArtifactContract;
    requireArtifactReadback: boolean;
    maxWrittenFiles?: number;
  };
}

/** Source-claim grounding remains a deterministic evidence obligation. */
export function hasSourceClaimArtifactContract(contract: TaskContract): boolean {
  return contract.verificationContract.requireSourceClaimGrounding
    && contract.deliverables.includes('report');
}

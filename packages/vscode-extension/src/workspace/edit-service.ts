import * as fs from 'fs';
import * as nodePath from 'path';
import { findGeneratedSourceSanityIssue, repairGeneratedSourceTransportEscapes } from './source-sanity';

export interface WorkspaceWriteResult {
  existed: boolean;
  oldContent: string;
  newContent: string;
  normalization?: WorkspaceWriteNormalization;
}

export interface WorkspaceWriteNormalization {
  kind: 'source-transport-escape-repair';
  repairCount: number;
}

export interface WorkspaceEditProposal {
  kind: 'write-text-file';
  absPath: string;
  content: string;
}

export interface WorkspaceFileSnapshot {
  absPath: string;
  existed: boolean;
  content: string;
}

export interface WorkspaceAppliedEdit {
  proposal: WorkspaceEditProposal;
  snapshot: WorkspaceFileSnapshot;
  result: WorkspaceWriteResult;
}

export interface WorkspaceEditApplyOptions {
  validateSourceSanity?: boolean;
  repairSourceTransportEscapes?: boolean;
}

export class WorkspaceEditValidationError extends Error {
  constructor(readonly absPath: string, readonly detail: string) {
    super(detail);
    this.name = 'WorkspaceEditValidationError';
  }
}

export class WorkspaceEditService {
  proposeTextFileWrite(absPath: string, content: string): WorkspaceEditProposal {
    return {
      kind: 'write-text-file',
      absPath,
      content,
    };
  }

  snapshotTextFile(absPath: string): WorkspaceFileSnapshot {
    const existed = fs.existsSync(absPath);
    return {
      absPath,
      existed,
      content: existed ? fs.readFileSync(absPath, 'utf8') : '',
    };
  }

  validateTextFileProposal(proposal: WorkspaceEditProposal): void {
    const issue = findGeneratedSourceSanityIssue(proposal.absPath, proposal.content);
    if (!issue) return;
    throw new WorkspaceEditValidationError(proposal.absPath, issue.detail);
  }

  applyTextFileProposal(
    proposal: WorkspaceEditProposal,
    snapshot = this.snapshotTextFile(proposal.absPath),
    options: WorkspaceEditApplyOptions = {},
  ): WorkspaceAppliedEdit {
    let appliedProposal = proposal;
    let normalization: WorkspaceWriteNormalization | undefined;
    if (options.repairSourceTransportEscapes) {
      const repaired = repairGeneratedSourceTransportEscapes(proposal.absPath, proposal.content);
      if (repaired.repaired) {
        appliedProposal = { ...proposal, content: repaired.content };
        normalization = {
          kind: 'source-transport-escape-repair',
          repairCount: repaired.repairCount,
        };
      }
    }
    if (options.validateSourceSanity) {
      this.validateTextFileProposal(appliedProposal);
    }
    const dir = nodePath.dirname(appliedProposal.absPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(appliedProposal.absPath, appliedProposal.content, 'utf8');
    return {
      proposal: appliedProposal,
      snapshot,
      result: {
        existed: snapshot.existed,
        oldContent: snapshot.content,
        newContent: appliedProposal.content,
        ...(normalization ? { normalization } : {}),
      },
    };
  }

  writeTextFileSync(absPath: string, content: string, options: WorkspaceEditApplyOptions = {}): WorkspaceWriteResult {
    return this.applyTextFileProposal(this.proposeTextFileWrite(absPath, content), undefined, options).result;
  }
}

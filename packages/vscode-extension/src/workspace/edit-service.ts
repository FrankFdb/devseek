import * as fs from 'fs';
import * as nodePath from 'path';
import { findGeneratedSourceSanityIssue } from './source-sanity';

export interface WorkspaceWriteResult {
  existed: boolean;
  oldContent: string;
  newContent: string;
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
    if (options.validateSourceSanity) {
      this.validateTextFileProposal(proposal);
    }
    const dir = nodePath.dirname(proposal.absPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(proposal.absPath, proposal.content, 'utf8');
    return {
      proposal,
      snapshot,
      result: {
        existed: snapshot.existed,
        oldContent: snapshot.content,
        newContent: proposal.content,
      },
    };
  }

  writeTextFileSync(absPath: string, content: string, options: WorkspaceEditApplyOptions = {}): WorkspaceWriteResult {
    return this.applyTextFileProposal(this.proposeTextFileWrite(absPath, content), undefined, options).result;
  }
}

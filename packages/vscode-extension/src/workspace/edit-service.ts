import * as fs from 'fs';
import * as nodePath from 'path';

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

  applyTextFileProposal(proposal: WorkspaceEditProposal, snapshot = this.snapshotTextFile(proposal.absPath)): WorkspaceAppliedEdit {
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

  writeTextFileSync(absPath: string, content: string): WorkspaceWriteResult {
    return this.applyTextFileProposal(this.proposeTextFileWrite(absPath, content)).result;
  }
}

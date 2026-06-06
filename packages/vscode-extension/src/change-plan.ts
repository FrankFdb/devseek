import { GeneratedFile, GeneratedPatch } from './generated-file-parser';

export type ResolvedGeneratedArtifact =
  (GeneratedFile | GeneratedPatch) & {
    resolvedPath: string;
    confidence: 'high' | 'medium';
    reason: string;
  };

export type ChangeActionType = 'create-file' | 'overwrite-file' | 'patch-file';

interface ChangeActionBase {
  type: ChangeActionType;
  path: string;
  confidence: 'high' | 'medium';
  reason: string;
  language?: string;
}

export interface CreateFileAction extends ChangeActionBase {
  type: 'create-file';
  content: string;
}

export interface OverwriteFileAction extends ChangeActionBase {
  type: 'overwrite-file';
  content: string;
}

export interface PatchFileAction extends ChangeActionBase {
  type: 'patch-file';
  diff: string;
}

export type ChangeAction = CreateFileAction | OverwriteFileAction | PatchFileAction;

export function createChangeAction(artifact: ResolvedGeneratedArtifact, exists: boolean): ChangeAction {
  if (artifact.type === 'patch') {
    const patch = artifact as GeneratedPatch & ResolvedGeneratedArtifact;
    return {
      type: 'patch-file',
      path: patch.resolvedPath,
      confidence: patch.confidence,
      reason: patch.reason,
      diff: patch.diff,
    };
  }

  const file = artifact as GeneratedFile & ResolvedGeneratedArtifact;
  if (exists) {
    return {
      type: 'overwrite-file',
      path: file.resolvedPath,
      confidence: file.confidence,
      reason: file.reason,
      language: file.language,
      content: file.content,
    };
  }

  return {
    type: 'create-file',
    path: file.resolvedPath,
    confidence: file.confidence,
    reason: file.reason,
    language: file.language,
    content: file.content,
  };
}

export function summarizeChangeActions(actions: ChangeAction[]): {
  creates: number;
  overwrites: number;
  patches: number;
} {
  return actions.reduce((summary, action) => {
    switch (action.type) {
    case 'create-file':
      summary.creates += 1;
      break;
    case 'overwrite-file':
      summary.overwrites += 1;
      break;
    case 'patch-file':
      summary.patches += 1;
      break;
    }
    return summary;
  }, { creates: 0, overwrites: 0, patches: 0 });
}
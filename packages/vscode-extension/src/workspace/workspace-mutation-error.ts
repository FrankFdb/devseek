export type WorkspaceMutationErrorScope = 'single' | 'batch';

export interface WorkspaceMutationErrorDescription {
  code: string;
  detail?: string;
}

/** Converts host edit failures into stable transaction codes plus bounded repair guidance. */
export function describeWorkspaceMutationError(
  error: unknown,
  scope: WorkspaceMutationErrorScope,
): WorkspaceMutationErrorDescription {
  const prefix = scope === 'batch' ? 'workspace-batch' : 'workspace';
  const name = error instanceof Error ? error.name : '';
  const detail = workspaceEditErrorDetail(error);
  if (name === 'WorkspaceEditValidationError') {
    return { code: `${prefix}-proposal-invalid`, ...(detail ? { detail } : {}) };
  }
  if (name === 'WorkspaceEditConflictError') {
    return { code: `${prefix}-commit-conflict`, ...(detail ? { detail } : {}) };
  }
  return { code: `${prefix}-commit-failed` };
}

function workspaceEditErrorDetail(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const structuralDetail = (error as Error & { detail?: unknown }).detail;
  const detail = typeof structuralDetail === 'string' ? structuralDetail : error.message;
  return detail.trim() || undefined;
}

import type { WorkspaceTextFileCommitToken } from './edit-service';

/** A committed workspace edit registered for user review and token-bound undo. */
export interface AppliedChangeRecord {
  path: string;
  existed: boolean;
  oldContent: string;
  newContent: string;
  commitToken: WorkspaceTextFileCommitToken;
}

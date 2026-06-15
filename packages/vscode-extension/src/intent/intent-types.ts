export type ExecutionMode =
  | 'smalltalk'
  | 'qa'
  | 'inspect'
  | 'plan'
  | 'edit'
  | 'run'
  | 'destructive';

export type ToolKind =
  | 'read'
  | 'search'
  | 'diagnostics'
  | 'plan'
  | 'edit'
  | 'terminal'
  | 'vscode-command'
  | 'mcp';

export interface IntentClassification {
  mode: ExecutionMode;
  confidence: number;
  score: number;
  signals: string[];
  blockers: string[];
  reason: string;
  requiresConfirmation: boolean;
  allowedToolKinds: ToolKind[];
}

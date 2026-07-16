export type ExecutionMode =
  | 'smalltalk'
  | 'qa'
  | 'inspect'
  | 'plan'
  | 'edit'
  | 'run'
  | 'destructive';

export type ToolKind =
  | 'control'
  | 'read'
  | 'search'
  | 'diagnostics'
  | 'network'
  | 'plan'
  | 'memory'
  | 'edit'
  | 'terminal'
  | 'vscode'
  | 'vscode-command'
  | 'mcp';

export type ToolRisk = 'low' | 'medium' | 'high' | 'destructive';

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

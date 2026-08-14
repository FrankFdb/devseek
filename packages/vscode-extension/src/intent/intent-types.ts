import type { CodingToolKind, CodingToolRisk } from '@devseek-netai/shared';

export type ExecutionMode =
  | 'smalltalk'
  | 'qa'
  | 'inspect'
  | 'plan'
  | 'edit'
  | 'run'
  | 'destructive'
  | 'model-led';

export type ToolKind = CodingToolKind;

export type ToolRisk = CodingToolRisk;

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

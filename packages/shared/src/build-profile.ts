export type BuildProfileId =
  | 'shared-core'
  | 'bridge'
  | 'vscode-extension'
  | 'cli-tui'
  | 'cli-jsonl'
  | 'desktop-local-web';

export interface BuildProfile {
  id: BuildProfileId;
  description: string;
  command: string;
  requiredForPhase10: boolean;
}

export const BUILD_PROFILES: readonly BuildProfile[] = [
  {
    id: 'shared-core',
    description: 'Headless Agent Core shared by VS Code and CLI',
    command: 'npm run shared:build',
    requiredForPhase10: true,
  },
  {
    id: 'bridge',
    description: 'DeepSeek Web bridge runtime',
    command: 'npm run bridge:build',
    requiredForPhase10: true,
  },
  {
    id: 'vscode-extension',
    description: 'VS Code extension bundle and VSIX',
    command: 'npm run compile --workspace=packages/vscode-extension && npm run extension:package',
    requiredForPhase10: true,
  },
  {
    id: 'cli-tui',
    description: 'Interactive terminal surface',
    command: 'npm run cli:build',
    requiredForPhase10: true,
  },
  {
    id: 'cli-jsonl',
    description: 'Non-interactive JSONL surface',
    command: 'npm run cli:test',
    requiredForPhase10: true,
  },
  {
    id: 'desktop-local-web',
    description: 'Future desktop/local web surface placeholder',
    command: 'not implemented before Agent Core stabilization',
    requiredForPhase10: false,
  },
];

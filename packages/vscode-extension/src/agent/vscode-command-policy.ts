export type SupportedVscodeCommandClass = 'read-only' | 'invocation-receipt' | 'mutating-with-permission';

export interface SupportedVscodeCommandPolicy {
  classification: SupportedVscodeCommandClass;
  description: string;
}

const SUPPORTED_VSCODE_COMMANDS: Readonly<Record<string, SupportedVscodeCommandPolicy>> = Object.freeze({
  'workbench.files.action.refreshFilesExplorer': {
    classification: 'read-only',
    description: 'refresh the Explorer projection',
  },
  'testing.refreshTests': {
    classification: 'read-only',
    description: 'refresh test discovery',
  },
  'editor.action.triggerSuggest': {
    classification: 'read-only',
    description: 'request editor suggestions',
  },
  'typescript.restartTsServer': {
    classification: 'invocation-receipt',
    description: 'restart the TypeScript language service',
  },
  'rust-analyzer.reloadWorkspace': {
    classification: 'invocation-receipt',
    description: 'request a rust-analyzer workspace reload',
  },
  'editor.action.formatDocument': {
    classification: 'mutating-with-permission',
    description: 'format the active document',
  },
  'editor.action.formatSelection': {
    classification: 'mutating-with-permission',
    description: 'format the active selection',
  },
  'editor.action.organizeImports': {
    classification: 'mutating-with-permission',
    description: 'organize imports in the active document',
  },
  'editor.action.fixAll': {
    classification: 'mutating-with-permission',
    description: 'apply editor fix-all actions',
  },
  'workbench.action.files.saveAll': {
    classification: 'mutating-with-permission',
    description: 'save all dirty editors',
  },
  'workbench.action.files.save': {
    classification: 'mutating-with-permission',
    description: 'save the active editor',
  },
  'eslint.executeAutofix': {
    classification: 'mutating-with-permission',
    description: 'apply ESLint autofixes',
  },
});

const TERMINAL_ONLY_VSCODE_COMMANDS = new Set([
  'workbench.action.tasks.runTask',
  'workbench.action.tasks.build',
  'testing.runAll',
  'python.execInTerminal',
  'C_Cpp.BuildAndDebugActiveFile',
]);

export function getSupportedVscodeCommandPolicy(command: string): SupportedVscodeCommandPolicy | undefined {
  return SUPPORTED_VSCODE_COMMANDS[command];
}

export function explainUnsupportedVscodeCommand(command: string): string {
  if (TERMINAL_ONLY_VSCODE_COMMANDS.has(command)) {
    return `${command} must use run_terminal so execution, permission, and verification share terminal authority`;
  }
  return `${command} is not present in DevSeek's closed VS Code command registry`;
}

export function listSupportedVscodeCommandIds(): string[] {
  return Object.keys(SUPPORTED_VSCODE_COMMANDS);
}

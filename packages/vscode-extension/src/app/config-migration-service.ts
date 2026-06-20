import * as vscode from 'vscode';

const CONFIG_KEYS_TO_MIGRATE = [
  'serverPort',
  'newSessionPerRequest',
  'language',
  'maxContextLines',
  'requestTimeoutMs',
  'autoFixRounds',
  'autoApplyPolicy',
  'localExecutionFirst',
  'executionApproval',
  'cppValidationPolicy',
  'completionEnabled',
  'completionTriggerDelay',
  'contextTokenBudget',
  'generatedContentDisplayMode',
  'workingCopyStyle',
  'provider',
  'apiKey',
  'model',
  'openaiCompatBaseUrl',
  'openaiCompatApiKey',
  'openaiCompatModel',
  'autopilotMode',
  'autoInjectActiveEditor',
  'agentEnabled',
  'maxAgentRounds',
  'editAutoAcceptDelay',
  'protectedFiles',
] as const;

export async function migrateLegacyDeepseekConfiguration(): Promise<void> {
  const legacy = vscode.workspace.getConfiguration('deepseek');
  const current = vscode.workspace.getConfiguration('devseek');

  for (const key of CONFIG_KEYS_TO_MIGRATE) {
    const oldValue = legacy.inspect<unknown>(key);
    if (!oldValue) continue;

    const newValue = current.inspect<unknown>(key);
    if (newValue?.globalValue === undefined && oldValue.globalValue !== undefined) {
      await current.update(key, oldValue.globalValue, vscode.ConfigurationTarget.Global);
    }
    if (newValue?.workspaceValue === undefined && oldValue.workspaceValue !== undefined) {
      await current.update(key, oldValue.workspaceValue, vscode.ConfigurationTarget.Workspace);
    }
  }
}

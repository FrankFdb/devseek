const PROJECT_INIT_COMMAND = '/init';

export const PROJECT_INIT_AGENT_PROMPT = [
  'Generate a file named .devseek/rules.md that serves as concise repository instructions for DevSeek.',
  'Before writing, inspect the repository and check whether .devseek/rules.md or another applicable instruction file already exists.',
  'Do not overwrite an existing instruction file blindly. Read it first, preserve useful project-specific guidance, and avoid duplicating inherited rules.',
  'Use repository evidence for project structure, build commands, test commands, coding style, and contribution conventions. Do not infer commands that are not supported by files or configuration in the workspace.',
  'Keep the document clear, actionable, and specific to this repository. Include only sections that apply.',
  'After writing, read the final file back and report its path and the repository evidence used.',
].join('\n');

/**
 * Parses one explicit UI protocol command. Ordinary natural language, including
 * requests that happen to mention initialization, remains untouched for the
 * model to interpret.
 */
export function resolveProjectInitPrompt(userDisplay: string, prompt: string): string | undefined {
  return isProjectInitCommand(userDisplay) || isProjectInitCommand(prompt)
    ? PROJECT_INIT_AGENT_PROMPT
    : undefined;
}

export function isProjectInitCommand(text: string): boolean {
  return String(text || '').trim() === PROJECT_INIT_COMMAND;
}

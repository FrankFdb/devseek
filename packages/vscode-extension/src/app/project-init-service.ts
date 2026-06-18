import * as fs from 'fs';
import * as nodePath from 'path';

export interface ProjectInitDraftInput {
  workspaceRoot: string;
  projectName?: string;
}

export interface ProjectInitDraft {
  targetRelPath: string;
  targetAbsPath: string;
  content: string;
  detectedFiles: string[];
  detectedStacks: string[];
  buildCommands: string[];
  testCommands: string[];
}

const RULES_REL_PATH = '.devseek/rules.md';
const INIT_RE = /^\/init(?:\s|$)|^(?:初始化|生成|创建).*(?:devseek|项目).*(?:指令|规则)/i;

export class ProjectInitService {
  generateDraft(input: ProjectInitDraftInput): ProjectInitDraft {
    const root = nodePath.resolve(input.workspaceRoot);
    const detectedFiles = detectExistingFiles(root);
    const detectedStacks = detectStacks(detectedFiles);
    const buildCommands = detectBuildCommands(detectedFiles);
    const testCommands = detectTestCommands(detectedFiles);
    const projectName = input.projectName ?? nodePath.basename(root);

    const content = [
      '# DevSeek Project Instructions',
      '',
      `Project: ${projectName}`,
      '',
      '## Context Rules',
      '',
      '- Prefer minimal, focused changes that match the existing code style.',
      '- Read relevant files before editing.',
      '- Keep generated artifacts inside the workspace unless the user explicitly approves otherwise.',
      '- Do not write secrets, tokens, cookies, private keys, or passwords into prompts, logs, or memory.',
      '',
      '## Detected Stack',
      '',
      detectedStacks.length > 0
        ? detectedStacks.map(stack => `- ${stack}`).join('\n')
        : '- Unknown. Ask before assuming build, test, or runtime commands.',
      '',
      '## Build Commands',
      '',
      buildCommands.length > 0
        ? buildCommands.map(cmd => `- \`${cmd}\``).join('\n')
        : '- Define the project build command here.',
      '',
      '## Test Commands',
      '',
      testCommands.length > 0
        ? testCommands.map(cmd => `- \`${cmd}\``).join('\n')
        : '- Define the project test command here.',
      '',
      '## Definition of Done',
      '',
      '- Explain the files changed and why.',
      '- Run the most relevant build, lint, or test command when available.',
      '- If verification cannot run, state the reason and the residual risk.',
      '- Preserve user changes and avoid overwriting unrelated work.',
      '',
    ].join('\n');

    return {
      targetRelPath: RULES_REL_PATH,
      targetAbsPath: nodePath.join(root, RULES_REL_PATH),
      content,
      detectedFiles,
      detectedStacks,
      buildCommands,
      testCommands,
    };
  }
}

export function isProjectInitRequest(text: string): boolean {
  return INIT_RE.test((text || '').trim());
}

export function renderProjectInitDraftMarkdown(draft: ProjectInitDraft): string {
  return [
    `已生成项目指令草稿：\`${draft.targetRelPath}\``,
    '',
    '当前只生成草稿，不会自动写入文件。确认后可以让 DevSeek 创建或更新该文件。',
    '',
    `检测到的文件：${draft.detectedFiles.length > 0 ? draft.detectedFiles.map(file => `\`${file}\``).join('、') : '无'}`,
    `检测到的技术栈：${draft.detectedStacks.length > 0 ? draft.detectedStacks.join('、') : '未知'}`,
    '',
    '```md',
    draft.content.trimEnd(),
    '```',
  ].join('\n');
}

function detectExistingFiles(root: string): string[] {
  const candidates = [
    'package.json',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'tsconfig.json',
    'pyproject.toml',
    'requirements.txt',
    'go.mod',
    'Cargo.toml',
    'CMakeLists.txt',
    'Makefile',
    'README.md',
  ];
  return candidates.filter(relPath => fs.existsSync(nodePath.join(root, relPath)));
}

function detectStacks(files: string[]): string[] {
  const set = new Set<string>();
  if (files.includes('package.json')) set.add('Node.js / TypeScript or JavaScript');
  if (files.includes('tsconfig.json')) set.add('TypeScript');
  if (files.includes('pyproject.toml') || files.includes('requirements.txt')) set.add('Python');
  if (files.includes('go.mod')) set.add('Go');
  if (files.includes('Cargo.toml')) set.add('Rust');
  if (files.includes('CMakeLists.txt')) set.add('C/C++ with CMake');
  if (files.includes('Makefile')) set.add('Make-based build');
  return [...set];
}

function detectBuildCommands(files: string[]): string[] {
  const commands: string[] = [];
  if (files.includes('package.json')) commands.push('npm run compile', 'npm test');
  if (files.includes('CMakeLists.txt')) commands.push('cmake -S . -B build', 'cmake --build build');
  if (files.includes('Makefile')) commands.push('make');
  if (files.includes('go.mod')) commands.push('go test ./...');
  if (files.includes('Cargo.toml')) commands.push('cargo test');
  if (files.includes('pyproject.toml')) commands.push('python -m pytest');
  return unique(commands);
}

function detectTestCommands(files: string[]): string[] {
  const commands: string[] = [];
  if (files.includes('package.json')) commands.push('npm test');
  if (files.includes('go.mod')) commands.push('go test ./...');
  if (files.includes('Cargo.toml')) commands.push('cargo test');
  if (files.includes('pyproject.toml') || files.includes('requirements.txt')) commands.push('python -m pytest');
  return unique(commands);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

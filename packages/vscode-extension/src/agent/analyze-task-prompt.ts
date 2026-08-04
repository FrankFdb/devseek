import * as nodePath from 'path';
import type { AgentTask } from '../agent-task-decomposer';
import { getCommandHints } from '../agent-learner';
import type { ExecutionMode } from '../intent/intent-types';
import type { McpToolRef } from '../mcp/client';
import {
  getProjectMemorySync,
  getProjectRulesSync,
  wrapMemoryAsContext,
  wrapRulesAsContext,
} from '../project-rules';
import { routeTaskIntent, routeTaskSemanticContract } from '../task-intent-router';
import type { TaskSemanticContract } from '../task-semantic-contract';
import { buildToolsSuffix } from './agent-prompt-builder';

function scanLibFlagsFromContent(content: string): string {
  const flags = new Set<string>();
  if (/^\s*#include\s+[<"][^>"]*\bGL\/(gl|glu)\.h[>"]/im.test(content)) {
    flags.add('-lGL');
    flags.add('-lGLU');
  }
  if (/^\s*#include\s+[<"][^>"]*\bGL\/(glut|freeglut)\.h[>"]/im.test(content)) {
    flags.add('-lglut');
    flags.add('-lGL');
    flags.add('-lGLU');
  }
  if (/^\s*#include\s+[<"][^>"]*\bGLFW\/glfw3\.h[>"]/im.test(content)) flags.add('-lglfw');
  if (/^\s*#include\s+[<"][^>"]*\bglew\.h[>"]/im.test(content)) flags.add('-lGLEW');
  if (/^\s*#include\s+<(math\.h|cmath)>/im.test(content)) flags.add('-lm');
  if (/^\s*#include\s+<pthread\.h>/im.test(content)) flags.add('-lpthread');
  return [...flags].join(' ');
}

/** Builds the read/inspect prompt for one planned analysis task. */
export function buildAnalyzeTaskPrompt(
  userPrompt: string,
  task: AgentTask,
  currentContent: string,
  workdirOverride?: string,
  taskIndex = 1,
  taskTotal = 1,
  mcpTools?: McpToolRef[],
  executionMode?: ExecutionMode,
  semanticContract?: TaskSemanticContract,
  projectRulesText?: string,
): string {
  const taskIntent = semanticContract
    ? routeTaskSemanticContract(semanticContract)
    : routeTaskIntent(userPrompt);
  const basename = nodePath.basename(task.file);
  const ext = (basename.split('.').pop() ?? '').toLowerCase();
  const allowTerminalTools = executionMode === 'edit' || executionMode === 'run' || executionMode === 'destructive';
  const allowWorkspaceMutationTools = executionMode === 'edit' || executionMode === 'destructive';
  const langMap: Record<string, string> = {
    cpp: 'cpp', cc: 'cpp', h: 'c', c: 'c', hpp: 'cpp',
    ts: 'typescript', js: 'javascript', py: 'python', md: 'markdown',
  };
  const lang = langMap[ext] ?? ext;
  const contentSection = currentContent
    ? ['【当前文件内容】', `\`\`\`${lang}`, currentContent, '```', ''].join('\n')
    : '';
  const projectRules = projectRulesText ?? getProjectRulesSync();
  const projectMemory = getProjectMemorySync({
    prompt: userPrompt,
    relatedPaths: [task.absPath ?? task.file, workdirOverride]
      .filter((pathValue): pathValue is string => Boolean(pathValue)),
  });
  const analyzeContext = [
    projectRules ? wrapRulesAsContext(projectRules) : '',
    projectMemory ? wrapMemoryAsContext(projectMemory) : '',
  ].filter(Boolean).join('\n\n');

  const hasRunnableFileExt = /^(?:c|cc|cpp|cxx|py|js)$/.test(ext);
  const isExecTask = allowTerminalTools
    && hasRunnableFileExt
    && /编译|运行|执行|compile|build|run\b|execute/i.test(task.desc + userPrompt);
  const taskDir = workdirOverride ?? (task.absPath ? nodePath.dirname(task.absPath) : '');
  const workdirHint = taskDir ? `, "workdir":"${taskDir}"` : '';
  const noExt = basename.replace(/\.[^.]+$/, '');
  const srcArg = task.absPath ? `'${task.absPath.replace(/'/g, "'\\''")}'` : basename;
  const exeArg = taskDir ? `'${nodePath.join(taskDir, noExt).replace(/'/g, "'\\''")}'` : noExt;
  const libFlags = isExecTask ? scanLibFlagsFromContent(currentContent) : '';
  const libFlagsSuffix = libFlags ? ` ${libFlags}` : '';
  let defaultCmd = `gcc ${srcArg} -o ${exeArg}${libFlagsSuffix} && ${exeArg}`;
  if (/\.cpp$|\.cc$/i.test(basename)) {
    defaultCmd = `g++ -std=c++17 ${srcArg} -o ${exeArg}${libFlagsSuffix} && ${exeArg}`;
  } else if (/\.py$/i.test(basename)) {
    defaultCmd = `python3 ${srcArg}`;
  } else if (/\.js$/i.test(basename)) {
    defaultCmd = `node ${srcArg}`;
  }
  const learnedCmds = isExecTask ? getCommandHints('compile') : '';
  const learnedCmdsSection = learnedCmds
    ? `\n【已知成功命令（优先使用）】\n${learnedCmds}\n`
    : '';
  const execSection = isExecTask
    ? `\n【编译/运行提示】如需执行，可直接使用 run_terminal 工具（命令中必须使用绝对路径，严禁使用相对路径，以确保不同工作目录下路径正确）：\n[TOOL:run_terminal {"command":"${defaultCmd}"${workdirHint}}]\n（命令可按需修改，必须通过工具调用执行，不要只描述步骤）\n${learnedCmdsSection}`
    : '';

  return [
    allowTerminalTools
      ? `你是代码分析智能体，请分析文件 ${basename}。你有完整工具访问权限，可以主动读取相关文件、搜索代码、执行命令。`
      : `你是代码分析智能体，请分析 ${basename}。当前为只读模式，只能读取文件、搜索代码和列目录，不能执行终端命令或修改工作区。`,
    '',
    analyzeContext,
    '【用户需求背景】',
    userPrompt,
    '',
    '【本次任务】',
    `文件: ${basename}`,
    `目标: ${task.desc}`,
    '',
    contentSection,
    execSection,
    '【分析要求】',
    '- 若需要查看相关文件、搜索代码引用，请主动调用工具',
    '- 给出有具体证据的分析（文件路径/行号/函数名）',
    '- 如有具体问题，明确指出问题位置和改进建议',
    '- 使用简体中文回复',
    buildToolsSuffix(taskIndex, taskTotal, mcpTools, taskDir, {
      includeTerminal: allowTerminalTools,
      includeWorkspaceMutationTools: allowWorkspaceMutationTools,
      taskIntent,
    }),
  ].join('\n');
}

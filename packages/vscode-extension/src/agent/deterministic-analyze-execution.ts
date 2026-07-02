import * as fs from 'fs';
import * as nodePath from 'path';
import type * as vscode from 'vscode';
import { getAgentTaskDisplayTarget, type AgentTask } from '../agent-task-decomposer';
import { classifyTerminalEvidenceCommand, type TerminalEvidence } from './completion-evidence';
import { isCppBuildArtifactDirName } from '../cpp-build-layout';
import { planLocalExecution, runLocalExecution, type LocalExecutionPlan } from '../execution-planner';
import type { AgentLoopCallbacks } from './loop-types';
import { withTaskTerminalEvidence, type TaskExecutionResult } from './task-execution-result';
import { analyzeTerminalEvidence } from './tool-loop';

const LOCAL_ANALYZE_EXECUTION_RE = /(编译|构建|运行|执行|启动|验证|测试|compile|build|run|execute|verify|test)/i;
const FORCE_LOCAL_BUILD_RE = /(重新|再次|重编译|重构建|rebuild|recompile|build|compile|编译|构建)/i;
const LOCAL_EXECUTION_SOURCE_EXT_RE = /\.(?:c|cc|cpp|cxx|h|hpp|hh|hxx|py|js)$/i;
const LOCAL_EXECUTION_DISCOVERY_DIRS = new Set(['src', 'include']);
const LOCAL_EXECUTION_DISCOVERY_SKIP_DIRS = new Set(['node_modules', 'dist']);
const MAX_LOCAL_EXECUTION_DISCOVERY_FILES = 80;

export function isExistingDirectory(absPath: string | undefined): boolean {
  if (!absPath) return false;
  try {
    return fs.statSync(absPath).isDirectory();
  } catch {
    return false;
  }
}

export function taskWorkdirFromResolvedPath(absPath: string | undefined): string | undefined {
  if (!absPath) return undefined;
  return isExistingDirectory(absPath) ? absPath : nodePath.dirname(absPath);
}

export async function tryExecuteDeterministicAnalyzeExecution(input: {
  task: AgentTask;
  taskIndex: number;
  taskTotal: number;
  userPrompt: string;
  workspaceRoot: vscode.Uri;
  callbacks: AgentLoopCallbacks;
  workdir: string | undefined;
}): Promise<TaskExecutionResult | undefined> {
  if (!shouldAttemptDeterministicAnalyzeExecution(input.userPrompt, input.task)) return undefined;

  const candidateFiles = collectLocalExecutionCandidateFiles(input.workdir);
  if (candidateFiles.length === 0) return undefined;

  const planningText = [input.userPrompt, input.task.desc].filter(Boolean).join('\n');
  const plan = planLocalExecution(planningText, candidateFiles, input.workspaceRoot.fsPath, {
    forceBuild: FORCE_LOCAL_BUILD_RE.test(planningText),
  });
  if (!plan) return undefined;

  await input.callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'execute',
    taskId: input.task.id,
    taskFile: getAgentTaskDisplayTarget(input.task),
    taskAction: input.task.action,
    taskDesc: input.task.desc,
    taskIndex: input.taskIndex,
    taskTotal: input.taskTotal,
    state: 'started',
    title: plan.mode === 'run-only' ? '运行本地程序验证' : '本地编译/运行验证',
    detail: `使用项目目录 ${nodePath.basename(plan.cwd) || plan.cwd} 的标准构建目录 build。`,
  });

  const terminalEvidence = await runPlannedCommand(input.callbacks, plan);
  const latestEvidence = terminalEvidence[terminalEvidence.length - 1];
  if (!latestEvidence?.ok && !latestEvidence?.reviewRequired) {
    await input.callbacks.onAgentStatus({
      type: 'agentStatus',
      phase: 'execute',
      taskId: input.task.id,
      taskFile: getAgentTaskDisplayTarget(input.task),
      taskAction: input.task.action,
      taskDesc: input.task.desc,
      taskIndex: input.taskIndex,
      taskTotal: input.taskTotal,
      state: 'skipped',
      title: '本地验证未通过，转入 Agent 分析',
      detail: latestEvidence?.detail?.slice(0, 400) || '本地验证快路径未取得成功证据。',
    });
    return undefined;
  }

  const detail = latestEvidence.reviewRequired
    ? latestEvidence.detail || '图形或交互式程序已启动，运行效果需要人工确认。'
    : '本地编译/运行验证已完成；终端详情已保存在本轮日志中。';
  await input.callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'execute',
    taskId: input.task.id,
    taskFile: getAgentTaskDisplayTarget(input.task),
    taskAction: input.task.action,
    taskDesc: input.task.desc,
    taskIndex: input.taskIndex,
    taskTotal: input.taskTotal,
    state: 'completed',
    title: latestEvidence.reviewRequired ? '程序已启动，等待人工确认' : '本地验证完成',
    detail,
  });

  return withTaskTerminalEvidence({
    applied: false,
    raw: detail,
    taskComplete: true,
  }, terminalEvidence);
}

function shouldAttemptDeterministicAnalyzeExecution(userPrompt: string, task: AgentTask): boolean {
  const text = [userPrompt, task.desc, task.file].filter(Boolean).join('\n');
  return LOCAL_ANALYZE_EXECUTION_RE.test(text);
}

function collectLocalExecutionCandidateFiles(workdir: string | undefined): string[] {
  if (!workdir || !isExistingDirectory(workdir)) return [];
  const found: string[] = [];
  const pushIfCandidate = (filePath: string): void => {
    if (found.length >= MAX_LOCAL_EXECUTION_DISCOVERY_FILES) return;
    const base = nodePath.basename(filePath);
    if (base === 'CMakeLists.txt' || LOCAL_EXECUTION_SOURCE_EXT_RE.test(base)) {
      found.push(filePath);
    }
  };

  const scanOneDir = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= MAX_LOCAL_EXECUTION_DISCOVERY_FILES) break;
      if (entry.isFile()) pushIfCandidate(nodePath.join(dir, entry.name));
    }
  };

  scanOneDir(workdir);
  for (const dirName of LOCAL_EXECUTION_DISCOVERY_DIRS) {
    const child = nodePath.join(workdir, dirName);
    if (!isExistingDirectory(child)) continue;
    const normalizedDirName = dirName.toLowerCase();
    if (LOCAL_EXECUTION_DISCOVERY_SKIP_DIRS.has(normalizedDirName) || isCppBuildArtifactDirName(dirName)) continue;
    scanOneDir(child);
  }
  return found;
}

async function runPlannedCommand(
  callbacks: AgentLoopCallbacks,
  plan: LocalExecutionPlan,
): Promise<TerminalEvidence[]> {
  try {
    if (callbacks.onTerminalCommand) {
      const output = await callbacks.onTerminalCommand(plan.command, plan.cwd);
      return [analyzeTerminalEvidence(plan.command, output, plan.cwd).evidence];
    }

    const result = await runLocalExecution(plan);
    return [{
      command: result.command,
      kind: classifyTerminalEvidenceCommand(result.command),
      ok: result.ok,
      exitCode: result.exitCode,
      detail: result.output.slice(0, 1200),
      ...(result.reviewRequired ? { reviewRequired: true } : {}),
    }];
  } catch {
    return [];
  }
}

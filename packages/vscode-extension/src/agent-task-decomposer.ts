/**
 * Agent Task Decomposer
 *
 * Phase-0 of the two-phase Agent Loop (Architect+Editor pattern, à la Aider/Cursor).
 *
 * Sends the user's prompt + attached file list to DeepSeek and requests a structured
 * JSON task plan.  DeepSeek returns ONLY a plan — no code — so this round is cheap,
 * fast, and unambiguous.
 *
 * The resulting AgentTask[] drives Phase-1: one focused DeepSeek call per task.
 */

import * as nodePath from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { chat } from './bridge-client';
import { getProjectRulesSync, wrapRulesAsContext, getProjectMemorySync, wrapMemoryAsContext } from './project-rules';
import { detectWorkspacePathScope } from './workspace/path-resolver';
import { sanitizeWorkspaceContextAnchorPath } from './workspace/context-anchor';
import { resolveLocalExecutionProjectDirFromCandidate } from './workspace/local-execution-target';
import { isCodeArtifactPath, requiresCodeArtifactForEvidence, requiresCommandEvidence } from './agent/completion-evidence';
import { buildEngineeringGuidelinesPrompt } from './agent/engineering-guidelines';
import { buildTaskShapeGuidancePrompt } from './agent/task-shape';
import { classifyIntent } from './intent/intent-classifier';
import { isCppBuildArtifactDirName } from './cpp-build-layout';
import {
  isMarkdownDocumentCreateTask,
  isMarkdownDocumentDeliverableRequest,
  isMarkdownDocumentOnlyDeliverableRequest,
  MARKDOWN_DOCUMENT_DELIVERABLE_TASK_DESC,
  markdownDocumentFilenameForPrompt,
} from './agent/deliverable-document';

// ----------------------------------------------------------------
// Public types
// ----------------------------------------------------------------

/**
 * Task actions recognized by the Agent Loop.
 * - analyze  : read-only, stream analysis to chat bubble
 * - explain  : answer a question about code, no file changes
 * - modify   : edit existing file (SEARCH/REPLACE preferred, full-file fallback)
 * - create   : write a new file to workspace
 * - delete   : remove a file from workspace
 * - explore  : open-ended exploration; Editor uses list_dir/grep/read tools first,
 *              then decides next steps autonomously (G1: no pre-known file required)
 * - respond  : local, non-tool response for provider/session recovery; no files
 *              are read, searched, or written.
 */
export type AgentTaskAction = 'modify' | 'analyze' | 'create' | 'delete' | 'explain' | 'explore' | 'respond';

// ----------------------------------------------------------------
// File reading utility — exported for use in agent-loop.ts
// ----------------------------------------------------------------

const READ_MAX_LINES = 400;
const PLANNER_FILE_CONTEXT_TOTAL_CHARS = 14_000;
const PLANNER_FILE_CONTEXT_MAX_CHARS = 4_000;
const PLANNER_ACTIVE_FILE_CONTEXT_MAX_CHARS = 8_000;

/**
 * Read a file safely with a line-count guard.
 * Returns empty string on any error (file not found, permission denied…).
 */
export function readFileContentSafe(absPath: string, maxLines = READ_MAX_LINES): string {
  try {
    const content = fs.readFileSync(absPath, 'utf8');
    const lines = content.split('\n');
    if (lines.length > maxLines) {
      return (
        lines.slice(0, maxLines).join('\n') +
        `\n// ... (文件过长，已截断，仅显示前 ${maxLines}/${lines.length} 行)`
      );
    }
    return content;
  } catch {
    return '';
  }
}

/**
 * Read a file without any line limit.
 * Used by the Editor role so SEARCH/REPLACE blocks can match any line.
 * Returns empty string on any error.
 */
export function readFileContentFull(absPath: string): string {
  try {
    return fs.readFileSync(absPath, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Structured findings from a prior analysis pass.
 * Can be injected into a subsequent Architect (Plan) request so that
 * discovered bugs are guaranteed to appear in the task list.
 */
export interface AnalysisFindings {
  /** Short, actionable issue descriptions, e.g. "idle_rpm 上界 800009 疑似笔误" */
  issues: string[];
  /** Workspace-relative paths created/modified by the immediately preceding agent run */
  recentlyChangedPaths?: string[];
}

export interface AgentTask {
  /** Stable identifier used as workingEntry key */
  id: string;
  /** Workspace-relative path of the target file. Empty for non-file recovery tasks. */
  file: string;
  /** What to do with this file */
  action: AgentTaskAction;
  /** Human-readable short description (shown in Working area) */
  desc: string;
  /** Whether the task targets a real workspace file or an internal recovery boundary. */
  targetKind?: 'workspace-file' | 'provider-response' | 'agent-session';
  /** Safe display label for non-file targets. */
  visibleTarget?: string;
  /** Original absolute path as provided by the user attachment */
  absPath?: string;
  /** Deterministic content captured from a checkpoint/recovery fact. */
  expectedContent?: string;
}

export function getAgentTaskDisplayTarget(task: Pick<AgentTask, 'file' | 'visibleTarget'>): string {
  return task.visibleTarget || (task.file ? nodePath.basename(task.file) : 'Agent 任务');
}

export interface DecomposeResult {
  tasks: AgentTask[];
  /** Raw DeepSeek response text (for debugging / fallback) */
  raw: string;
  /** Whether the JSON plan was successfully parsed */
  ok: boolean;
  /** Whether callers may synthesize a local fallback plan when planner output was unusable. */
  fallbackAllowed?: boolean;
  /** Error message if parsing failed */
  error?: string;
  /** AI reasoning prose extracted from before the JSON block — used in the working area reasoning card */
  prose?: string;
}

// ----------------------------------------------------------------
// promptDir detection — shared by buildDecomposeSystemPrompt + parseTaskPlan
// ----------------------------------------------------------------

/**
 * Derive the "working directory" for this coding request.
 *
 * Priority (highest → lowest):
 *  1. Explicit path in user prompt  (指定路径: /x  |  在x目录  |  bare absolute path)
 *  2. Relative path keyword pattern  (在 code/3d_demo  |  in src/components)
 *  3. Inferred from first attached file / active editor (walk up past SRC_LIKE dirs)
 *
 * Returns:
 *  promptDir         — absolute path, or undefined when no sub-project found
 *  promptDirIsExplicit — true only for cases 1–2 (user spoke the path)
 */
function detectPromptDir(
  userPrompt: string | undefined,
  attachedFiles: string[],
  activeEditorFile?: string,
): { promptDir: string | undefined; promptDirIsExplicit: boolean } {
  return detectWorkspacePathScope(userPrompt, attachedFiles, sanitizeActiveEditorContextPath(activeEditorFile));
}

function sanitizeActiveEditorContextPath(activeEditorFile?: string): string | undefined {
  const workspaceRoots = (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath);
  return sanitizeWorkspaceContextAnchorPath(activeEditorFile, workspaceRoots);
}

function workspaceRelativePathForAbs(absPath: string, fallbackRoot?: string): string {
  const normalized = absPath.replace(/\\/g, '/');
  for (const wf of vscode.workspace.workspaceFolders ?? []) {
    const root = wf.uri.fsPath.replace(/\\/g, '/').replace(/\/$/, '');
    if (normalized === root) return nodePath.basename(normalized);
    if (normalized.startsWith(root + '/')) return normalized.slice(root.length + 1);
  }
  if (fallbackRoot) {
    const root = fallbackRoot.replace(/\\/g, '/').replace(/\/$/, '');
    if (normalized === root) return '';
    if (normalized.startsWith(root + '/')) return normalized.slice(root.length + 1);
  }
  return nodePath.basename(absPath);
}

function taskDisplayPathForAbs(absPath: string, fallbackRoot?: string): string {
  return workspaceRelativePathForAbs(absPath, fallbackRoot) || nodePath.basename(absPath);
}

function isInsideDir(absPath: string, dir: string): boolean {
  const rel = nodePath.relative(nodePath.resolve(dir), nodePath.resolve(absPath));
  return rel === '' || (!!rel && !rel.startsWith('..') && !nodePath.isAbsolute(rel));
}

function normalizePlanPathKey(pathValue: string): string {
  return (pathValue || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^a\//, '')
    .replace(/^b\//, '')
    .replace(/^\/+/, '')
    .toLowerCase();
}

function stripPromptDirAlias(fileRel: string, promptDir: string): string {
  let clean = fileRel.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  const promptDirRel = workspaceRelativePathForAbs(promptDir, promptDir).replace(/\/$/, '');
  const aliases = new Set<string>();
  if (promptDirRel && promptDirRel !== nodePath.basename(promptDir)) {
    const parts = promptDirRel.split('/').filter(Boolean);
    for (let i = parts.length; i >= 1; i -= 1) {
      aliases.add(parts.slice(0, i).join('/'));
    }
  }
  aliases.add(nodePath.basename(promptDir));

  const ordered = [...aliases].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const alias of ordered) {
    if (clean === alias) return '';
    if (clean.startsWith(alias + '/')) {
      clean = clean.slice(alias.length + 1);
      break;
    }
  }
  return clean;
}

function resolveTaskInsidePromptDir(taskFile: string, promptDir: string): { absPath: string; relPath: string } {
  const relSource = nodePath.isAbsolute(taskFile)
    ? workspaceRelativePathForAbs(taskFile, promptDir)
    : taskFile;
  const stripped = stripPromptDirAlias(relSource, promptDir);
  const safeParts = stripped
    .split('/')
    .filter(p => p !== '..' && p !== '.' && p !== '');
  const resolved = safeParts.length > 0
    ? nodePath.join(promptDir, ...safeParts)
    : nodePath.join(promptDir, nodePath.basename(taskFile));
  return {
    absPath: resolved,
    relPath: workspaceRelativePathForAbs(resolved, promptDir),
  };
}

// ----------------------------------------------------------------
// System prompt builders
// ----------------------------------------------------------------

/**
 * Build the Architect prompt with ACTUAL FILE CONTENTS injected.
 *
 * Including file content is the most critical improvement over the previous
 * architecture: the Architect sees real code—not just filenames—before
 * deciding what to do.  Files ≤200 lines are embedded in full;
 * longer files are truncated with a note.
 */
function buildDecomposeSystemPrompt(
  userPrompt: string,
  attachedFiles: string[],
  priorFindings?: AnalysisFindings,
  activeEditorFile?: string,
): string {
  const contextActiveEditorFile = sanitizeActiveEditorContextPath(activeEditorFile);
  const requestIntent = classifyIntent(userPrompt);
  const needsMarkdownDocumentDeliverable = isMarkdownDocumentDeliverableRequest(userPrompt);
  const readOnlyPlanMode = (requestIntent.mode === 'plan' || requestIntent.mode === 'inspect') && !needsMarkdownDocumentDeliverable;
  // Compute promptDir once here so it can be injected into the system prompt.
  // This is the same logic used later in parseTaskPlan — extracted to detectPromptDir() to stay in sync.
  const { promptDir: detectedPromptDir } = detectPromptDir(userPrompt, attachedFiles, contextActiveEditorFile);
  // Build per-file sections with a strict planning budget. Full file content is
  // available later through read_file; the Architect only needs enough context
  // to choose the shape of the task plan.
  let remainingFileContextChars = PLANNER_FILE_CONTEXT_TOTAL_CHARS;
  const fileSections = attachedFiles.map((absPath, i) => {
    const basename = nodePath.basename(absPath);
    const relPath = workspaceRelativePathForAbs(absPath, detectedPromptDir);
    const ext = (basename.split('.').pop() ?? '').toLowerCase();
    const langMap: Record<string, string> = {
      cpp: 'cpp', cc: 'cpp', cxx: 'cpp', c: 'c', h: 'c', hpp: 'cpp',
      ts: 'typescript', js: 'javascript', py: 'python',
      json: 'json', md: 'markdown', sh: 'bash',
    };
    const lang = langMap[ext] ?? ext;
    let content = readFileContentSafe(absPath, READ_MAX_LINES);
    if (!content) return `  ${i + 1}. ${relPath}  （无法读取内容）`;
    if (remainingFileContextChars <= 0) {
      return `  ${i + 1}. **${relPath}**\n（规划阶段文件内容预算已用尽；执行阶段必须通过 read_file/grep_search 按需读取。）`;
    }
    const perFileBudget = absPath === contextActiveEditorFile
      ? PLANNER_ACTIVE_FILE_CONTEXT_MAX_CHARS
      : PLANNER_FILE_CONTEXT_MAX_CHARS;
    const budget = Math.max(0, Math.min(perFileBudget, remainingFileContextChars));
    if (content.length > budget) {
      content = [
        content.slice(0, budget),
        '',
        `...[规划阶段已截断 ${content.length - budget} 字符；执行阶段必须通过 read_file/grep_search 按需读取完整内容]`,
      ].join('\n');
    }
    remainingFileContextChars = Math.max(0, remainingFileContextChars - content.length);
    return [
      `  ${i + 1}. **${relPath}**`,
      '```' + lang,
      content,
      '```',
    ].join('\n');
  }).join('\n\n');

  // Inject prior analysis findings so the Architect is forced to include them.
  const findingsSection = (priorFindings && priorFindings.issues.length > 0)
    ? [
        '',
        '【上轮分析已发现以下问题，修复计划必须覆盖所有项】',
        ...priorFindings.issues.map((issue, i) => `${i + 1}. ${issue}`),
      ].join('\n')
    : '';

  // Inject recently changed file paths so follow-up requests (e.g. "compile and run")
  // know which files were just created, rather than targeting unrelated files.
  const recentFilesSection = (priorFindings?.recentlyChangedPaths && priorFindings.recentlyChangedPaths.length > 0)
    ? [
        '',
        '【上轮已创建/修改的文件 — 后续任务（如编译、运行）必须针对这些文件，而不是其他文件】',
        ...priorFindings.recentlyChangedPaths.map(p => `  - ${p}`),
      ].join('\n')
    : '';

  const projectRules = getProjectRulesSync();
  const projectRulesSection = projectRules ? ['', wrapRulesAsContext(projectRules)].join('\n') : '';
  const projectMemory = getProjectMemorySync({
    prompt: userPrompt,
    relatedPaths: [...attachedFiles, contextActiveEditorFile].filter((pathValue): pathValue is string => Boolean(pathValue)),
  });
  const projectMemorySection = projectMemory ? ['', wrapMemoryAsContext(projectMemory)].join('\n') : '';

  // Active editor context: tell the LLM which project the user is working in
  // so it outputs paths relative to that project, not the monorepo root.
  const activeEditorSection = contextActiveEditorFile
    ? `\n【当前活跃编辑器文件（项目上下文）】\n${contextActiveEditorFile}\n（请确保所有新建/修改文件的路径相对于该文件所在的项目目录，而非 workspace 根目录。）`
    : '';

  const noFilesMode = attachedFiles.length === 0;
  const filesSectionHeader = noFilesMode
    ? '【现有文件列表】\n（无预附着文件。请根据用户需求和以下工具调用规则，自行规划目录结构、文件名和路径。）'
    : '【涉及文件及当前内容】\n' + fileSections;

  const rule4 = noFilesMode
    ? '4. 无预附着文件时，自行推断合理的文件名和相对路径（含目录层级），确保每个任务覆盖一个独立文件。'
    : '4. 每个任务对应一个文件，文件名从上面列表选取。';

  // Convert to workspace-relative form for display in the prompt
  const wsRoot0 = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const promptDirRel = (() => {
    if (!detectedPromptDir) return undefined;
    if (!wsRoot0) return workspaceRelativePathForAbs(detectedPromptDir, detectedPromptDir);
    const pd = detectedPromptDir.replace(/\\/g, '/').replace(/\/$/, '');
    const wr = wsRoot0.replace(/\\/g, '/').replace(/\/$/, '');
    if (pd.startsWith(wr + '/')) return pd.slice(wr.length + 1);
    return workspaceRelativePathForAbs(detectedPromptDir, detectedPromptDir);
  })();
  // Inject target directory constraint so AI outputs full relative paths, not bare filenames.
  // Without this, the AI outputs "main.cpp" instead of "code/3d_demo/main.cpp", forcing
  // the confine block to fix paths after the fact (error-prone when AI uses subdirs).
  const promptDirRule = detectedPromptDir
    ? `\n【工作目录约束（最高优先级）】\n` +
      `本次任务的 Agent 工作区根：${detectedPromptDir}\n` +
      (promptDirRel
        ? `本次任务的目标目录：${promptDirRel}/\n`
        : '') +
      `file 字段必须写相对于 Agent 工作区根的完整路径，不要带绝对路径前缀。\n` +
      (promptDirRel
        ? `正确示例：${promptDirRel}/docs/design.md\n`
        : `正确示例：src/main.cpp\n`) +
      `错误示例：design.md  （只写文件名，禁止）`
    : '';

  // Always inject tool hint — the LLM decides from semantic Q1/Q2/Q3 rules whether to explore first.
  // Keyword-gating this hint was fragile (language-dependent); now the classification rules are
  // semantic and language-agnostic, so we always tell the LLM what tools are available.
  const noFilesToolHint = readOnlyPlanMode
    ? `
【执行阶段可用工具（Editor 角色通过文本格式调用）】
  [TOOL:list_dir {"path":"src/"}]                 — 列出目录内容
  [TOOL:read_file {"path":"docs/requirements.md"}] — 读取文件内容
  [TOOL:grep_search {"pattern":"class","path":"src/"}] — 搜索代码

只读规划/分析任务只能用工具理解代码和文档，最终输出建议、对策和任务清单；不要规划写文件动作。
`
    : `
【执行阶段可用工具（Editor 角色通过文本格式调用）】
  [TOOL:list_dir {"path":"code/3d_demo/"}]       — 列出目录内容
  [TOOL:read_file {"path":"src/main.cpp"}]        — 读取文件内容
  [TOOL:grep_search {"pattern":"class","path":"src/"}] — 搜索代码

若需要先理解代码库结构再修改（Q3 答案为"是待修改的目标尚未确定"），生成 action=explore 任务：
  desc 写明要用哪个工具在哪个目录查找什么内容；然后再生成依赖其结果的 modify/create 任务。
`;

  const readOnlyModeRule = readOnlyPlanMode
    ? [
        '',
        '【只读规划/分析约束（最高优先级）】',
        '本次用户要求的是分析、建议、对策检讨或任务建议，不是立即修改代码。',
        '禁止生成 action=modify/create/delete；如果用户要求“给出 task”，这些 task 是回复里的建议清单，不是 Agent 要立即执行的代码修改任务。',
        '输出 1 个总体 action=analyze 或 action=explain 任务，目标指向项目目录、需求文档或最相关的上下文目录。',
      ].join('\n')
    : '';

  const markdownDocumentDeliverableRule = needsMarkdownDocumentDeliverable
    ? [
        '',
        '【Markdown 文档交付物约束（最高优先级）】',
        '用户明确要求通过 Markdown 文档/报告提供结果。必须规划一个 action=create 的 .md 文件任务；聊天里的 Markdown 摘要不能替代文件交付物。',
        '不要把读取需求、旧实现、主控职责或对比分析拆成独立 analyze/explore Todo；这些都是创建 Markdown 文档任务内部必须完成的证据采集步骤。',
        '该 create 任务的 desc 必须写清楚：先分析需求文档、旧实现和主控职责，再把新旧需求对比、实现对策和主控任务清单写入 .md，并在最终结果中返回文档路径。',
        '本次只允许创建 Markdown 文档交付物；不要规划 modify/delete，也不要创建或修改代码文件，除非用户同时明确要求落地代码修改。',
      ].join('\n')
    : '';

  return [
    '你是一个顶级编程智能体的任务规划器（Architect 角色）。',
    '【重要提示】本次任务计划仅针对下方【用户需求】，请严格只为本次请求制定计划，不得纳入任何之前对话中已完成或提及的其他任务。',
    activeEditorSection,
    noFilesMode
      ? readOnlyPlanMode
        ? '用户提出了一个只读分析/规划需求，无预附着文件。请根据需求中的路径和当前项目上下文给出 JSON 任务计划。'
        : '用户提出了一个代码创建/修改需求，无预附着文件。请根据需求自行规划文件列表并给出 JSON 任务计划。'
      : '用户提供了以下文件（含当前内容）和需求，请基于文件实际内容给出 JSON 任务计划。',
    '先用 1-2 句话（中文）简述你的分析思路和计划方向，然后输出 JSON 任务计划。不要输出代码。',
    projectRulesSection,
    projectMemorySection,
    buildTaskShapeGuidancePrompt(userPrompt),
    '',
    buildEngineeringGuidelinesPrompt('planner'),
    '',
    '【用户需求】',
    userPrompt,
    findingsSection,
    recentFilesSection,
    '',
    filesSectionHeader,
    '',
    promptDirRule,
    readOnlyModeRule,
    markdownDocumentDeliverableRule,
    noFilesToolHint,
    '【输出格式（严格 JSON，无 markdown 包裹）】',
    '{',
    '  "tasks": [',
    '    {',
    '      "id": "t1",',
    '      "file": "文件的完整相对路径（相对于 workspace 根，如 code/3d_demo/main.cpp；explore 任务填目标搜索目录）",',
    '      "action": "modify|analyze|create|delete|explain|explore",',
    '      "desc": "基于文件实际内容的具体描述（≤50字）"',
    '    }',
    '  ]',
    '}',
    '',
    '【意图推断规则（语言无关，基于语义）】',
    '在制定任务计划前，先回答以下三个问题，用答案驱动任务类型选择，而非匹配特定词语：',
    '',
    'Q1: 所有任务完成后，用户期望存在什么？',
    '  → 代码或文件发生了变化（新增/改进/修复/重构/删除）→ 需要 modify / create / delete 任务',
    '  → 用户获得了一份分析报告、对策检讨、建议清单、任务拆解或解答 → analyze / explain 任务',
    '',
    'Q2: 如果你只阅读文件并输出分析结论，不修改任何文件，用户会满意吗？',
    '  → 不满意（用户期望代码变得更好、功能增加、问题消失）→ 必须生成 modify / create 任务',
    '  → 满意（用户只是想理解代码、获得建议/对策/任务清单）→ analyze / explain 任务合适',
    '',
    'Q3: 附件文件是"待修改的目标"，还是"为后续修改提供上下文的参考"？',
    '  → 是待修改目标 → 直接生成针对这些文件的 modify 任务',
    '  → 是参考材料、真正要修改的文件需要先探索 → 先生成 action=explore 任务，再生成 modify/create 任务',
    '',
    '任务规划规则（由上述答案驱动）：',
    '1. 不得把每个附件文件独立生成 analyze 任务——读文件是手段，不是目标，更不是交付物。',
    '   每个附件有 modify/create 任务需求时，直接规划修改任务；需要整体理解时，合并为 1 个 explore 任务。',
    '2. 需要理解代码后再修改：生成 1 个整体性 explore 任务 + 若干针对性 modify/create 任务（只列真正需要改的文件）。',
    '   对“参考既有通讯模块方式”的既有工程任务，explore 任务必须覆盖参考模块、项目级收发入口/出口、uart*_tx/rx_main 或等价通道、TunnelTransport/分片、publisher/subscriber、topic/payload_type/命令号和调度调用点。',
    '   对“既有/正式项目 + 代码实现 + 设计/文档交付”的任务，计划必须按软件工程阶段组织：项目级事实调查 → 设计/接口/修改清单 → 代码实现 → 编译/测试/验证；不要按固定文档数量驱动计划，文档数量由用户明确要求和调查结果决定。',
    '3. 纯信息需求（Q2 答案为"满意"，无代码变更期望）：生成 1 个总体 analyze/explain 任务，不逐文件拆分。',
    '4. 需要执行命令（编译/运行/测试）：action=analyze，file 必须指向项目目录或源文件，不要指向 build/bin 等构建产物。',
    '   desc 只描述验证意图（如"编译并运行项目确认效果"），不要拼 run_terminal 命令、清理命令或构建目录；执行器会选择标准命令。',
    '   有代码创建 + 执行两个意图时：先生成 create 任务，再生成执行验证用的 analyze 任务。',
    '5. 需要先探索再修改（真正修改的文件未知）：先 action=explore 任务，再依赖其结果的 modify/create 任务。',
    rule4,
    '7. desc 要具体：写出哪个函数/类/逻辑需要改，而非泛称"修改文件"。',
    '   示例好：\"修复 pump_adjust.cpp 第52行 nullptr 解引用\"',
    '   示例差：\"修改 pump_adjust.cpp\"',
    '8. 在 JSON 之前只输出 1-2 句简短的思路说明，JSON 之后不要补充任何内容。',
  ].join('\n');
}

function buildLocalMarkdownDocumentDeliverableTasks(
  userPrompt: string,
  attachedFiles: string[],
  activeEditorFile?: string,
): AgentTask[] {
  const { promptDir } = detectPromptDir(userPrompt, attachedFiles, activeEditorFile);
  const contextTasks: AgentTask[] = attachedFiles.map((absPath, index) => ({
    id: `ctx${index + 1}`,
    file: taskDisplayPathForAbs(absPath, promptDir),
    action: 'analyze',
    desc: 'Markdown 文档交付物的上下文证据文件',
    absPath,
  }));
  return normalizeMarkdownDocumentDeliverableTasks(contextTasks, userPrompt, promptDir, activeEditorFile);
}

// ----------------------------------------------------------------
// JSON plan parser
// ----------------------------------------------------------------

interface RawTaskPlan {
  tasks?: Array<{ id?: string; file?: string; action?: string; desc?: string }>;
}

const VALID_ACTIONS = new Set<string>(['modify', 'analyze', 'create', 'delete', 'explain', 'explore']);

function taskTargetsCodeFile(task: AgentTask): boolean {
  return isCodeArtifactPath(task.absPath ?? task.file);
}

function isWriteTask(task: AgentTask): boolean {
  return task.action === 'modify' || task.action === 'create' || task.action === 'delete';
}

function isValidationTask(task: AgentTask): boolean {
  const text = `${task.file} ${task.desc}`.toLowerCase();
  return /(?:\b(?:cmake|make|npm|pnpm|yarn|pytest|ctest|cargo|go test|mvn|gradle)\b|编译|构建|测试|验证|运行)/.test(text);
}

function isImplementationContextTask(task: AgentTask): boolean {
  if (task.action !== 'analyze' && task.action !== 'explain' && task.action !== 'explore') return false;
  const file = task.file || '';
  const text = `${file} ${task.desc}`.toLowerCase();
  if (/\.(?:md|markdown|txt|rst|adoc|json|ya?ml|toml|csv)$/i.test(file)) return true;
  return /需求|规格|方案|设计|文档|计划|上下文|提取|通讯|通信|链路|接口|参考|主控|遥控器|平台|license|uart|tunnel|mavlink|topic|publisher|subscriber|requirements?|spec(?:ification)?|design|plan|context/.test(text);
}

function normalizeReadOnlyPlanTasks(
  tasks: AgentTask[],
  userPrompt: string | undefined,
  promptDir: string | undefined,
  activeEditorFile?: string,
): AgentTask[] {
  if (!userPrompt) return tasks;
  if (isMarkdownDocumentDeliverableRequest(userPrompt)) return tasks;
  const intent = classifyIntent(userPrompt);
  if (intent.mode !== 'plan' && intent.mode !== 'inspect') return tasks;

  if (intent.mode === 'inspect') {
    return tasks.map((task) => {
      if (!isWriteTask(task)) return task;
      return {
        ...task,
        action: 'analyze' as AgentTaskAction,
        desc: task.desc ? `只读分析：${task.desc}` : '只读分析相关文件',
      };
    });
  }

  const targetAbs = selectReadOnlyPlanningTargetAbs(tasks, promptDir, activeEditorFile);
  const displayRoot = selectReadOnlyPlanningDisplayRoot(promptDir, activeEditorFile);
  const targetFile = targetAbs
    ? taskDisplayPathForAbs(targetAbs, displayRoot ?? promptDir)
    : tasks.find(task => task.file)?.file || 'project';

  return [{
    id: 't1',
    file: targetFile,
    action: 'analyze',
    desc: '分析需求、现有实现和主控职责，输出对策检讨与任务建议',
    visibleTarget: targetFile,
    ...(targetAbs ? { absPath: targetAbs } : {}),
  }];
}

function normalizeMarkdownDocumentDeliverableTasks(
  tasks: AgentTask[],
  userPrompt: string | undefined,
  promptDir: string | undefined,
  activeEditorFile?: string,
): AgentTask[] {
  if (!userPrompt || !isMarkdownDocumentDeliverableRequest(userPrompt)) return tasks;

  const explicitSingleOutput = selectExplicitMarkdownDocumentOutputPath(userPrompt);
  const structuredSpecs = explicitSingleOutput ? [] : detectStructuredMarkdownDocumentSpecs(userPrompt);
  if (!isMarkdownDocumentOnlyDeliverableRequest(userPrompt)) {
    const existingMarkdownTasks = tasks.filter(isMarkdownDocumentCreateTask);
    if (existingMarkdownTasks.length > 0) return tasks;
    return [buildMarkdownDocumentCreateTask(tasks, userPrompt, promptDir, activeEditorFile), ...tasks];
  }

  if (structuredSpecs.length > 1) {
    const outputDir = selectMarkdownDocumentOutputDir(tasks, userPrompt, promptDir, activeEditorFile);
    if (outputDir) {
      return structuredSpecs.map((spec, index) => {
        const outputAbs = uniqueMarkdownDocumentPath(outputDir, spec.filename);
        const outputFile = taskDisplayPathForAbs(outputAbs, promptDir);
        return {
          id: `t${index + 1}`,
          file: outputFile,
          action: 'create' as AgentTaskAction,
          desc: spec.desc,
          visibleTarget: outputFile,
          absPath: outputAbs,
        };
      });
    }
  }

  const documentTask = tasks.find(isMarkdownDocumentCreateTask)
    ?? buildMarkdownDocumentCreateTask(tasks, userPrompt, promptDir, activeEditorFile);

  return [{
    ...documentTask,
    id: 't1',
    action: 'create' as AgentTaskAction,
    desc: documentTask.desc || MARKDOWN_DOCUMENT_DELIVERABLE_TASK_DESC,
  }];
}

function buildMarkdownDocumentCreateTask(
  tasks: AgentTask[],
  userPrompt: string,
  promptDir: string | undefined,
  activeEditorFile?: string,
): AgentTask {
  const outputAbs = selectMarkdownDocumentOutputPath(tasks, userPrompt, promptDir, activeEditorFile);
  const outputFile = outputAbs
    ? taskDisplayPathForAbs(outputAbs, promptDir)
    : markdownDocumentFilenameForPrompt(userPrompt);
  return {
    id: 't1',
    file: outputFile,
    action: 'create',
    desc: MARKDOWN_DOCUMENT_DELIVERABLE_TASK_DESC,
    visibleTarget: outputFile,
    ...(outputAbs ? { absPath: outputAbs } : {}),
  };
}

interface MarkdownDocumentSpec {
  filename: string;
  desc: string;
}

function detectStructuredMarkdownDocumentSpecs(userPrompt: string | undefined): MarkdownDocumentSpec[] {
  const text = String(userPrompt || '').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const wantsSeparateDocuments = /(?:分别|分开|各自|多个|每个|逐个|文档编号|编号).{0,24}(?:md|markdown|文档|报告|文件)|(?:md|markdown|文档|报告|文件).{0,24}(?:分别|分开|各自|多个|每个|逐个|编号)/i.test(text);
  if (!wantsSeparateDocuments) return [];

  const topics = extractStructuredMarkdownTopics(text);
  if (topics.length < 2) return [];

  const used = new Set<string>();
  return topics.map((topic, index) => {
    const filename = uniqueStructuredMarkdownFilename(topic, index + 1, text, used);
    return {
      filename,
      desc: `编写${topic} Markdown 文档，结合用户提供的需求、接口和代码证据进行分析，输出设计建议、任务拆分、风险验证和文档编号`,
    };
  });
}

function extractStructuredMarkdownTopics(text: string): string[] {
  const markerMatch = text.match(/(?:并)?(?:分别|分开|各自|逐个|每个).{0,24}(?:做成|生成|输出|写成|保存为|产出|提供)?.{0,16}(?:md|markdown|文档|报告|文件)/i);
  if (!markerMatch || markerMatch.index === undefined) return [];

  const beforeMarker = text.slice(0, markerMatch.index).trim();
  const start = Math.max(
    beforeMarker.lastIndexOf('进行'),
    beforeMarker.lastIndexOf('输出'),
    beforeMarker.lastIndexOf('生成'),
    beforeMarker.lastIndexOf('编写'),
    beforeMarker.lastIndexOf('提供'),
  );
  const topicText = (start >= 0 ? beforeMarker.slice(start + 2) : beforeMarker)
    .replace(/\/[^\s"'`<>，。；;：:]+/g, ' ')
    .replace(/(?:基于|参考|和|与)?\s*(?:需求|接口文档|平台接口文档|代码|模块|方式)[:：]?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let topics = topicText
    .split(/[，,；;、]+/)
    .map(cleanStructuredMarkdownTopic)
    .filter(isUsefulStructuredMarkdownTopic);

  if (topics.length < 2 && /(?:分别|各自|每个|逐个)/.test(text)) {
    topics = topicText
      .split(/(?:\s+和\s+|\s+与\s+|以及|及)/)
      .map(cleanStructuredMarkdownTopic)
      .filter(isUsefulStructuredMarkdownTopic);
  }

  return uniqueTextItems(topics).slice(0, 6);
}

function cleanStructuredMarkdownTopic(value: string): string {
  return value
    .replace(/^(?:并|和|与|及|以及|然后|同时|则|对|将|把|给|做|为|成)+/g, '')
    .replace(/(?:并|和|与|及|以及|然后|同时|则)+/g, match => (match === '则' ? '' : match))
    .replace(/(?:放置|放到|放在|保存|输出|写入|生成).{0,40}$/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function isUsefulStructuredMarkdownTopic(value: string): boolean {
  if (value.length < 4 || value.length > 60) return false;
  return /(?:设计|方案|接口|交互|协议|逻辑|实现|任务|清单|对策|报告|分析|规划|验证|测试|架构|流程)/.test(value);
}

function uniqueStructuredMarkdownFilename(topic: string, index: number, userPrompt: string, used: Set<string>): string {
  const domain = /(?:维保|过保|保修|maintenance|warranty)/i.test(userPrompt)
    ? 'warranty'
    : /(?:重构|refactor)/i.test(userPrompt)
      ? 'refactor'
      : 'devseek';
  const baseSlug = structuredMarkdownTopicSlug(topic);
  let filename = `${String(index).padStart(2, '0')}-${domain}-${baseSlug}.md`;
  let suffix = 1;
  while (used.has(filename)) {
    suffix += 1;
    filename = `${String(index).padStart(2, '0')}-${domain}-${baseSlug}-${suffix}.md`;
  }
  used.add(filename);
  return filename;
}

function structuredMarkdownTopicSlug(topic: string): string {
  const hasRemote = /(?:遥控器|遥控|remote|controller)/i.test(topic);
  const hasMainControl = /(?:主控|飞控|main\s*control|controller)/i.test(topic);
  if (hasRemote && /(?:接口|交互|协议|平台|json|通信|通讯|api)/i.test(topic)) return 'remote-controller-interface-design';
  if (hasMainControl && /(?:逻辑|实现|线程|统计|状态机|持久化|计算)/i.test(topic)) return 'main-control-logic-design';
  if (/(?:接口|交互|协议|api|json|通信|通讯)/i.test(topic)) return 'interface-design';
  if (/(?:逻辑|实现|线程|状态机|持久化|计算)/i.test(topic)) return 'logic-design';
  if (/(?:任务|task|清单|拆分)/i.test(topic)) return 'task-breakdown';
  if (/(?:验证|测试|验收)/i.test(topic)) return 'verification-plan';
  if (/(?:架构|architecture)/i.test(topic)) return 'architecture-design';
  return 'analysis-design';
}

function uniqueTextItems(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function selectMarkdownDocumentOutputPath(
  tasks: AgentTask[],
  userPrompt: string,
  promptDir: string | undefined,
  activeEditorFile?: string,
): string | undefined {
  const explicitOutput = selectExplicitMarkdownDocumentOutputPath(userPrompt);
  if (explicitOutput) return explicitOutput;

  const filename = markdownDocumentFilenameForPrompt(userPrompt);
  const outputDir = selectMarkdownDocumentOutputDir(tasks, userPrompt, promptDir, activeEditorFile);
  if (!outputDir) return undefined;
  return uniqueMarkdownDocumentPath(outputDir, filename);
}

function selectMarkdownDocumentOutputDir(
  tasks: AgentTask[],
  userPrompt: string,
  promptDir: string | undefined,
  activeEditorFile?: string,
): string | undefined {
  const explicitDir = selectExplicitMarkdownDocumentOutputDir(userPrompt);
  if (explicitDir) return explicitDir;

  const candidateDirs = [
    ...extractPromptMarkdownDocumentDirs(userPrompt),
    activeEditorFile && isMarkdownDocumentPathLike(activeEditorFile) ? nodePath.dirname(activeEditorFile) : undefined,
    ...tasks.map(task => task.absPath).filter((value): value is string => Boolean(value)).map(absPath => {
      if (isMarkdownDocumentPathLike(absPath)) return nodePath.dirname(absPath);
      try {
        if (fs.existsSync(absPath) && fs.statSync(absPath).isDirectory()) return absPath;
      } catch {
        // Fall through to dirname.
      }
      return nodePath.dirname(absPath);
    }),
    promptDir,
  ].filter((value): value is string => Boolean(value));

  const outputDir = candidateDirs.find(dir => !promptDir || isInsideDir(dir, promptDir)) ?? candidateDirs[0];
  return outputDir;
}

function selectExplicitMarkdownDocumentOutputPath(userPrompt: string | undefined): string | undefined {
  const text = String(userPrompt || '');
  if (!text) return undefined;

  const pathPattern = '(/[^\\s"\\\'`<>，。；;：:]+?\\.(?:md|markdown)\\b)';
  const outputBeforePath = new RegExp(
    `(?:输出|保存|生成|写入|写出|创建|新建|落盘|产出)(?:[^\\r\\n]{0,48}?)(?:到|至|为|成|在)?\\s*${pathPattern}`,
    'gi',
  );
  const pathBeforeOutput = new RegExp(
    `${pathPattern}(?:[^\\r\\n]{0,48}?)(?:作为|用作|用于)(?:[^\\r\\n]{0,24}?)(?:输出|交付|结果|报告|建议文档)`,
    'gi',
  );

  for (const re of [outputBeforePath, pathBeforeOutput]) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const absPath = normalizePromptMarkdownPath(match[1]);
      if (!absPath || !nodePath.isAbsolute(absPath)) continue;
      return uniqueMarkdownDocumentPath(nodePath.dirname(absPath), nodePath.basename(absPath));
    }
  }
  return undefined;
}

function selectExplicitMarkdownDocumentOutputDir(userPrompt: string | undefined): string | undefined {
  const text = String(userPrompt || '');
  if (!text) return undefined;

  const pathPattern = '(/(?:[A-Za-z0-9._@%+=-]+/)*[A-Za-z0-9._@%+=-]+)';
  const outputBeforePath = new RegExp(
    `(?:输出|保存|生成|写入|写出|创建|新建|落盘|产出|放置|放到|放在)(?:[^\\r\\n]{0,64}?)(?:到|至|为|成|在)?\\s*${pathPattern}(?:\\s*(?:目录|文件夹)?(?:下|下面|中|里)?)?`,
    'gi',
  );
  const pathBeforeDirectory = new RegExp(
    `${pathPattern}(?:\\s*(?:目录|文件夹)(?:下|下面|中|里)?|(?:[^\\r\\n]{0,32}?)(?:保存|输出|放置|放到|放在|写入|生成))`,
    'gi',
  );

  for (const re of [outputBeforePath, pathBeforeDirectory]) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const dir = coerceMarkdownOutputDir(normalizePromptDirectoryPath(match[1]));
      if (dir) return uniqueExistingOrRequestedDir(dir);
    }
  }
  return undefined;
}

function normalizePromptDirectoryPath(value: string | undefined): string {
  return String(value || '')
    .replace(/[)\]}>，。；;：:,.]+$/g, '')
    .replace(/\/+$/g, '')
    .trim();
}

function coerceMarkdownOutputDir(absPath: string): string | undefined {
  if (!absPath || !nodePath.isAbsolute(absPath)) return undefined;
  if (isMarkdownDocumentPathLike(absPath)) return nodePath.dirname(absPath);
  try {
    if (fs.existsSync(absPath) && fs.statSync(absPath).isDirectory()) return absPath;
  } catch {
    // Fall through to docs-directory heuristic.
  }
  if (/\/docs?$/i.test(absPath)) return absPath;
  return undefined;
}

function uniqueExistingOrRequestedDir(dir: string): string {
  return nodePath.normalize(dir);
}

function normalizePromptMarkdownPath(value: string | undefined): string {
  return String(value || '')
    .replace(/[)\]}>，。；;：:,.]+$/g, '')
    .trim();
}

function extractPromptMarkdownDocumentDirs(userPrompt: string | undefined): string[] {
  const text = String(userPrompt || '');
  const dirs: string[] = [];
  const seen = new Set<string>();
  const pathRe = /\/[^\s"'`<>，。；;：:]+?\.(?:md|markdown)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = pathRe.exec(text)) !== null) {
    const absPath = match[0].replace(/[)\]}>，。；;：:,.]+$/g, '');
    if (!nodePath.isAbsolute(absPath)) continue;
    const dir = nodePath.dirname(absPath);
    const key = nodePath.normalize(dir);
    if (seen.has(key)) continue;
    seen.add(key);
    dirs.push(dir);
  }
  return dirs;
}

function uniqueMarkdownDocumentPath(dir: string, filename: string): string {
  const parsed = nodePath.parse(filename);
  let candidate = nodePath.join(dir, filename);
  for (let suffix = 1; suffix <= 50; suffix += 1) {
    if (!fs.existsSync(candidate)) return candidate;
    candidate = nodePath.join(dir, `${parsed.name}-${suffix}${parsed.ext || '.md'}`);
  }
  return candidate;
}

function isMarkdownDocumentPathLike(value: string | undefined): boolean {
  return /\.(?:md|markdown)$/i.test(nodePath.basename(value || ''));
}

function selectReadOnlyPlanningTargetAbs(
  tasks: AgentTask[],
  promptDir: string | undefined,
  activeEditorFile?: string,
): string | undefined {
  if (!promptDir) return tasks.find(task => task.absPath)?.absPath;

  const rels = tasks
    .map(task => {
      const rel = task.absPath && isInsideDir(task.absPath, promptDir)
        ? workspaceRelativePathForAbs(task.absPath, promptDir)
        : task.file || '';
      return stripPromptDirAlias(rel, promptDir);
    })
    .map(rel => rel.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/$/, ''))
    .filter(Boolean);

  const commonDir = longestCommonDirectory(rels);
  if (commonDir && commonDir.split('/').length >= 2) {
    return nodePath.join(promptDir, ...commonDir.split('/'));
  }

  if (activeEditorFile && isInsideDir(activeEditorFile, promptDir)) {
    return activeEditorFile;
  }

  return promptDir;
}

function selectReadOnlyPlanningDisplayRoot(
  promptDir: string | undefined,
  activeEditorFile?: string,
): string | undefined {
  if (!promptDir || !activeEditorFile || !isInsideDir(activeEditorFile, promptDir)) return promptDir;
  const activeRel = workspaceRelativePathForAbs(activeEditorFile, promptDir);
  const firstSegment = activeRel.split('/').filter(Boolean)[0];
  if (!firstSegment || isCommonProjectContentDir(firstSegment)) return promptDir;
  const candidateRoot = nodePath.join(promptDir, firstSegment);
  try {
    if (fs.existsSync(candidateRoot) && fs.statSync(candidateRoot).isDirectory()) return candidateRoot;
  } catch {
    // Fall through to promptDir.
  }
  return promptDir;
}

function isCommonProjectContentDir(segment: string): boolean {
  return /^(?:src|source|include|inc|lib|app|apps|packages|docs?|test|tests|tools?|scripts?)$/i.test(segment);
}

function longestCommonDirectory(relPaths: string[]): string | undefined {
  const dirs = relPaths
    .map(rel => rel.split('/').filter(Boolean))
    .filter(parts => parts.length > 0)
    .map(parts => (parts.length > 1 && /\.[A-Za-z0-9]+$/.test(parts[parts.length - 1]) ? parts.slice(0, -1) : parts));
  if (dirs.length === 0) return undefined;

  const common: string[] = [];
  for (let index = 0; ; index += 1) {
    const value = dirs[0][index];
    if (!value || !dirs.every(parts => parts[index] === value)) break;
    common.push(value);
  }
  return common.join('/') || undefined;
}

function normalizeValidationExecutionTargets(tasks: AgentTask[]): AgentTask[] {
  const workspaceRoots = (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath);
  if (workspaceRoots.length === 0) return tasks;
  return tasks.map((task) => {
    if (!isValidationTask(task)) return task;
    const projectDir = resolveLocalExecutionProjectDirFromCandidate(task.absPath ?? task.file, workspaceRoots);
    if (!projectDir) return task;
    return {
      ...task,
      file: workspaceRelativePathForAbs(projectDir),
      absPath: projectDir,
    };
  });
}

function isGeneratedOrBuildArtifactPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  const segments = normalized.split('/').filter(Boolean);
  return segments.some(segment => isCppBuildArtifactDirName(segment))
    || /(?:^|\/)(?:dist|node_modules|media)(?:\/|$)/.test(normalized)
    || /(?:^|\/)(?:cmakecache\.txt|cmake_install\.cmake|makefile)$/.test(normalized);
}

function primaryCodeFileScore(filePath: string): number {
  const base = nodePath.basename(filePath).toLowerCase();
  if (/^main\.(?:c|cc|cpp|cxx|ts|tsx|js|jsx|py|go|rs|java)$/.test(base)) return 100;
  if (/^app\.(?:ts|tsx|js|jsx|py)$/.test(base)) return 90;
  if (/^index\.(?:ts|tsx|js|jsx|html)$/.test(base)) return 85;
  if (/^(?:renderer|view|viewer|controller)\.(?:c|cc|cpp|cxx|ts|tsx|js|jsx|py)$/.test(base)) return 75;
  if (isCodeArtifactPath(filePath)) return 50;
  return 0;
}

function selectPrimaryCodePath(paths: string[], projectDir?: string): string | undefined {
  const candidates = paths
    .filter(pathValue => isCodeArtifactPath(pathValue))
    .filter(pathValue => !isGeneratedOrBuildArtifactPath(pathValue))
    .filter(pathValue => !projectDir || isInsideDir(pathValue, projectDir));
  return candidates
    .map(pathValue => ({ pathValue, score: primaryCodeFileScore(pathValue) }))
    .sort((a, b) => b.score - a.score || a.pathValue.length - b.pathValue.length)
    [0]?.pathValue;
}

function inferProjectDirFromAttachedFiles(attachedFiles: string[], userPrompt: string): string | undefined {
  const { promptDir } = detectPromptDir(userPrompt, attachedFiles);
  if (promptDir) return promptDir;

  const workspaceRoots = (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath);
  for (const absPath of attachedFiles) {
    const projectDir = resolveLocalExecutionProjectDirFromCandidate(absPath, workspaceRoots);
    if (projectDir) return projectDir;
  }

  const dirs = attachedFiles
    .filter(absPath => !isGeneratedOrBuildArtifactPath(absPath))
    .map(absPath => {
      try {
        return fs.existsSync(absPath) && fs.statSync(absPath).isDirectory()
          ? absPath
          : nodePath.dirname(absPath);
      } catch {
        return nodePath.dirname(absPath);
      }
    });
  if (dirs.length === 0) return undefined;
  const counts = new Map<string, number>();
  dirs.forEach(dir => counts.set(dir, (counts.get(dir) ?? 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]?.[0];
}

function collapseReadOnlyPlanningNoiseForEdit(tasks: AgentTask[], userPrompt?: string): AgentTask[] {
  if (!userPrompt || !requiresCodeArtifactForEvidence(userPrompt)) return tasks;
  if (tasks.some(isWriteTask)) return tasks;

  const validationTasks = tasks.filter(isValidationTask);
  const readOnlyCodeTasks = tasks.filter(task =>
    (task.action === 'analyze' || task.action === 'explain' || task.action === 'explore') &&
    taskTargetsCodeFile(task),
  );
  if (readOnlyCodeTasks.length < 6) return tasks;

  const primaryPath = selectPrimaryCodePath(readOnlyCodeTasks.map(task => task.absPath ?? task.file));
  const primaryTask = readOnlyCodeTasks.find(task => (task.absPath ?? task.file) === primaryPath) ?? readOnlyCodeTasks[0];
  const normalizedPrimary: AgentTask = {
    ...primaryTask,
    action: 'modify',
    desc: `根据用户需求修改 ${nodePath.basename(primaryTask.file)}`,
  };

  return [normalizedPrimary, ...validationTasks];
}

function normalizeExplicitEditTasks(tasks: AgentTask[], userPrompt?: string): AgentTask[] {
  if (!userPrompt || !requiresCodeArtifactForEvidence(userPrompt)) return tasks;

  const writeTasks = tasks.filter(isWriteTask);
  if (writeTasks.length > 0) {
    return tasks.filter(t => isWriteTask(t) || isValidationTask(t) || isImplementationContextTask(t));
  }

  let converted = false;
  const normalized = tasks.map((task) => {
    if (!taskTargetsCodeFile(task)) return task;
    converted = true;
    return {
      ...task,
      action: 'modify' as AgentTaskAction,
      desc: task.desc && /修复|修改|改进|fix|modify|repair/i.test(task.desc)
        ? task.desc
        : `${task.desc || '读取当前内容'}，并修复明确问题`,
    };
  });

  return converted
    ? normalized.filter(t => isWriteTask(t) || isValidationTask(t))
    : tasks;
}

/**
 * Repair JSON that contains unescaped double-quotes inside string values.
 * LLMs sometimes emit  "desc": "...like "Hello!""  instead of  \"Hello!\" .
 * Strategy: walk char by char; when inside a string and we see ", check if the
 * next non-whitespace token is a structural character (:  ,  }  ]).  If not,
 * the " is an internal unescaped quote — escape it.
 */
function repairJsonUnescapedQuotes(s: string): string {
  let out = '';
  let inStr = false;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    // Preserve existing escape sequences inside strings
    if (ch === '\\' && inStr) {
      out += ch + (s[i + 1] ?? '');
      i += 2;
      continue;
    }
    if (ch !== '"') {
      out += ch;
      i++;
      continue;
    }
    // ch === '"'
    if (!inStr) {
      inStr = true;
      out += ch;
      i++;
    } else {
      // Peek at the next non-whitespace character to decide if this is a closing quote
      let j = i + 1;
      while (j < s.length && (s[j] === ' ' || s[j] === '\t' || s[j] === '\r' || s[j] === '\n')) j++;
      const nc = j < s.length ? s[j] : '';
      if (nc === ':' || nc === ',' || nc === '}' || nc === ']' || nc === '') {
        // Structural token follows → legitimate closing quote
        inStr = false;
        out += ch;
        i++;
      } else {
        // Non-structural token follows → internal unescaped quote
        out += '\\"';
        i++;
      }
    }
  }
  return out;
}

/** Extract the outermost `{...}` JSON object from `text` using brace-depth counting. */
function extractJsonObject(text: string): string | null {
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      i++;
      while (i < text.length) {
        if (text[i] === '\\') { i++; }
        else if (text[i] === '"') { break; }
        i++;
      }
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function parseTaskPlan(raw: string, attachedFiles: string[], priorFindings?: AnalysisFindings, userPrompt?: string, activeEditorFile?: string): AgentTask[] {
  // Multi-strategy JSON extraction (in order of reliability):
  // 1. Content inside the last ```json...``` fence containing "tasks"
  // 2. Any ```...``` fence block starting with {
  // 3. Brace-depth counting on the full raw text
  // 4. Legacy first-{ / last-} slice as final fallback
  let jsonSlice = '';

  // Strategy 1 & 2: code-fenced block
  const fenceRe = /```(?:json|JSON)?\s*\n([\s\S]*?)\n```/g;
  let fenceMatch: RegExpExecArray | null;
  let lastJsonFence = '';
  let hasTasksFence = '';
  while ((fenceMatch = fenceRe.exec(raw)) !== null) {
    const body = fenceMatch[1].trim();
    if (body.startsWith('{') && body.includes('"tasks"')) {
      hasTasksFence = body;
    } else if (body.startsWith('{')) {
      lastJsonFence = body;
    }
  }
  if (hasTasksFence) {
    jsonSlice = hasTasksFence;
  } else if (lastJsonFence) {
    jsonSlice = lastJsonFence;
  }

  // Strategy 3: brace-depth counting (works even without code fences)
  if (!jsonSlice) {
    jsonSlice = extractJsonObject(raw) ?? '';
  }

  // Strategy 4: legacy first-{ / last-} (original behaviour)
  if (!jsonSlice) {
    const stripped = raw.replace(/^```[^\n]*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
    const s = stripped.indexOf('{');
    const e = stripped.lastIndexOf('}');
    if (s >= 0 && e > s) jsonSlice = stripped.slice(s, e + 1);
  }

  if (!jsonSlice) return [];

  let plan: RawTaskPlan;
  try {
    plan = JSON.parse(jsonSlice) as RawTaskPlan;
  } catch {
    // Retry after repairing unescaped quotes (e.g. LLM wrote "Hello!" inside a string)
    try {
      plan = JSON.parse(repairJsonUnescapedQuotes(jsonSlice)) as RawTaskPlan;
    } catch {
      return [];
    }
  }

  if (!Array.isArray(plan.tasks)) return [];

  // ── Derive working directory anchor via shared helper ────────────────────
  // detectPromptDir() runs the same 4-priority detection as buildDecomposeSystemPrompt
  // (which already injected the result into the system prompt so the AI outputs full paths).
  // Here we use it a second time for: path lookup filtering + confine block.
  const { promptDir, promptDirIsExplicit } = detectPromptDir(userPrompt, attachedFiles, activeEditorFile);

  const exactPathMap = new Map<string, string>();
  const basenameBuckets = new Map<string, string[]>();
  const addPathLookup = (absPath: string) => {
    if (promptDir && promptDirIsExplicit && !isInsideDir(absPath, promptDir)) return;
    const rel = workspaceRelativePathForAbs(absPath, promptDir);
    exactPathMap.set(normalizePlanPathKey(rel), absPath);
    const baseKey = nodePath.basename(absPath).toLowerCase();
    const bucket = basenameBuckets.get(baseKey) ?? [];
    bucket.push(absPath);
    basenameBuckets.set(baseKey, bucket);
  };

  for (const absPath of attachedFiles) {
    addPathLookup(absPath);
  }
  // Also inject recently-changed paths from prior session so follow-up requests
  // ("rewrite the program", "add a feature") resolve to the same directory instead
  // of falling back to a different file with the same basename (e.g. src/main.cpp).
  if (priorFindings?.recentlyChangedPaths) {
    for (const relPath of priorFindings.recentlyChangedPaths) {
      for (const folder of vscode.workspace.workspaceFolders ?? []) {
        const abs = nodePath.join(folder.uri.fsPath, ...relPath.split('/'));
        // Only add existing recent files. Explicit attachments keep priority because
        // exactPathMap is path-keyed and basename lookup below only accepts unique names.
        if (fs.existsSync(abs)) {
          addPathLookup(abs);
        }
      }
    }
  }

  const basenameMap = new Map<string, string>();
  for (const [key, bucket] of basenameBuckets.entries()) {
    const unique = [...new Set(bucket.map(p => nodePath.resolve(p)))];
    if (unique.length === 1) {
      basenameMap.set(key, unique[0]);
    }
  }

  const tasks: AgentTask[] = [];
  let seq = 1;
  for (const raw of plan.tasks) {
    const rawFile = (raw.file || '').trim();
    const desc = (raw.desc || '').trim();
    if (!rawFile) continue;

    // Normalize file path: strip SEARCH/REPLACE segments or other LLM formatting artifacts.
    // The LLM sometimes outputs "SEARCH/REPLACE/filename.hpp" or prefixes the path with
    // fake tool names like "list_dir/read_file/grep_search/run_terminal/filename.c";
    // strip all such noise segments, keeping only the real path parts.
    const FAKE_TOOL_SEGS = new Set(['list_dir', 'read_file', 'grep_search', 'run_terminal',
      'get_errors', 'manage_todo_list', 'task_complete']);
    let file = rawFile.replace(/\\/g, '/').replace(/^\.\//,  '');
    const fileParts = file.split('/');
    const cleanParts = fileParts.filter(
      (seg) => seg !== 'SEARCH' && seg !== 'REPLACE' && seg !== '<<<<<<' && seg !== '=======' &&
               seg !== '>>>>>>>' && !FAKE_TOOL_SEGS.has(seg),
    );
    file = cleanParts.length > 0 ? cleanParts.join('/') : nodePath.basename(file);

    const id = (raw.id || `t${seq}`).replace(/\s+/g, '-');
    const rawActionStr = (raw.action || 'modify').toLowerCase();
    const action = (VALID_ACTIONS.has(rawActionStr) ? rawActionStr : 'modify') as AgentTaskAction;
    // Primary lookup: exact attached/recent path, then unique basename in the scoped workset.
    let absPath = exactPathMap.get(normalizePlanPathKey(file))
      ?? basenameMap.get(nodePath.basename(file).toLowerCase());
    // If AI output an absolute path directly, use it as-is and normalise to workspace-relative.
    if (!absPath && nodePath.isAbsolute(file)) {
      if (fs.existsSync(file)) {
        absPath = file;
        // Derive workspace-relative path for task.file display
        file = workspaceRelativePathForAbs(file, promptDir);
      }
    }
    // Fallback: search all open workspace folders so tasks still resolve even when
    // the target file was not explicitly attached (e.g. inherited context cleared).
    if (!absPath) {
      for (const folder of vscode.workspace.workspaceFolders ?? []) {
        const candidate = nodePath.join(folder.uri.fsPath, ...file.split('/'));
        if (fs.existsSync(candidate)) { absPath = candidate; break; }
        // For 'create' tasks, skip the bare-basename fallback: a create task for
        // "README.md" or "main.py" must NOT accidentally target an existing file
        // with the same name at the workspace root or in a different directory.
        // The byName shortcut is only safe for modify/analyze tasks where the file
        // is known to already exist and the AI is editing a pre-existing file.
        if (action === 'create') continue;
        const byName = nodePath.join(folder.uri.fsPath, nodePath.basename(file));
        if (fs.existsSync(byName)) { absPath = byName; break; }
      }
    }

    if (absPath) {
      file = workspaceRelativePathForAbs(absPath, promptDir);
    }

    tasks.push({ id, file, action, desc, absPath });
    seq += 1;
  }

  // Merge tasks that target the same file with the SAME action: combine descs.
  // The LLM sometimes emits multiple entries for the same file; running them
  // separately causes duplicate writes and path-drift issues.
  // Do NOT merge tasks with different actions (e.g. create + analyze must stay
  // separate — create writes the file, analyze compiles/runs it).
  const mergedMap = new Map<string, AgentTask>();
  for (const task of tasks) {
    const fileKey = task.absPath ?? nodePath.basename(task.file).toLowerCase();
    const key = `${fileKey}::${task.action}`;  // include action so create≠analyze
    const existing = mergedMap.get(key);
    if (existing) {
      existing.desc = existing.desc + '；' + task.desc;
    } else {
      mergedMap.set(key, { ...task });
    }
  }

  let finalTasks = [...mergedMap.values()];
  finalTasks = normalizeReadOnlyPlanTasks(finalTasks, userPrompt, promptDir, activeEditorFile);
  finalTasks = normalizeMarkdownDocumentDeliverableTasks(finalTasks, userPrompt, promptDir, activeEditorFile);
  finalTasks = collapseReadOnlyPlanningNoiseForEdit(finalTasks, userPrompt);
  finalTasks = normalizeExplicitEditTasks(finalTasks, userPrompt);
  finalTasks = normalizeValidationExecutionTargets(finalTasks);

  // ── Confine tasks to promptDir ───────────────────────────────────────────
  // When promptDir is EXPLICIT (user-specified): redirect ALL tasks outside promptDir.
  // When promptDir is INFERRED (active editor / attached file heuristic):
  //   - redirect CREATE tasks and unresolved tasks (absPath undefined)
  //   - do NOT redirect already-resolved modify/analyze tasks (respect found location)
  // This prevents over-aggressive confinement when the user has attached files from
  // outside the current project (e.g. a monorepo-level docs/requirements.md).
  if (promptDir) {
    for (const task of finalTasks) {
      if (task.absPath && isInsideDir(task.absPath, promptDir)) {
        task.file = task.visibleTarget || taskDisplayPathForAbs(task.absPath, promptDir);
        continue;
      }

      // For inferred promptDir: skip redirect when the file was already resolved and
      // the task is not a create (modify/analyze of an existing file → keep its location).
      if (!promptDirIsExplicit && task.absPath !== undefined && task.action !== 'create') continue;
      const resolved = resolveTaskInsidePromptDir(task.file, promptDir);
      task.absPath = resolved.absPath;
      task.file = resolved.relPath;
    }
  }

  // ── Sibling-dir fallback for bare-name create tasks when no promptDir ─────
  if (!promptDir) {
    const sessionDirs = finalTasks
      .filter(t => t.absPath && t.action !== 'create')
      .map(t => nodePath.dirname(t.absPath!));
    if (sessionDirs.length > 0) {
      const dirCounts = new Map<string, number>();
      sessionDirs.forEach(d => dirCounts.set(d, (dirCounts.get(d) ?? 0) + 1));
      const sessionDir = [...dirCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      for (const task of finalTasks) {
        if (task.action === 'create' && !task.absPath && !task.file.includes('/')) {
          task.absPath = nodePath.join(sessionDir, task.file);
          task.file = taskDisplayPathForAbs(task.absPath, sessionDir);
        }
      }
    }
  }

  return finalTasks;
}

// ----------------------------------------------------------------
// Fallback: infer tasks directly from attached files without LLM
// ----------------------------------------------------------------

export function inferTasksFromFiles(
  attachedFiles: string[],
  userPrompt: string,
): AgentTask[] {
  if (attachedFiles.length === 0) return [];

  const intent = classifyIntent(userPrompt);
  const projectDir = inferProjectDirFromAttachedFiles(attachedFiles, userPrompt);
  const primaryCodePath = selectPrimaryCodePath(attachedFiles, projectDir);
  const wantsCodeChange = intent.mode === 'edit' || requiresCodeArtifactForEvidence(userPrompt);
  const wantsCommandEvidence = intent.mode === 'run' || requiresCommandEvidence(userPrompt);
  const targetPath = wantsCodeChange && primaryCodePath
    ? primaryCodePath
    : projectDir ?? primaryCodePath ?? attachedFiles.find(pathValue => !isGeneratedOrBuildArtifactPath(pathValue)) ?? attachedFiles[0];
  const targetRel = workspaceRelativePathForAbs(targetPath);
  const targetIsFile = (() => {
    try {
      return fs.existsSync(targetPath) && fs.statSync(targetPath).isFile();
    } catch {
      return isCodeArtifactPath(targetPath);
    }
  })();

  let action: AgentTaskAction = 'analyze';
  if (wantsCodeChange && targetIsFile) action = 'modify';
  else if (wantsCodeChange) action = 'explore';

  const targetName = nodePath.basename(targetRel);
  const desc = wantsCodeChange
    ? targetIsFile
      ? `根据用户需求修改 ${targetName}`
      : '探索项目并根据用户需求修改相关代码'
    : wantsCommandEvidence
      ? '执行项目验证并给出结果'
      : '分析项目上下文并回答用户问题';

  return [{
    id: 't1',
    file: targetRel,
    action,
    desc,
    absPath: targetPath,
  }];
}

// ----------------------------------------------------------------
// Main entry
// ----------------------------------------------------------------

export async function decomposeTask(
  userPrompt: string,
  attachedFiles: string[],
  mode: 'fast' | 'r1' | undefined,
  onProgress: (text: string) => void,
  priorFindings?: AnalysisFindings,
  chatFn?: (prompt: string, mode?: 'fast' | 'r1') => Promise<string>,
  activeEditorFile?: string,
): Promise<DecomposeResult> {
  onProgress(attachedFiles.length > 0 ? `正在分析任务（共 ${attachedFiles.length} 个文件）…` : '正在分析任务…');
  const contextActiveEditorFile = sanitizeActiveEditorContextPath(activeEditorFile);

  if (shouldUseLocalMarkdownDocumentFastPath(userPrompt)) {
    const tasks = buildLocalMarkdownDocumentDeliverableTasks(userPrompt, attachedFiles, contextActiveEditorFile);
    const documentTaskCount = tasks.filter(isMarkdownDocumentCreateTask).length;
    onProgress(documentTaskCount > 1
      ? `已识别 Markdown 文档交付物，生成 ${documentTaskCount} 个文档创建任务…`
      : '已识别 Markdown 文档交付物，生成单一文档创建任务…');
    return {
      tasks,
      raw: JSON.stringify({ tasks }),
      ok: true,
      prose: '已识别用户要求通过 Markdown 文档交付结果，规划阶段跳过大上下文模型调用；读取需求和旧实现将作为文档创建任务内部证据采集完成。',
    };
  }

  // Pass abs paths so the planner can include bounded context previews.
  const systemPrompt = buildDecomposeSystemPrompt(userPrompt, attachedFiles, priorFindings, contextActiveEditorFile);

  let raw = '';
  try {
    raw = chatFn
      ? await chatFn(systemPrompt, mode)
      : await chat({
          prompt: systemPrompt,
          newSession: true,
          mode,
          stream: false,
        });
  } catch (e) {
    const error = (e as Error).message;
    return { tasks: [], raw: '', ok: false, error, fallbackAllowed: false };
  }

  const tasks = parseTaskPlan(raw, attachedFiles, priorFindings, userPrompt, contextActiveEditorFile);
  if (tasks.length === 0) {
    // Fallback: derive tasks directly from file list
    const fallback = inferTasksFromFiles(attachedFiles, userPrompt);
    return { tasks: fallback, raw, ok: false, fallbackAllowed: true, error: 'JSON plan parse failed, using fallback' };
  }

  // Extract pre-JSON reasoning prose so the working area can show what the AI was thinking
  const proseLines = (() => {
    const jsonIdx = raw.search(/```json|```JSON/i);
    const before = jsonIdx > 0 ? raw.slice(0, jsonIdx) : '';
    return before
      .replace(/```[\s\S]*?```/g, '')
      .split('\n')
      .map(l => l.replace(/^#+\s*/, '').trim())
      .filter(l => l.length > 2 && !/^---/.test(l))
      .slice(0, 8);
  })();

  return { tasks, raw, ok: true, prose: proseLines.length > 0 ? proseLines.join('\n') : undefined };
}

function shouldUseLocalMarkdownDocumentFastPath(userPrompt: string): boolean {
  return isMarkdownDocumentOnlyDeliverableRequest(userPrompt);
}

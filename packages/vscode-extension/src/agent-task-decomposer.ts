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
 */
export type AgentTaskAction = 'modify' | 'analyze' | 'create' | 'delete' | 'explain' | 'explore';

// ----------------------------------------------------------------
// File reading utility — exported for use in agent-loop.ts
// ----------------------------------------------------------------

const READ_MAX_LINES = 400;

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
  /** Workspace-relative path of the target file */
  file: string;
  /** What to do with this file */
  action: AgentTaskAction;
  /** Human-readable short description (shown in Working area) */
  desc: string;
  /** Original absolute path as provided by the user attachment */
  absPath?: string;
}

export interface DecomposeResult {
  tasks: AgentTask[];
  /** Raw DeepSeek response text (for debugging / fallback) */
  raw: string;
  /** Whether the JSON plan was successfully parsed */
  ok: boolean;
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
  let promptDir: string | undefined;
  let promptDirIsExplicit = false;

  if (userPrompt) {
    // 1. Labelled patterns:  指定路径：/path  |  在/path  |  到/path
    // \s* (not \s+) allows "都在/abs/path" (zero spaces before path)
    const labeledRe = /(?:指定\s*)?(?:路径|目录|工作目录|dir)[：:]\s*([^\s，。！？\n`'"]+)|(?:在|到|into|in|under|at|放到|创建到)\s*`?([^\s，。！？\n`'"]+)`?/gi;
    let m: RegExpExecArray | null;
    while ((m = labeledRe.exec(userPrompt)) !== null) {
      const candidate = (m[1] || m[2] || '').trim().replace(/[，。！？：；]+$/, '');
      if (!candidate) continue;
      const expanded = candidate.startsWith('~') ? candidate.replace(/^~/, process.env.HOME ?? '') : candidate;
      try {
        if (nodePath.isAbsolute(expanded)) {
          const stat = fs.existsSync(expanded) ? fs.statSync(expanded) : null;
          promptDir = stat?.isDirectory() ? expanded : (fs.existsSync(nodePath.dirname(expanded)) ? expanded : undefined);
          if (promptDir) { promptDirIsExplicit = true; break; }
        }
      } catch { /* ignore */ }
    }
    // 2. Bare absolute path anywhere in prompt (e.g. pasted path)
    // Prefix class includes CJK so "都在/path" and "在/abs/path" are matched
    if (!promptDir) {
      const bareAbsRe = /(?:^|[\s，。！？：；`'"\u4e00-\u9fff\u3000-\u303f])(\/([\w.~-]+\/)+[\w.~-]*)/g;
      while ((m = bareAbsRe.exec(userPrompt)) !== null) {
        const candidate = m[1].trim().replace(/[，。！？：；]+$/, '');
        try {
          if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
            promptDir = candidate; promptDirIsExplicit = true; break;
          }
        } catch { /* ignore */ }
      }
    }
    // 3. Relative paths with slash:  code/3d_demo  or  src/components
    if (!promptDir) {
      const relRe = /(?:在|到|into|in|under|at|路径[：:]|目录[：:])\s*`?([A-Za-z0-9_./-]{2,}\/[A-Za-z0-9_./-]+)`?/i;
      const relM = userPrompt.match(relRe);
      if (relM) {
        const candidate = relM[1].replace(/[，。！？：；]+$/, '');
        for (const wf of vscode.workspace.workspaceFolders ?? []) {
          const abs = nodePath.join(wf.uri.fsPath, candidate);
          if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) { promptDir = abs; promptDirIsExplicit = true; break; }
          const parentAbs = nodePath.join(wf.uri.fsPath, nodePath.dirname(candidate));
          if (fs.existsSync(parentAbs)) { promptDir = abs; promptDirIsExplicit = true; break; }
        }
      }
    }
  }

  // 4. Inferred anchor (Copilot pattern): derive project root from attached files / active editor.
  // Attached files take priority: they represent the canonical project context.
  if (!promptDir) {
    const SRC_LIKE = new Set([
      'src', 'include', 'lib', 'test', 'tests', 'bin', 'cmd', 'app',
      'core', 'utils', 'components', 'views', 'pages', 'models', 'services',
      'source', 'sources', 'headers', 'impl', 'internal', 'common', 'shared',
    ]);
    const wsRoot0 = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (wsRoot0) {
      const anchorFile = attachedFiles.length > 0 ? attachedFiles[0] : activeEditorFile;
      if (anchorFile) {
        let dir = nodePath.dirname(anchorFile);
        while (
          dir !== wsRoot0 &&
          dir.startsWith(wsRoot0 + '/') &&
          SRC_LIKE.has(nodePath.basename(dir).toLowerCase())
        ) {
          dir = nodePath.dirname(dir);
        }
        if (dir !== wsRoot0 && dir.startsWith(wsRoot0 + '/')) {
          promptDir = dir;
          promptDirIsExplicit = false;
        }
      }
    }
  }

  return { promptDir, promptDirIsExplicit };
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
  // Build per-file sections with content inline.
  // Architect only needs 150 lines to plan — full content goes to Editor.
  const fileSections = attachedFiles.map((absPath, i) => {
    const basename = nodePath.basename(absPath);
    const ext = (basename.split('.').pop() ?? '').toLowerCase();
    const langMap: Record<string, string> = {
      cpp: 'cpp', cc: 'cpp', cxx: 'cpp', c: 'c', h: 'c', hpp: 'cpp',
      ts: 'typescript', js: 'javascript', py: 'python',
      json: 'json', md: 'markdown', sh: 'bash',
    };
    const lang = langMap[ext] ?? ext;
    const content = readFileContentSafe(absPath, READ_MAX_LINES);
    if (!content) return `  ${i + 1}. ${basename}  （无法读取内容）`;
    return [
      `  ${i + 1}. **${basename}**`,
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
  const projectMemory = getProjectMemorySync();
  const projectMemorySection = projectMemory ? ['', wrapMemoryAsContext(projectMemory)].join('\n') : '';

  // Active editor context: tell the LLM which project the user is working in
  // so it outputs paths relative to that project, not the monorepo root.
  const activeEditorSection = activeEditorFile
    ? `\n【当前活跃编辑器文件（项目上下文）】\n${activeEditorFile}\n（请确保所有新建/修改文件的路径相对于该文件所在的项目目录，而非 workspace 根目录。）`
    : '';

  const noFilesMode = attachedFiles.length === 0;
  const filesSectionHeader = noFilesMode
    ? '【现有文件列表】\n（无预附着文件。请根据用户需求和以下工具调用规则，自行规划目录结构、文件名和路径。）'
    : '【涉及文件及当前内容】\n' + fileSections;

  const rule4 = noFilesMode
    ? '4. 无预附着文件时，自行推断合理的文件名和相对路径（含目录层级），确保每个任务覆盖一个独立文件。'
    : '4. 每个任务对应一个文件，文件名从上面列表选取。';

  // Compute promptDir once here so it can be injected into the system prompt.
  // This is the same logic used later in parseTaskPlan — extracted to detectPromptDir() to stay in sync.
  const { promptDir: detectedPromptDir } = detectPromptDir(userPrompt, attachedFiles, activeEditorFile);
  // Convert to workspace-relative form for display in the prompt
  const wsRoot0 = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const promptDirRel = (() => {
    if (!detectedPromptDir || !wsRoot0) return undefined;
    const pd = detectedPromptDir.replace(/\\/g, '/').replace(/\/$/, '');
    const wr = wsRoot0.replace(/\\/g, '/').replace(/\/$/, '');
    return pd.startsWith(wr + '/') ? pd.slice(wr.length + 1) : undefined;
  })();
  // Inject target directory constraint so AI outputs full relative paths, not bare filenames.
  // Without this, the AI outputs "main.cpp" instead of "code/3d_demo/main.cpp", forcing
  // the confine block to fix paths after the fact (error-prone when AI uses subdirs).
  const promptDirRule = promptDirRel
    ? `\n【工作目录约束（最高优先级）】\n` +
      `本次任务的目标目录：${promptDirRel}/\n` +
      `file 字段必须写相对于 workspace 根的完整路径。\n` +
      `正确示例：${promptDirRel}/docs/design.md\n` +
      `错误示例：design.md  （只写文件名，禁止）`
    : '';

  // Always inject tool hint — the LLM decides from semantic Q1/Q2/Q3 rules whether to explore first.
  // Keyword-gating this hint was fragile (language-dependent); now the classification rules are
  // semantic and language-agnostic, so we always tell the LLM what tools are available.
  const noFilesToolHint = `
【执行阶段可用工具（Editor 角色通过文本格式调用）】
  [TOOL:list_dir {"path":"code/3d_demo/"}]       — 列出目录内容
  [TOOL:read_file {"path":"src/main.cpp"}]        — 读取文件内容
  [TOOL:grep_search {"pattern":"class","path":"src/"}] — 搜索代码

若需要先理解代码库结构再修改（Q3 答案为"是待修改的目标尚未确定"），生成 action=explore 任务：
  desc 写明要用哪个工具在哪个目录查找什么内容；然后再生成依赖其结果的 modify/create 任务。
`;

  return [
    '你是一个顶级编程智能体的任务规划器（Architect 角色）。',
    '【重要提示】本次任务计划仅针对下方【用户需求】，请严格只为本次请求制定计划，不得纳入任何之前对话中已完成或提及的其他任务。',
    activeEditorSection,
    noFilesMode
      ? '用户提出了一个代码创建/修改需求，无预附着文件。请根据需求自行规划文件列表并给出 JSON 任务计划。'
      : '用户提供了以下文件（含当前内容）和需求，请基于文件实际内容给出 JSON 任务计划。',
    '先用 1-2 句话（中文）简述你的分析思路和计划方向，然后输出 JSON 任务计划。不要输出代码。',
    projectRulesSection,
    projectMemorySection,
    '',
    '【用户需求】',
    userPrompt,
    findingsSection,
    recentFilesSection,
    '',
    filesSectionHeader,
    '',
    promptDirRule,
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
    '  → 用户获得了一份分析报告或解答 → analyze / explain 任务',
    '',
    'Q2: 如果你只阅读文件并输出分析结论，不修改任何文件，用户会满意吗？',
    '  → 不满意（用户期望代码变得更好、功能增加、问题消失）→ 必须生成 modify / create 任务',
    '  → 满意（用户只是想理解代码）→ analyze / explain 任务合适',
    '',
    'Q3: 附件文件是"待修改的目标"，还是"为后续修改提供上下文的参考"？',
    '  → 是待修改目标 → 直接生成针对这些文件的 modify 任务',
    '  → 是参考材料、真正要修改的文件需要先探索 → 先生成 action=explore 任务，再生成 modify/create 任务',
    '',
    '任务规划规则（由上述答案驱动）：',
    '1. 不得把每个附件文件独立生成 analyze 任务——读文件是手段，不是目标，更不是交付物。',
    '   每个附件有 modify/create 任务需求时，直接规划修改任务；需要整体理解时，合并为 1 个 explore 任务。',
    '2. 需要理解代码后再修改：生成 1 个整体性 explore 任务 + 若干针对性 modify/create 任务（只列真正需要改的文件）。',
    '3. 纯信息需求（Q2 答案为"满意"，无代码变更期望）：生成 1 个总体 analyze/explain 任务，不逐文件拆分。',
    '4. 需要执行命令（编译/运行/测试）：action=analyze，desc 中明确写"使用 run_terminal 工具执行 <具体命令>"。',
    '   有代码创建 + 执行两个意图时：先生成 create 任务，再生成执行用的 analyze 任务。',
    '5. 需要先探索再修改（真正修改的文件未知）：先 action=explore 任务，再依赖其结果的 modify/create 任务。',
    rule4,
    '7. desc 要具体：写出哪个函数/类/逻辑需要改，而非泛称"修改文件"。',
    '   示例好：\"修复 pump_adjust.cpp 第52行 nullptr 解引用\"',
    '   示例差：\"修改 pump_adjust.cpp\"',
    '8. 在 JSON 之前只输出 1-2 句简短的思路说明，JSON 之后不要补充任何内容。',
  ].join('\n');
}

// ----------------------------------------------------------------
// JSON plan parser
// ----------------------------------------------------------------

interface RawTaskPlan {
  tasks?: Array<{ id?: string; file?: string; action?: string; desc?: string }>;
}

const VALID_ACTIONS = new Set<string>(['modify', 'analyze', 'create', 'delete', 'explain', 'explore']);

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

  // Build a basename → absPath lookup from attached files
  const basenameMap = new Map<string, string>();
  for (const absPath of attachedFiles) {
    basenameMap.set(nodePath.basename(absPath).toLowerCase(), absPath);
  }
  // Also inject recently-changed paths from prior session so follow-up requests
  // ("rewrite the program", "add a feature") resolve to the same directory instead
  // of falling back to a different file with the same basename (e.g. src/main.cpp).
  if (priorFindings?.recentlyChangedPaths) {
    for (const relPath of priorFindings.recentlyChangedPaths) {
      for (const folder of vscode.workspace.workspaceFolders ?? []) {
        const abs = nodePath.join(folder.uri.fsPath, ...relPath.split('/'));
        const key = nodePath.basename(relPath).toLowerCase();
        // Only set if not already provided by an explicit attachment (attachments take priority)
        if (!basenameMap.has(key) && fs.existsSync(abs)) {
          basenameMap.set(key, abs);
        }
      }
    }
  }

  // ── Derive working directory anchor via shared helper ────────────────────
  // detectPromptDir() runs the same 4-priority detection as buildDecomposeSystemPrompt
  // (which already injected the result into the system prompt so the AI outputs full paths).
  // Here we use it a second time for: basenameMap filtering + confine block.
  const { promptDir, promptDirIsExplicit } = detectPromptDir(userPrompt, attachedFiles, activeEditorFile);

  // When promptDir is EXPLICITLY specified, restrict the basenameMap to only files UNDER
  // that directory — preventing cross-directory name collisions (e.g. docs/README.md
  // being picked up instead of code/3d_demo/README.md).
  // For INFERRED promptDir we do NOT filter, so explicitly attached files from other
  // locations are still resolved correctly via their original basenameMap entries.
  if (promptDir && promptDirIsExplicit) {
    for (const [key, val] of Array.from(basenameMap.entries())) {
      if (!val.startsWith(promptDir + nodePath.sep) && !val.startsWith(promptDir + '/')) {
        basenameMap.delete(key);
      }
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
    // Primary lookup: basename in attached files
    let absPath = basenameMap.get(nodePath.basename(file).toLowerCase());
    // If AI output an absolute path directly, use it as-is and normalise to workspace-relative.
    if (!absPath && nodePath.isAbsolute(file)) {
      if (fs.existsSync(file)) {
        absPath = file;
        // Derive workspace-relative path for task.file display
        for (const wf of vscode.workspace.workspaceFolders ?? []) {
          const fp = wf.uri.fsPath.replace(/\\/g, '/').replace(/\/$/, '') + '/';
          const fileSlash = file.replace(/\\/g, '/');
          if (fileSlash.startsWith(fp)) {
            file = fileSlash.slice(fp.length);
            break;
          }
        }
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

  const finalTasks = [...mergedMap.values()];

  // ── Confine tasks to promptDir ───────────────────────────────────────────
  // When promptDir is EXPLICIT (user-specified): redirect ALL tasks outside promptDir.
  // When promptDir is INFERRED (active editor / attached file heuristic):
  //   - redirect CREATE tasks and unresolved tasks (absPath undefined)
  //   - do NOT redirect already-resolved modify/analyze tasks (respect found location)
  // This prevents over-aggressive confinement when the user has attached files from
  // outside the current project (e.g. a monorepo-level docs/requirements.md).
  if (promptDir) {
    const sep = nodePath.sep;
    const pd = promptDir.endsWith(sep) || promptDir.endsWith('/') ? promptDir : promptDir + '/';
    const pdFwd = pd.replace(/\\/g, '/');
    for (const task of finalTasks) {
      const absNorm = task.absPath?.replace(/\\/g, '/');
      if (absNorm && absNorm.startsWith(pdFwd)) continue; // already inside promptDir

      // For inferred promptDir: skip redirect when the file was already resolved and
      // the task is not a create (modify/analyze of an existing file → keep its location).
      if (!promptDirIsExplicit && task.absPath !== undefined && task.action !== 'create') continue;
      // task.file is the LLM-supplied path (e.g. "test/run_tests.sh") — treat it as
      // relative to promptDir rather than relative to the workspace root.
      let fileRel = task.file.replace(/\\/g, '/').replace(/^\.\//,  '');

      // Strip workspace-root-relative prefix if task.file already embeds promptDir's path.
      // e.g. LLM outputs "code/3d_demo/test/run_tests.sh" when promptDir = ".../code/3d_demo"
      //   → strip "code/3d_demo/" → "test/run_tests.sh"
      for (const wf of vscode.workspace.workspaceFolders ?? []) {
        const wfNorm = wf.uri.fsPath.replace(/\\/g, '/').replace(/\/$/, '');
        const pdNorm = promptDir.replace(/\\/g, '/');
        if (pdNorm.startsWith(wfNorm + '/')) {
          const pdRel = pdNorm.slice(wfNorm.length + 1) + '/'; // e.g. "code/3d_demo/"
          if (fileRel.startsWith(pdRel)) { fileRel = fileRel.slice(pdRel.length); break; }
        }
      }

      // Security: remove traversal components
      const safeParts = fileRel.split('/').filter(p => p !== '..' && p !== '.' && p !== '');
      const resolved = safeParts.length > 0
        ? nodePath.join(promptDir, ...safeParts)
        : nodePath.join(promptDir, nodePath.basename(task.file));
      task.absPath = resolved;

      // Update task.file to workspace-root-relative path for display consistency
      for (const wf of vscode.workspace.workspaceFolders ?? []) {
        const wfSlash = (wf.uri.fsPath + '/').replace(/\\/g, '/');
        if (resolved.replace(/\\/g, '/').startsWith(wfSlash)) {
          task.file = resolved.replace(/\\/g, '/').slice(wfSlash.length);
          break;
        }
      }
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
  // G11: Always use 'analyze' as fallback action — it is safest and allows the
  // Editor's multi-round tool loop to infer the real intent from context,
  // rather than guessing 'modify' vs 'analyze' via keyword regex.
  void userPrompt; // kept in signature for API compatibility

  return attachedFiles.map((absPath, i) => {
    const basename = nodePath.basename(absPath);
    return {
      id: `t${i + 1}`,
      file: basename,
      action: 'analyze' as AgentTaskAction,
      desc: `分析 ${basename}`,
      absPath,
    };
  });
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

  // Pass full abs paths so buildDecomposeSystemPrompt can read file contents
  const systemPrompt = buildDecomposeSystemPrompt(userPrompt, attachedFiles, priorFindings, activeEditorFile);

  let raw = '';
  try {
    raw = chatFn
      ? await chatFn(systemPrompt, mode)
      : await chat({
          prompt: systemPrompt,
          newSession: false, // P8: preserve conversation history so the planner sees prior context
          mode,
          stream: false,
        });
  } catch (e) {
    const error = (e as Error).message;
    return { tasks: [], raw: '', ok: false, error };
  }

  const tasks = parseTaskPlan(raw, attachedFiles, priorFindings, userPrompt, activeEditorFile);
  if (tasks.length === 0) {
    // Fallback: derive tasks directly from file list
    const fallback = inferTasksFromFiles(attachedFiles, userPrompt);
    return { tasks: fallback, raw, ok: false, error: 'JSON plan parse failed, using fallback' };
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

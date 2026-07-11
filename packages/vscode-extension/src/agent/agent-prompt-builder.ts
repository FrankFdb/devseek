import type { AgentTask } from '../agent-task-decomposer';
import type { McpToolRef } from '../mcp/client';
import { buildEngineeringGuidelinesPrompt } from './engineering-guidelines';
import { buildFullFileWriteToolPrompt, buildReplaceInFileToolPrompt } from './tool-protocol-prompt';

export function buildLocalRespondTaskMessage(task: AgentTask, userPrompt: string): string {
  if (task.targetKind === 'provider-response') {
    return [
      '已安全阻断上一次损坏响应。',
      '',
      '该内容包含未完成或未验证的工具调用文本，DevSeek 不会补全、规范化或执行它，也不会把内部恢复标识当作文件继续分析。',
      '请重新发送纯文本内容，或将需要展示的工具样本文本放入完整代码块后重试。',
    ].join('\n');
  }
  const promptHint = userPrompt.trim().slice(0, 160);
  return [
    '已停止执行当前恢复任务。',
    '',
    'DevSeek 没有找到足够的可信任务事实来安全续传，因此未读取、搜索或写入工作区文件。',
    promptHint ? `原始请求摘要：${promptHint}${userPrompt.trim().length > 160 ? '…' : ''}` : '',
  ].filter(Boolean).join('\n');
}

export interface BuildToolsSuffixOptions {
  includeTerminal?: boolean;
  includeWorkspaceMutationTools?: boolean;
}

export function buildToolsSuffix(
  taskIndex: number,
  taskTotal: number,
  mcpTools?: McpToolRef[],
  taskWorkdir?: string,
  options: BuildToolsSuffixOptions = {},
): string {
  const isFirst = taskIndex === 1;
  const isLast  = taskIndex === taskTotal;
  const isSingle = taskTotal === 1;
  const includeTerminal = options.includeTerminal ?? true;
  const includeWorkspaceMutationTools = options.includeWorkspaceMutationTools ?? true;

  const workflowHint = isSingle || isLast
    ? `
【完成信号】
完成本次任务后，调用 task_complete 工具，附上完成报告（包含：1)完成了哪些分析/修改及关键结论；2)为什么这样处理；3)需注意的副作用或潜在问题）。
过程中可用 manage_todo_list 跟踪进度（只将当前任务标为 in-progress，未完成任务保持 not-started）。
`
    : isFirst
    ? `
【当前任务】第 ${taskIndex}/${taskTotal} 个任务（序列计划第一步）
完成本文件内容输出后停止，系统会自动推进到下一个任务。
`
    : `
【当前任务】第 ${taskIndex}/${taskTotal} 个任务
完成本文件内容输出后停止，系统会自动推进到下一个任务。
`;

  const mcpSection = buildMcpToolsSection(mcpTools);

  return `
${buildEngineeringGuidelinesPrompt('agent')}

## 可用工具（通过文本格式调用）

格式严格如下（JSON 必须完整，不省略花括号）：
${isSingle || isLast ? `
更新任务列表（全量替换，每次必须包含所有任务）：
[TOOL:manage_todo_list {"todoList":[{"id":1,"title":"任务标题","status":"in-progress"},{"id":2,"title":"另一任务","status":"not-started"}]}]

标记全部完成（仅最后一个任务才可调用）：
[TOOL:task_complete {"summary":"完成报告：1)修改内容（文件名+关键改动）；2)修改原因；3)注意事项或潜在影响（如有）"}]
` : ''}
${includeTerminal ? `执行终端命令（输出将在下轮可见，可用于编译验证、运行测试等）：
[TOOL:run_terminal {"command":"npm run build","workdir":"${taskWorkdir ?? '/可选/绝对/路径'}"}]
` : ''}

读取工作区文件内容（路径相对于工作区根，或绝对路径；大文件可用 startLine/endLine 继续读取）：
[TOOL:read_file {"path":"src/foo.ts"}]
[TOOL:read_file {"path":"src/foo.ts","startLine":300,"endLine":520}]

搜索工作区文件内容（支持正则，可指定目录路径）：
[TOOL:grep_search {"pattern":"className|funcName","path":"src/","isRegexp":true}]

按 glob 模式查找文件名（不读取内容）：
[TOOL:file_search {"glob":"src/**/*.ts"}]

语义化搜索工作区代码（按意图/概念，自动提取关键词）：
[TOOL:semantic_search {"query":"用户登录验证处理函数"}]

列出目录内容（相对于工作区根目录）：
[TOOL:list_dir {"path":"src/utils/"}]

获取当前 VS Code 编译/诊断错误（类型错误、语法错误等）：
[TOOL:get_errors {}]

将重要发现写入项目记忆（由 DevSeek MemoryService 管理，供未来 session 使用）。
触发时机：发现架构规律、非显而易见的约定、反复出现的错误原因时主动写入：
[TOOL:memory_write {"content":"关键记录内容（100字以内）"}]

查看当前工作区 git 变更摘要（已修改/新增/已删除文件列表及 diff）：
[TOOL:get_changed_files {}]

${includeWorkspaceMutationTools ? `创建目录（含父级目录，相对于工作区根或绝对路径）：
[TOOL:create_directory {"path":"src/utils/helpers"}]

${buildFullFileWriteToolPrompt()}

精确替换既有文件片段（修改正式工程既有文件时优先使用；old_str 必须来自 read_file 读取到的原文）：
${buildReplaceInFileToolPrompt()}
` : ''}

获取网页内容（用于查阅文档、API 参考、错误信息等；仅支持 http/https）：
[TOOL:fetch_webpage {"url":"https://example.com/docs"}]

查找某个符号（函数/类/变量/接口）在整个代码库中的所有引用位置（使用语言服务器语义分析，比 grep 更精确；可跳过注释和字符串误匹配）：
[TOOL:vscode_listCodeUsages {"symbol":"FunctionName","filePath":"src/foo.ts"}]

${includeWorkspaceMutationTools ? `执行 VS Code 编辑器命令（格式化文档、整理 import、运行任务、重启类型检查等；非白名单命令需用户确认）：
[TOOL:run_vscode_command {"command":"editor.action.formatDocument"}]
[TOOL:run_vscode_command {"command":"workbench.action.tasks.runTask","args":["Build"]}]
` : ''}
${isSingle || isLast ? `\n状态枚举："not-started" | "in-progress" | "completed"` : ''}
${workflowHint}${mcpSection}`;
}

function buildMcpToolsSection(mcpTools?: McpToolRef[]): string {
  if (!mcpTools || mcpTools.length === 0) return '';
  const toolLines = mcpTools.map((ref) => {
    const schema = JSON.stringify(ref.tool.inputSchema ?? {});
    return `  [TOOL:${ref.fakeName} ${schema}]  — ${ref.tool.description || ref.tool.name}`;
  }).join('\n');
  return `

## MCP 外部工具（通过相同格式调用）

以下工具由外部 MCP server 提供。调用格式与上方相同：
[TOOL:mcp__<server>__<tool> {"param":"value"}]

可用工具：
${toolLines}

调用 MCP 工具后，结果将作为下一轮输入附上。`;
}

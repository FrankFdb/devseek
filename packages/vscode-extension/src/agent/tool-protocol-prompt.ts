import {
  renderTextToolProtocolEnvelope,
  type TextToolProtocolSession,
} from './text-tool-protocol';

export const REPLACE_IN_FILE_RAW_EXAMPLE = [
  '```xml',
  '<replace_in_file>',
  '<path>src/foo.cpp</path>',
  '<old_str><![CDATA[if (ready) {',
  '  include("old.hpp");',
  '}]]></old_str>',
  '<new_str><![CDATA[if (ready) {',
  '  include("new.hpp");',
  '}]]></new_str>',
  '</replace_in_file>',
  '```',
].join('\n');

export const FULL_FILE_WRITE_RAW_EXAMPLE = [
  '```xml',
  '<create_file>',
  '<path>src/foo.py</path>',
  '<content><![CDATA[print("\\nready")',
  ']]></content>',
  '</create_file>',
  '```',
].join('\n');

export const APPLY_PATCH_RAW_EXAMPLE = [
  '```xml',
  '<apply_patch>',
  '<path>src/foo.cpp</path>',
  '<patch><![CDATA[*** Begin Patch',
  '*** Update File: src/foo.cpp',
  '@@',
  ' void run() {',
  '-  old_call();',
  '+  new_call();',
  ' }',
  '*** End Patch]]></patch>',
  '</apply_patch>',
  '```',
].join('\n');

export function buildFullFileWriteToolPrompt(session?: TextToolProtocolSession): string {
  return [
    '使用文本工具协议创建或完整覆写多行源码、Markdown、JSON、脚本时，必须使用 XML 代码围栏包裹的 CDATA 无损原始格式：',
    renderProtocolExample(FULL_FILE_WRITE_RAW_EXAMPLE, session),
    '整个工具块必须保留在 ```xml 代码围栏内，不要输出裸 XML；CDATA 中的反斜杠、双引号、Markdown 代码块和真实换行不得改写。',
    '既有源码的聚焦修复使用 replace_in_file；插入/删除或完整 old_str 很长时使用单文件 apply_patch。不能因为参数传输或匹配失败就改成整文件覆写。只有用户要求整体生成/重构，或修改确实覆盖文件大部分结构时，才完整覆写既有文件，并必须保留无关行为。',
    '每轮最多输出 1 个较大的整文件写入工具；输出工具块后立即停止，等待真实写盘结果。',
    '只有无反斜杠、无双引号的短单行内容才可使用 [TOOL:create_file {...}] JSON 格式。',
    '若 Provider 已提供原生 function calling，则直接调用原生 create_file，不输出文本伪工具块。',
  ].join('\n');
}

export function buildReplaceInFileToolPrompt(session?: TextToolProtocolSession): string {
  return [
    '优先选取能唯一匹配的最小 old_str/new_str。文本 Provider 的 replace_in_file 必须统一使用 XML 代码围栏包裹的 CDATA 无损原始参数格式：',
    renderProtocolExample(REPLACE_IN_FILE_RAW_EXAMPLE, session),
    '整个工具块必须保留在 ```xml 代码围栏内，不要输出裸 XML。',
    '每轮最多输出 1 个多行 replace_in_file；输出工具块后立即停止，等待真实写盘结果。',
  ].join('\n');
}

export function buildApplyPatchToolPrompt(session?: TextToolProtocolSession): string {
  return [
    '当聚焦修改需要插入/删除代码，且完整 old_str 很长或容易因传输失真而失败时，使用单文件 apply_patch：',
    renderProtocolExample(APPLY_PATCH_RAW_EXAMPLE, session),
    'path 与 *** Update File 必须指向同一个工作区内既有文件；每个 hunk 必须包含足以唯一定位的未修改上下文。',
    'apply_patch 只支持单文件文本更新，不支持新建、删除、移动、二进制补丁或工作区外路径；它仍经过与其他写入相同的权限、沙箱、事务、源码护栏和读回验证。',
    '每轮最多输出 1 个 apply_patch；整个工具块保留在 ```xml 代码围栏内，patch 使用 CDATA，输出后立即停止等待真实结果。',
  ].join('\n');
}

export interface TextToolEnvelopeRecoveryPromptOptions {
  readonly observedToolNames?: readonly string[];
}

const SIMPLE_RECOVERY_EXAMPLES: Readonly<Record<string, string>> = Object.freeze({
  read_file: '[TOOL:read_file {"path":"/absolute/path/to/file"}]',
  list_dir: '[TOOL:list_dir {"path":"/absolute/path/to/directory"}]',
  grep_search: '[TOOL:grep_search {"pattern":"symbol","path":"src/","isRegexp":false}]',
  file_search: '[TOOL:file_search {"glob":"src/**/*.ts"}]',
  run_terminal: '[TOOL:run_terminal {"command":"git status --short"}]',
  manage_todo_list: '[TOOL:manage_todo_list {"todoList":[{"id":1,"title":"继续当前步骤","status":"in-progress"}]}]',
});

export function buildTextToolEnvelopeRecoveryPrompt(
  session: TextToolProtocolSession,
  options: TextToolEnvelopeRecoveryPromptOptions = {},
): string {
  const observedToolName = selectObservedRecoveryTool(options.observedToolNames);
  const example = recoveryExampleForTool(observedToolName);
  const mutationGuidance = mutationRecoveryGuidance(observedToolName);
  return [
    '- 上一轮结构化动作位于授权信封之外，或信封不完整/无有效工具，因此没有执行。不要使用 Action/Action Input、裸 XML、裸 JSON 或无信封的 [TOOL:...]。',
    observedToolName
      ? `- 仅识别到上一轮尝试调用 ${observedToolName}；其参数没有获得授权、不会复用。请依据当前任务事实重新决定参数。`
      : '- 上一轮没有留下可复用的完整工具参数；请依据当前任务事实重新决定一个最小下一步。',
    '- 本轮只输出 1 个工具调用，并完整包在以下当前信封中。示例参数只说明序列化格式，必须替换为任务所需的真实参数：',
    renderTextToolProtocolEnvelope(session, example),
    mutationGuidance,
    '- 输出闭合信封后立即停止并等待真实工具结果。',
  ].filter(Boolean).join('\n');
}

export function buildUnexecutedShellActionRecoveryPrompt(session: TextToolProtocolSession): string {
  return [
    '- 上一轮只在普通 Markdown 代码块中展示了 shell 命令；代码块是说明数据，不是已授权的 run_terminal 调用，因此没有执行。',
    '- 若该命令仍是当前最小下一步，请重新判断真实参数，并只输出 1 个 run_terminal 调用，完整包在以下当前授权信封中：',
    renderTextToolProtocolEnvelope(session, SIMPLE_RECOVERY_EXAMPLES.run_terminal),
    '- 不要输出裸命令、shell 代码块或未来动作说明。闭合信封后立即停止，等待宿主返回真实执行结果。',
    '- 本提示只恢复动作提案的传输格式，不授予额外权限；命令仍会独立经过范围、风险、确认和沙箱仲裁。',
  ].join('\n');
}

function renderProtocolExample(payload: string, session?: TextToolProtocolSession): string {
  return session ? renderTextToolProtocolEnvelope(session, payload) : payload;
}

function selectObservedRecoveryTool(observedToolNames: readonly string[] | undefined): string | undefined {
  return observedToolNames?.find(name => (
    Object.prototype.hasOwnProperty.call(SIMPLE_RECOVERY_EXAMPLES, name)
    || name === 'replace_in_file'
    || name === 'apply_patch'
    || name === 'create_file'
    || name === 'write_file'
  ));
}

function recoveryExampleForTool(toolName: string | undefined): string {
  if (toolName === 'replace_in_file') return REPLACE_IN_FILE_RAW_EXAMPLE;
  if (toolName === 'apply_patch') return APPLY_PATCH_RAW_EXAMPLE;
  if (toolName === 'create_file' || toolName === 'write_file') return FULL_FILE_WRITE_RAW_EXAMPLE;
  return SIMPLE_RECOVERY_EXAMPLES[toolName || 'read_file'] || SIMPLE_RECOVERY_EXAMPLES.read_file;
}

function mutationRecoveryGuidance(toolName: string | undefined): string {
  if (toolName === 'replace_in_file') {
    return '- 多行 old_str/new_str 必须保持 fenced CDATA；只修复一个唯一匹配片段，不得升级为整文件覆写。';
  }
  if (toolName === 'apply_patch') {
    return '- patch 必须保持 fenced CDATA；只更新一个既有文件，每个 hunk 使用唯一的最小上下文。';
  }
  if (toolName === 'create_file' || toolName === 'write_file') {
    return '- 多行源码 content 必须保持 fenced CDATA；每轮只交付一个可验证的完整责任切片。';
  }
  return '';
}

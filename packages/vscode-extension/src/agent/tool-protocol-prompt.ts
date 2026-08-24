export const REPLACE_IN_FILE_JSON_EXAMPLE =
  '[TOOL:replace_in_file {"path":"src/foo.cpp","old_str":"原始文本","new_str":"替换后文本"}]';

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

export function buildFullFileWriteToolPrompt(session?: TextToolProtocolSession): string {
  return [
    '使用文本工具协议创建或完整覆写多行源码、Markdown、JSON、脚本时，必须使用 XML 代码围栏包裹的 CDATA 无损原始格式：',
    renderProtocolExample(FULL_FILE_WRITE_RAW_EXAMPLE, session),
    '整个工具块必须保留在 ```xml 代码围栏内，不要输出裸 XML；CDATA 中的反斜杠、双引号、Markdown 代码块和真实换行不得改写。',
    '既有源码的聚焦修复必须优先使用 replace_in_file；不能因为参数传输或 old_str 匹配失败就改成整文件覆写。只有用户要求整体生成/重构，或修改确实覆盖文件大部分结构时，才完整覆写既有文件，并必须保留无关行为。',
    '每轮最多输出 1 个较大的整文件写入工具；输出工具块后立即停止，等待真实写盘结果。',
    '只有无反斜杠、无双引号的短单行内容才可使用 [TOOL:create_file {...}] JSON 格式。',
    '若 Provider 已提供原生 function calling，则直接调用原生 create_file，不输出文本伪工具块。',
  ].join('\n');
}

export function buildReplaceInFileToolPrompt(session?: TextToolProtocolSession): string {
  return [
    REPLACE_IN_FILE_JSON_EXAMPLE,
    '优先选取能唯一匹配的最小 old_str/new_str；短单行替换可以使用 JSON，并按 JSON 规则转义源码双引号。',
    '当 old_str/new_str 含源码双引号、反斜杠或多行文本时，必须使用 XML 代码围栏包裹的 CDATA 无损原始参数格式：',
    renderProtocolExample(REPLACE_IN_FILE_RAW_EXAMPLE, session),
    '整个工具块必须保留在 ```xml 代码围栏内，不要输出裸 XML。',
    '每轮最多输出 1 个多行 replace_in_file；输出工具块后立即停止，等待真实写盘结果。',
  ].join('\n');
}

export function buildReplaceInFileRecoveryPrompt(session?: TextToolProtocolSession): string {
  return [
    '- 上一轮工具参数序列化损坏：本轮只输出 1 个工具调用，输出工具块后立即停止。',
    '- 不要再次把含源码双引号或多行文本的 old_str/new_str 手写进 JSON 或裸 XML；改用以下 fenced CDATA XML 格式：',
    renderProtocolExample(REPLACE_IN_FILE_RAW_EXAMPLE, session),
    '- 每轮只修复 1 个多行替换，输出工具块后立即停止并等待执行结果。',
    '- 这是既有文件的局部修复；不要升级为 write_file 整文件覆写。先 read_file 读取精确行范围，再缩小 old_str 到唯一最小片段。',
    '- 若调用 run_terminal，command 必须是合法 JSON 字符串；shell 文本优先使用单引号。',
  ].join('\n');
}

export function buildTextToolEnvelopeRecoveryPrompt(session: TextToolProtocolSession): string {
  return [
    '- 上一轮把结构化动作输出在授权信封之外，因此没有执行。不要使用 Action/Action Input、裸 XML、裸 JSON 或无信封的 [TOOL:...]。',
    '- 若要调用工具，只能使用本轮当前信封；若只是解释工具语法，请改用自然语言说明，不要输出可解析动作块。',
    renderTextToolProtocolEnvelope(
      session,
      '[TOOL:read_file {"path":"/absolute/path/to/file"}]',
    ),
    '- 输出闭合信封后立即停止并等待真实工具结果。',
  ].join('\n');
}

function renderProtocolExample(payload: string, session?: TextToolProtocolSession): string {
  return session ? renderTextToolProtocolEnvelope(session, payload) : payload;
}
import {
  renderTextToolProtocolEnvelope,
  type TextToolProtocolSession,
} from './text-tool-protocol';

export const REPLACE_IN_FILE_JSON_EXAMPLE =
  '[TOOL:replace_in_file {"path":"src/foo.cpp","old_str":"原始文本","new_str":"替换后文本"}]';

export const REPLACE_IN_FILE_RAW_EXAMPLE = [
  '<replace_in_file>',
  '<path>src/foo.cpp</path>',
  '<old_str>#include "old.hpp"</old_str>',
  '<new_str>#include "new.hpp"</new_str>',
  '</replace_in_file>',
].join('\n');

export function buildReplaceInFileToolPrompt(): string {
  return [
    REPLACE_IN_FILE_JSON_EXAMPLE,
    '当 old_str/new_str 含源码双引号、反斜杠或多行文本时，优先使用无需 JSON 转义的原始参数格式：',
    REPLACE_IN_FILE_RAW_EXAMPLE,
  ].join('\n');
}

export function buildReplaceInFileRecoveryPrompt(): string {
  return [
    '- 上一轮工具参数序列化损坏：本轮只输出 1 个工具调用，输出工具块后立即停止。',
    '- 不要再次把含源码双引号或多行文本的 old_str/new_str 手写进 JSON；改用以下原始参数格式：',
    REPLACE_IN_FILE_RAW_EXAMPLE,
    '- 若调用 run_terminal，command 必须是合法 JSON 字符串；shell 文本优先使用单引号。',
  ].join('\n');
}

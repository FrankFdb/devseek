const RESPONSE_ABSOLUTE_TIMEOUT_MIN_MS = 90_000;
const RESPONSE_ABSOLUTE_TIMEOUT_MAX_MS = 180_000;
const RESPONSE_ABSOLUTE_TIMEOUT_FACTOR = 1.5;

export function responseAbsoluteTimeoutMs(timeoutMs: number): number {
  const scaled = Math.ceil(timeoutMs * RESPONSE_ABSOLUTE_TIMEOUT_FACTOR);
  return Math.min(Math.max(scaled, RESPONSE_ABSOLUTE_TIMEOUT_MIN_MS), RESPONSE_ABSOLUTE_TIMEOUT_MAX_MS);
}

export function responseStreamTimeoutError(input: {
  timeoutMs: number;
  absoluteTimeoutMs: number;
  partialChars: number;
  newMessageSeen: boolean;
  phase: string;
}): Error {
  const progress = input.newMessageSeen
    ? `partialChars=${input.partialChars}`
    : 'no new assistant message was detected';
  return new Error(
    `RESPONSE_CORRUPTED:stream-timeout:DeepSeek response did not complete within ${input.absoluteTimeoutMs}ms `
    + `(single-round timeout=${input.timeoutMs}ms, phase=${input.phase}, ${progress}).`,
  );
}

export function looksLikeIncompleteAssistantIntent(text: string): boolean {
  const tail = String(text || '')
    .trim()
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(-3)
    .join('\n');
  if (!tail) return false;
  return /(?:让我|我来|接下来|下面|现在|首先|然后|继续|需要|将|准备)[\s\S]{0,120}(?:修复|修改|更新|创建|写入|执行|读取|查看|检查|编译|运行|调用|处理)[\s\S]{0,80}[：:]\s*$/iu.test(tail);
}

export function looksLikeSubstantiveAssistantText(text: string): boolean {
  const trimmed = String(text || '').trim();
  if (!trimmed) return false;
  if (/(?:\[TOOL:|<TOOL_STREAM>|<TOOL\b|<\/TOOL>|<TOOL_|<\/TOOL_|<(?:read_file|grep_search|list_dir|file_search|create_file|write_file|replace_file|replace_in_file|run_terminal|manage_todo_list|task_complete)\b|Action\s*:|```\w*)/iu.test(trimmed)) {
    return true;
  }
  if (trimmed.length >= 120) return true;
  return trimmed.length >= 80
    && /(?:结论|依据|原因|风险|建议|方案|已完成|创建|修改|验证|写入|运行|编译|测试)/iu.test(trimmed);
}

export function isSubstantiveAssistantTextDiff(currentText: string, baselineText: string): boolean {
  const current = String(currentText || '').trim();
  const baseline = String(baselineText || '').trim();
  if (!current || current === baseline) return false;
  if (current.length < 80 && baseline.includes(current)) return false;
  return looksLikeSubstantiveAssistantText(current);
}

export function contentMutationClockScript(reset: boolean): string {
  return `(function(reset){
    var w = window;
    var now = Date.now();
    if (reset || !w.__devseekContentMutationAt) w.__devseekContentMutationAt = now;
    if (!w.__devseekContentObserver && document.body && typeof MutationObserver !== 'undefined') {
      w.__devseekContentObserver = new MutationObserver(function(mutations){
        for (var i = 0; i < mutations.length; i++) {
          if (mutations[i].type === 'childList' || mutations[i].type === 'characterData') {
            w.__devseekContentMutationAt = Date.now();
            return;
          }
        }
      });
      w.__devseekContentObserver.observe(document.body, {
        childList: true,
        characterData: true,
        subtree: true
      });
    }
    return Math.max(0, now - (w.__devseekContentMutationAt || now));
  })(${reset ? 'true' : 'false'})`;
}

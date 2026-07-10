const ACTION_INTENT_RE =
  /(?:让我|我来|我会|我将|接下来|下一步|现在|继续|然后|随后|马上|开始|准备).{0,48}(?:检查|查看|读取|确认|验证|编译|运行|执行|测试|修改|创建|更新|写入|实现|添加|生成|搜索|列出|打开|启动)|(?:let\s+me|i(?:'ll| will)|next|now|then).{0,96}(?:check|inspect|read|verify|validate|compile|run|execute|test|modify|create|update|write|implement|add|generate|search|list|open|start)/i;

const COMPLETION_PAST_RE =
  /(?:已(?:经)?|完成|结果|验证结果|编译成功|运行正常|测试通过|done|completed|finished|passed|succeeded)/i;

export function hasDanglingAgentActionIntent(text: string): boolean {
  const trimmed = String(text || '').trim();
  if (!trimmed) return false;
  const tail = trimmed.slice(-700);
  if (!ACTION_INTENT_RE.test(tail)) return false;
  const lastSentence = tail.split(/[。！？!?]\s*|\n+/).filter(Boolean).pop() || tail;
  if (COMPLETION_PAST_RE.test(lastSentence) && !/(?:让我|我来|我会|我将|let\s+me|i(?:'ll| will))/i.test(lastSentence)) {
    return false;
  }
  return true;
}

export function buildDanglingAgentActionFeedback(): string {
  return [
    '【系统反馈】你刚才说明要继续检查、创建、修改、写入、编译或运行，但本轮没有调用任何工具，不能把行动承诺当作执行结果。',
    '请立即调用真实工具完成刚才承诺的动作：需要查看时用 list_dir/read_file；需要创建或修改时用 create_file/write_file；需要编译或运行时用 run_terminal。',
    '如果已经确认无需修改，也必须用真实读取/验证证据给出结论，不要停在“让我检查/我将运行”的说明阶段。',
  ].join('\n');
}

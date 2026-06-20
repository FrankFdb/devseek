import {
  requiresCodeArtifactForEvidence,
  requiresCommandEvidence,
  requiresFileCheckEvidence,
  requiresFileChangeEvidence,
  requiresReadEvidence,
} from './completion-evidence';

export interface TodoItem {
  id: number;
  title: string;
  /** Copilot-compatible status values */
  status: 'not-started' | 'in-progress' | 'completed' | 'failed';
  /** Runtime-owned state may override earlier model todo snapshots in the UI. */
  __agentState?: boolean;
}

export function markMissingEvidenceTodosIncomplete(todos: TodoItem[], missing: string[]): TodoItem[] {
  if (!todos.length || !missing.length) return todos;
  const needsCode = missing.some(m => m.includes('代码') || m.includes('程序'));
  const needsCommand = missing.some(m => m.includes('编译') || m.includes('运行') || m.includes('测试') || m.includes('成功'));
  const needsRead = missing.some(m => m.includes('读取') || m.includes('检查'));
  let firstMissing = true;
  return todos.map(item => {
    const title = item.title.toLowerCase();
    const matchesCode = needsCode && /(?:代码|源码|程序|脚本|实现|动画|开发)/i.test(title);
    const matchesCommand = needsCommand && /(?:编译|运行|执行|测试|验证|调试|compile|build|test|run)/i.test(title);
    const matchesRead = needsRead && /(?:读取|检查|查看|显示|确认|验证|校验|read|inspect|check|show|verify|validate)/i.test(title);
    if (!matchesCode && !matchesCommand && !matchesRead) return item;
    const status = firstMissing ? 'in-progress' as const : 'not-started' as const;
    firstMissing = false;
    return { ...item, status };
  });
}

export function markValidationFailureTodos(todos: TodoItem[]): TodoItem[] {
  if (!todos.length) return todos;
  let matched = false;
  const updated = todos.map(item => {
    const title = item.title.toLowerCase();
    if (!isAutomaticValidationTodoTitle(title)) {
      return item;
    }
    matched = true;
    return { ...item, status: 'failed' as const };
  });
  if (matched) return updated;

  if (updated.some(item => isFileFactVerificationTodoTitle(item.title))) {
    return [
      ...updated,
      {
        id: nextTodoId(updated),
        title: '运行自动验证 / QualityGate',
        status: 'failed' as const,
      },
    ];
  }

  const lastCompletedIndex = updated
    .map((item, index) => ({ item, index }))
    .reverse()
    .find(({ item }) => item.status === 'completed')?.index;
  if (lastCompletedIndex === undefined) return updated;
  return updated.map((item, index) => (
    index === lastCompletedIndex ? { ...item, status: 'failed' as const } : item
  ));
}

function isAutomaticValidationTodoTitle(title: string): boolean {
  return /(?:编译|运行|执行|测试|type(?:script)?|tsc|compile|build|test|run|execute|validate|qualitygate)/i.test(title);
}

function isFileFactVerificationTodoTitle(title: string): boolean {
  return /(?:文件|内容|大小|存在|创建成功|读取|检查|确认|校验|验证)/i.test(title)
    && !isAutomaticValidationTodoTitle(title);
}

function nextTodoId(todos: TodoItem[]): number {
  return Math.max(0, ...todos.map(todo => Number(todo.id) || 0)) + 1;
}

export function inferInitialAgenticTodos(userPrompt: string): TodoItem[] {
  const items: TodoItem[] = [];
  const needsRead = requiresReadEvidence(userPrompt);
  const needsFile = requiresFileChangeEvidence(userPrompt);
  const needsCode = requiresCodeArtifactForEvidence(userPrompt);
  const needsFileCheck = requiresFileCheckEvidence(userPrompt);
  const needsCommand = !needsFileCheck && (requiresCommandEvidence(userPrompt) || /(?:程序|代码|动画|运行效果|效果)/i.test(userPrompt));
  if (needsRead) {
    items.push({ id: items.length + 1, title: '检查/读取目标文件', status: 'in-progress' });
  }
  if (needsFile) {
    items.push({ id: items.length + 1, title: needsCode ? '创建/更新代码文件' : '创建/更新文件', status: 'in-progress' });
  }
  if (needsCommand) {
    items.push({ id: items.length + 1, title: '编译/运行并验证结果', status: needsCode ? 'not-started' : 'in-progress' });
  }
  if (needsFileCheck) {
    items.push({ id: items.length + 1, title: '验证文件创建成功（文件存在、内容正确、大小正常）', status: needsFile ? 'not-started' : 'in-progress' });
  }
  if (!items.length && /(?:查找|定位|分析|确认|排查|检查)/i.test(userPrompt)) {
    items.push({ id: 1, title: '分析并定位问题', status: 'in-progress' });
  }
  return items;
}

export function buildMissingEvidenceRecoveryInstruction(missing: string[]): string {
  if (missing.some(item => item.includes('内容'))) {
    return '请调用 read_file 读取目标文件，或使用只读 run_terminal 命令 cat/head/sed 显示目标文件内容；test/ls 只能证明存在，不能满足内容读取。不要创建、修改或覆盖文件。';
  }
  if (missing.some(item => item.includes('读取') || item.includes('检查'))) {
    return '请调用 read_file/list_dir，或使用只读 run_terminal 命令（test/ls/cat/head/stat）检查目标文件和内容；不要创建、修改或覆盖文件。';
  }
  return '请立即调用 create_file/write_file 写入目标文件；只有代码/程序任务才需要随后调用 run_terminal 编译、运行或测试。';
}

import * as vscode from 'vscode';

export type RepairExhaustedAction = 'continue' | 'guide' | 'stop';

export interface RepairGuidanceRouteChatOptions {
  prompt: string;
  newSession?: boolean;
  stream?: boolean;
}

export async function askRepairExhaustedAction(title: string, detail: string): Promise<RepairExhaustedAction> {
  const choice = await vscode.window.showWarningMessage(
    `${title}：${detail}`,
    '继续 3 轮',
    '给出手动修改建议',
    '停止',
  );
  if (choice === '继续 3 轮') return 'continue';
  if (choice === '给出手动修改建议') return 'guide';
  return 'stop';
}

export async function requestManualFixGuidance(
  routeChat: (opts: RepairGuidanceRouteChatOptions) => Promise<string>,
  originalPrompt: string,
  command: string,
  output: string,
): Promise<string> {
  try {
    const guidancePrompt = [
      '请给出简洁的人工修复建议（分步骤），用于开发者手动修改代码。',
      '要求：只给操作步骤和可能修改的文件，不输出大段代码。',
      '',
      '原始需求：',
      originalPrompt,
      '',
      '失败命令：',
      command,
      '',
      '错误输出：',
      '```text',
      (output || '（无输出）').slice(0, 5000),
      '```',
    ].join('\n');

    const reply = await routeChat({
      prompt: guidancePrompt,
      newSession: false,
      stream: false,
    });
    return (reply || '未能生成建议。').trim();
  } catch {
    return '建议：先定位首个编译错误对应文件与符号，再最小化修改后重新编译。';
  }
}

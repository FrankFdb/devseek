import * as vscode from 'vscode';
import { AgentDisplayPresenter } from '../app/agent-display-presenter';

export function postAgentSettlementRefusal(
  webview: vscode.Webview,
  presenter: AgentDisplayPresenter,
): void {
  webview.postMessage(presenter.presentStatus({
    type: 'agentStatus',
    phase: 'done',
    state: 'failed',
    title: 'Agent 工作已结束，但运行证据结算失败',
    detail: '已禁止自动接受，并将本轮会话状态记为未完成。',
  }));
}

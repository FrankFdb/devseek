import * as nodePath from 'path';
import type { ChatMessage } from '../llm/types';
import { stripSessionContextPrefix } from './session-display-service';
import type { SessionService } from './session-service';

interface SessionPersistenceDependencies {
  getSessionService(): SessionService | undefined;
  getActiveSessionId(): string;
  getHistory(): ChatMessage[];
  getRecentFiles(): ReadonlyMap<string, string>;
  routeCompaction(prompt: string): Promise<string>;
}

/** Owns durable session snapshots, summaries, and the per-session file index. */
export class SessionPersistenceCoordinator {
  constructor(private readonly dependencies: SessionPersistenceDependencies) {}

  saveCurrentSession(): void {
    const sessionId = this.dependencies.getActiveSessionId();
    const history = this.dependencies.getHistory();
    const service = this.dependencies.getSessionService();
    if (!sessionId || history.length === 0 || !service) return;

    const durableHistory = stripSessionContextPrefix(history);
    service.saveSessionHistory(sessionId, durableHistory.slice(-40));
    const files = Object.fromEntries(this.dependencies.getRecentFiles());
    service.saveSessionFiles(sessionId, files);
    const existing = service.getSessions().find(session => session.id === sessionId);
    if (!existing) return;
    const changedFiles = [...new Set(Object.values(files).map(file => nodePath.basename(file)))].slice(0, 8);
    service.saveSessionMeta({
      ...existing,
      messageCount: durableHistory.filter(message => message.role === 'user').length,
      fileCount: changedFiles.length,
      changedFiles,
    });
  }

  saveCurrentSessionFiles(): void {
    const sessionId = this.dependencies.getActiveSessionId();
    if (!sessionId) return;
    this.dependencies.getSessionService()?.saveSessionFiles(
      sessionId,
      Object.fromEntries(this.dependencies.getRecentFiles()),
    );
  }

  registerFile(files: Map<string, string>, absolutePath: string, workspaceRoot?: string): void {
    if (!absolutePath) return;
    files.set(nodePath.basename(absolutePath).toLowerCase(), absolutePath);
    if (workspaceRoot && absolutePath.startsWith(workspaceRoot + nodePath.sep)) {
      const relativePath = absolutePath.slice(workspaceRoot.length + 1);
      files.set(relativePath, absolutePath);
      files.set(nodePath.basename(relativePath).toLowerCase(), absolutePath);
    }
    this.saveCurrentSessionFiles();
  }

  async compactAndSaveHistory(history: ChatMessage[], sessionId: string): Promise<void> {
    const service = this.dependencies.getSessionService();
    if (history.length < 4 || !sessionId || !service) return;
    const historyText = history.slice(-30).map(message => {
      const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
      return `[${message.role}]: ${content.slice(0, 600)}`;
    }).join('\n');
    const prompt = `你是一个 AI 编程助手会话摘要生成器。请将下面的对话历史生成一份**结构化 Markdown 摘要**，严格按以下格式输出（不要省略任何章节标题，保持 Markdown 格式）：

## 主要任务
一句话说明本次对话的核心目标。

## 已完成的工作
- （用列表列出具体完成的任务，每条20字以内）

## 修改/创建的文件
- \`相对路径/文件名\` — 一句话描述改动内容
（路径非常重要，保留完整相对路径）

## 遇到的问题与解决方案
- （如有，列出关键错误和修复方法；如无可写"无"）

## 当前状态与未完成事项
- （列出尚未完成的工作，如全部完成写"已全部完成"）

---
对话内容：
${historyText}`;
    try {
      const summary = await this.dependencies.routeCompaction(prompt);
      service.saveSessionSummary(sessionId, summary);
      const lines = summary.split('\n').map(line => line.trim()).filter(Boolean);
      const digestLine = lines.find(line => line.length > 15 && !/^[#\-*]/.test(line));
      const digest = (digestLine || lines[0] || summary).replace(/[#*`]/g, '').trim().slice(0, 150);
      service.updateSessionMeta(sessionId, { digest });
    } catch {
      // Compaction is opportunistic; the uncompressed recent history remains durable.
    }
  }
}

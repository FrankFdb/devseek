# DeepSeek 插件优化计划

> 编写日期：2026-05-13  
> 基准版本：v2.16（已实现）  
> 目标版本：v2.17+（待实现）  
> 依据文档：`需求分析.md v2.17` + `软件设计.md v2.7` + `DEEPSEEK_AGENT_IMPROVEMENT_REQUIREMENTS.md §八`

---

## 一、优化目标与背景

本计划基于对 Copilot 执行 "在 code 目录下写 C 程序打印 hello deepseek plus AI" 全程 7 张截图的逐帧分析与 `workbench.desktop.main.js` / `extension.js` 源码逆向，识别出当前插件与 Copilot 之间的 6 项执行体验差距（G-1 ~ G-6）。

**已对齐项（v2.16 时确认完整）：**

| 项目 | 状态 |
|------|------|
| 多轮 Agent 循环（L-1/L-4） | ✅ 已实现 |
| manage_todo_list + task_complete 工具 | ✅ 已实现 |
| Append 风格任务行（F-4） | ✅ 已实现 |
| Finished with N step(s) 动态标题 | ✅ 已实现 |
| 自动驾驶模式（L-5） | ✅ 已实现 |
| File Changed pe-panel L1/L2/L3 | ✅ 已实现 |
| 多模型 Provider 路由 | ✅ 已实现 |
| 代码块可折叠展开（CSP 安全）| ✅ 已修复 |
| gcc/g++ 自动选择 | ✅ 已修复 |
| Keep/Undo Summary 单气泡合并 | ✅ 已修复 |

**待实现差距（本计划范围）：** G-1 ~ G-6

---

## 二、Sprint 计划

### Sprint G-A【P1 核心体验】— 终端确认内联化 + 程序输出回传

**交付目标**：
1. 终端确认从 VS Code modal 迁移为聊天流内联卡片（G-2）
2. 程序输出作为 tool_result 回传 LLM，使 AI 响应包含实际程序输出（G-4）

---

#### 任务 G-2：终端确认内联卡片

**需求归因**：需求专题 C §G-2  
**架构定位**：UI 交互层（WebView） + Extension Host（执行协调）  
**能力层**：执行层（终端交互审批分离）

**改动范围**：
- `packages/vscode-extension/src/extension.ts`：`onTerminalCommand` 回调（约 line 1203-1220）
- `packages/vscode-extension/media/webview.js`：新增 `terminalConfirm` 消息处理 + 卡片渲染

**具体实现步骤**：

1. **extension.ts 改动**：

```typescript
// 替换 showWarningMessage 为 await-webview-reply 模式
onTerminalCommand: async (command, workdir) => {
  const executionApproval = config.get<'auto' | 'confirm'>('executionApproval', 'auto');
  if (executionApproval === 'auto') {
    return await runInVisibleTerminal(command, { cwd: workdir });
  }
  // confirm 模式：发内联卡片，等待 webview reply
  const confirmId = `tc-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
  return await new Promise<string>((resolve) => {
    pendingTerminalConfirms.set(confirmId, resolve);
    webview.postMessage({ type: 'terminalConfirm', command, workdir, confirmId });
  });
}
```

2. **extension.ts 新增**：`pendingTerminalConfirms: Map<string, Function>` 存储待决 Promise；消息处理器处理 `terminalConfirmReply`。

3. **webview.js 新增**：
   - `handleTerminalConfirm(msg)` → 在 `chatMessages` 末尾插入 `.terminal-confirm-card`
   - 事件委托：`.terminal-confirm-card` 按钮点击 → `vscode.postMessage({ type: 'terminalConfirmReply', ... })`

**回退方案**：若内联卡片 await 超时（>60s），自动降级为拒绝执行，返回"用户超时未响应"。

**验证**：用户发送"编写并运行 C 程序"→ 确认框出现在聊天面板内 → 点击 Allow → 程序执行 → 卡片变灰。

---

#### 任务 G-4：程序输出内联嵌入

**需求归因**：需求专题 C §G-4  
**架构定位**：LLM 输出链（tool_result 回传）  
**能力层**：验证层（闭环信息传递）

**改动范围**：
- `packages/vscode-extension/src/agent-loop.ts`：`runValidation()` 函数（约 line 1308-1330）

**具体实现步骤**：

```typescript
// runValidation() 中程序执行成功后：
const output = await callbacks.onTerminalCommand(runCmd, compilePlan.cwd);
const truncated = output.length > 2000
  ? output.slice(0, 2000) + `\n[输出已截断，共 ${output.length} 字符]`
  : output;

// 将输出追加到 sessionHistory，供 LLM 下一轮感知
if (callbacks.sessionHistory) {
  callbacks.sessionHistory.push({
    role: 'tool',
    content: `程序执行输出：\n\`\`\`\n${truncated}\n\`\`\``,
  });
}
// 同时通过 agentStatus 推送到 Working 区（保留现有逻辑）
callbacks.onAgentStatus?.({ phase: 'validate', state: 'completed', title: '执行完成 ✓', detail: truncated.slice(0, 300) });
```

**验证**：AI 最终响应中包含程序实际输出的引用（如 "编译运行输出：hello deepseek plus AI"）。

---

### Sprint G-B【P2 体验提升】— 推理 Bullet + Allow 下拉

**前置依赖**：Sprint G-A 完成（G-6 依赖 G-2 卡片）

---

#### 任务 G-1：规划推理 Bullet

**需求归因**：需求专题 C §G-1  
**架构定位**：UI 展示层（Working 区）  
**能力层**：规划层（规划过程透明化）

**改动范围**：
- `src/agent-loop.ts`：plan 阶段检测 AI 回复中的推理前缀文字
- `media/webview.js`：新增 `.aut-plan-bullet` 渲染逻辑

**实现要点**：
- 在 `runAgentLoop()` 的 plan 阶段首次 LLM 调用 streaming 中，收集工具调用块 `[TOOL:...]` 之前的纯文字
- 若纯文字非空，发送 `agentStatus { phase: 'plan', planningText: '...' }`
- webview 在 `.aut-rows` 之前插入一个 `.aut-plan-bullet` div（透明度 0.75，不带序号）
- 不计入 N 步统计

---

#### 任务 G-6：Allow 下拉选项

**需求归因**：需求专题 C §G-6  
**依赖**：G-2 内联卡片已实现

**改动范围**：`media/webview.js`（G-2 卡片扩展）

**实现要点**：
- Allow 按钮拆分为 `.tc-allow-group`（Split Button）
- 右侧 `∨` 点击展开 `.tc-dropdown`（含 "Always allow" 等选项）
- "Always allow" → `terminalConfirmReply { alwaysAllow: true }` → extension 写入 `executionApproval=auto` 配置
- 后续 `onTerminalCommand` 检测到 `executionApproval=auto` 时自动跳过确认

---

### Sprint G-C【P3 视觉完整度】— Ran 行 + 编辑器标题覆层

---

#### 任务 G-3：Ran 命令独立行

**改动范围**：
- `extension.ts`：G-2 命令执行完成后发 `{ type: 'terminalRanNotice', command, exitCode }`
- `media/webview.js`：处理 `terminalRanNotice` → 在响应区插入 `.ran-command-row`

**截断规则**：命令超 120 字符截断为 117 + `…`

---

#### 任务 G-5：编辑器标题覆层（方案 A 快速实现）

**改动范围**：`extension.ts`

**实现步骤**：

```typescript
// 监听活跃编辑器变化
const titleBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 999);
vscode.window.onDidChangeActiveTextEditor((editor) => {
  if (!editor) { titleBar.hide(); return; }
  const fsPath = editor.document.uri.fsPath;
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  const relPath = fsPath.startsWith(wsRoot) ? fsPath.slice(wsRoot.length + 1) : '';
  const hasPending = relPath ? [...pendingEdits.values()].some(r => r.path === relPath) : false;
  if (hasPending) {
    titleBar.text = '$(check) Keep  $(discard) Undo';
    titleBar.command = 'deepseek.keepOrUndoActive';
    titleBar.tooltip = '保留或撤销对当前文件的 AI 修改';
    titleBar.show();
  } else {
    titleBar.hide();
  }
});
```

新增命令 `deepseek.keepOrUndoActive`：弹出 QuickPick `['Keep（保留此文件修改）', 'Undo（撤销此文件修改）']` → 执行对应操作 → 通知 webview 更新 pe-panel。

---

## 三、风险与注意事项

| 风险 | 影响 | 缓解方案 |
|------|------|---------|
| G-2 webview ↔ extension Promise 协调复杂度 | 中 | 使用 Map<confirmId, resolve> + 60s 超时兜底 |
| G-4 sessionHistory 不从 runValidation() 可达 | 中 | 通过 callbacks 传入 sessionHistory 引用或返回值传递 |
| G-5 方案 A statusBar 视觉位置偏离 Copilot | 低 | 标注为 "近似方案"，不影响功能 |
| G-2 内联卡片与现有 agentStatus 卡片叠加 | 低 | 确认卡片使用独立 CSS class，不共享 aut-container DOM |

---

## 四、验收标准（Definition of Done）

每个 Sprint 交付前须满足：

- [ ] 代码编译通过，`npm run test` 11 项全部 PASS
- [ ] 主链路验证：用户发送"在 code 目录写 C 程序打印 hello" → 完整执行流程符合 Copilot 截图对标行为
- [ ] 回退链路验证：用户点击 Skip → 程序未执行 → 聊天继续正常工作
- [ ] 需求/设计/CHANGELOG 同步更新
- [ ] 若有高风险改动，备份至 `backups/` 目录

---

## 五、文档关联

| 文档 | 用途 |
|------|------|
| [需求分析.md 专题C](../需求分析.md) | 业务需求规格（G-1 ~ G-6） |
| [软件设计.md §四](../软件设计.md) | 实现规格（类结构/消息协议/CSS） |
| [DEEPSEEK_AGENT_IMPROVEMENT_REQUIREMENTS.md §八](./DEEPSEEK_AGENT_IMPROVEMENT_REQUIREMENTS.md) | 差距详细分析（实现路径）|
| [COPILOT_DISPLAY_STYLE_REFERENCE.md](./COPILOT_DISPLAY_STYLE_REFERENCE.md) | Copilot UI 规范参考 |
| [AUDIT_REPORT_2026-05-12.md](./AUDIT_REPORT_2026-05-12.md) | NLS 字符串与源码验证 |

# DeepSeek Chat UI 风格指南（参考 Copilot 交互范式）

## 目标
将 DeepSeek 插件聊天面板从“单一文本区”升级为“结构化阅读界面”，在不引入重依赖的前提下，提升可读性、信息层次和视觉舒适度。

## 风格类型收集（本次归纳）

1. 会话容器层
- 特征: 弱对比背景、渐变氛围、滚动阅读感。
- 实现: `#messages` 渐变背景 + 气泡间距。

2. 消息卡片层（用户/助手）
- 特征: 用户消息右侧轻气泡；助手消息左侧内容卡，带边界与强调线。
- 实现: `.user-bubble`、`.assistant-bubble`。

3. Markdown 语义层
- 特征: 标题、段落、列表、引用、分割线具备明确视觉语义。
- 实现: `.assistant-bubble h1~h4`、`blockquote`、`hr`、`table`。

4. 代码展示层
- 特征: 代码块为独立卡片，带语言标签、操作区、token 颜色。
- 实现: `.assistant-bubble pre`、`.code-toolbar`、`.code-lang`、`.tok-*`。

5. 功能操作层（可应用文件）
- 特征: 检测提示 + 主次操作按钮，贴近内容上下文。
- 实现: `.generated-files-panel`、`.gfp-btn`。

6. 系统状态层（应用/验证/修正）
- 特征: 状态卡统一表达，按成功/失败切换边框和背景。
- 实现: `.workflow-card.state-*`。

7. 图形内容层（Mermaid）
- 特征: 渲染与源码双视图，支持缩放与复制。
- 实现: `.mermaid-*` 组件族。

8. 交互动效层
- 特征: 新消息轻入场，不抢注意力。
- 实现: `.turn.enter` + `@keyframes turnIn`。

## 当前实现原则
- 主题兼容: 以 VS Code 变量为主，固定色仅用于 token 与状态强调。
- 低侵入: 不引入额外前端框架和高亮库。
- 易维护: 避免内联样式，使用语义化 class 驱动。

## 后续建议
1. 增加“浅色/深色”两套 token 色板映射。
2. 增加代码块折叠、长输出分段展开。
3. 增加消息级引用来源区（文件路径/命令/验证摘要）。
4. 增加用户可配置显示密度（紧凑/舒适）。
---

## 9. 执行过程区（Working Area）

### Copilot 参考行为

| 状态 | 表现 |
|------|------|
| 进行中 | 单条紧凑卡片（小圆点 + 步骤标题 + 可选详情），旧步骤不保留 |
| 完成时 | 卡片消失，原位出现低透明度小字：`已完成 · N步 ∨` |
| 展开时 | 原位内联展开带序号步骤列表（最大高度 250px，可滚动）；点击收起 |

### 当前实现结构

**进行中**：`working-card.compact` 单卡片，仅显示最新步骤（`working-dot`★动画呼吸 + `wi-title` + `wi-detail`）。

**完成后**：`fsr-row` 脚注行，包含：
- `fsr-btn`：触发展开/折叠，透明度 62%，11px 字体；**含失败步骤时变橙色**（`fsr-btn-warn`）。
- `fsr-body`：步骤列表体（左蓝边框 + `fsr-step` 条目）；**展开/折叠通过 CSS max-height 过渡**（`fsr-open` class），不再直接切换 `display`。
- chevron 字符 `›` 通过 CSS `rotate(90deg)` 实现旋转动画，不再字符替换。

**字符计数**：流式阶段 `wi-detail` 显示 `已接收 N 字符`（`rawLen > 0`）或 `正在连接…`。

### CSS 规则摘要

```css
.working-card.compact   { display:flex; align-items:center; gap:8px; padding:6px 10px; }
.working-dot            { width:8px; height:8px; border-radius:50%; animation:wiBlink 1.2s ease-in-out infinite; }  /* 呼吸动画 */
.fsr-row                { padding:0 10px 2px; }
.fsr-btn                { display:inline-flex; opacity:.62; font-size:11px; cursor:pointer; }
.fsr-btn.fsr-btn-warn   { color: rgba(255,190,100,.9); }  /* 含失败步骤时橙色 */
.fsr-btn.fsr-open .fsr-chevron { transform: rotate(90deg); }  /* 旋转动画 */
.fsr-body               { max-height:0; overflow:hidden; border-left:2px solid rgba(99,179,255,.22);
                          transition: max-height .2s ease; }  /* CSS 过渡展开 */
.fsr-body.fsr-open      { max-height:250px; overflow-y:auto; }
.fsr-step               { display:flex; gap:8px; padding:2px 0; }
.fsr-step-num           { font-size:10px; font-weight:700; color:rgba(99,179,255,.65); }
```

### 设计原则

- 进行中阶段：**只显示最新步骤**，不积累历史列表，避免视觉噪音。
- 完成后脚注：低透明度、小字，不阻断主内容阅读。
- 步骤展开/折叠：**原位内联**，不使用浮层或弹窗。
- 单步/无文件时静默跳过，不渲染无意义摘要。

### Working 步骤完整逻辑链（v2.14）

fsr-body 展开后展示所有经历的步骤，覆盖完整执行链：

| 步骤 Key | 标题 | 进入条件 |
|----------|------|----------|
| `request` | 分析请求 | startResponse 时创建；首个 delta 标记 passed |
| `response` | 接收回复 / 生成文件清单 | 首个 delta 创建；endResponse 终态化（completed+字数） |
| `file-detect` | 识别文件变更 | responseMeta 有 artifacts 时直接 passed |
| `apply` | 写入文件 | workflowStatus apply started → completed/failed |
| `validate` | 编译验证 | workflowStatus validate started → passed/failed |
| `repair-round-N` | 自动修复 | workflowStatus repair 每轮独立 key |

**根本修复**：`updateWorkingEntryFromWorkflow` 移至 `shouldRenderWorkflowStatus` 判断之前，使 apply/validate/repair 所有状态（含 passed/completed）均被记录进快照。

**步骤标题简洁化**：`buildWorkingTitle` 不再拼接 `· verb · rawTitle`；失败时才追加 `· 失败`；通过/完成状态由 CSS `state-passed`/`state-completed` 着绿色区分。

---

## 10. 文件变更区（File Changed）

### Copilot 参考行为（L1/L2/L3 三层）

| 层级 | 内容 | 交互 |
|------|------|------|
| L1（摘要行）| `N files changed  +X -Y  [Keep All] [Undo All]` + `▶` 箭头 | 点击展开/折叠 L2 |
| L2（文件列表）| `文件名`（粗体 12px）+ `workspace • dir/`（灰色 10px）+ `+X -Y` | 点击打开 L3 |
| L3（diff）| VS Code 原生 diff 编辑器 | — |

**无每文件 Keep/Undo**：按钮仅在 L1 全局层。

### 当前实现结构

**L1**：`.pe-header`（摘要文字 + `.pe-chevron` 箭头 + `.pe-global-btns`）。

**L2**：`.pe-file-list`（默认 `display:none`，点击 L1 切换展开）；  
每个 `.pe-file-row` 包含 `.pe-basename`（文件名）+ `.pe-dirname`（目录含工作区前缀）+ `.pe-stat`（差异数）。

**工作区前缀**：`window.__wsFolderName` 由 `extension.ts` HTML 模板注入：
```typescript
window.__wsFolderName = ${JSON.stringify(vscode.workspace.workspaceFolders?.[0]?.name ?? '')};
```

`pe-dirname` 格式：`${wsFolderName} • ${relDir}/`。

### CSS 规则摘要

```css
.pe-header              { display:flex; align-items:center; gap:6px; padding:6px 10px; cursor:pointer; }
.pe-chevron             { font-size:10px; transition:transform .15s; }
.pe-file-list           { display:none; }
.pe-file-list.open      { display:block; }
.pe-file-row            { display:flex; align-items:baseline; gap:6px; padding:3px 8px; cursor:pointer; }
.pe-file-row:hover      { background:var(--vscode-list-hoverBackground); }
.pe-basename            { font-weight:600; font-size:12px; }
.pe-dirname             { font-size:10px; opacity:.65; color:var(--vscode-descriptionForeground); }  /* .55→.65 */
.pe-stat                { font-size:10px; margin-left:auto; }
@keyframes peListIn     { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:translateY(0)} }
.pe-list                { animation: peListIn .15s ease-out; }  /* 展开淡入 */
```

### 设计原则

- **操作按钮只在 L1**：文件列表为只读信息展示，降低误操作风险。
- **工作区前缀可读性**：`workspace • dir/` 格式与 Copilot 保持一致。
- **点击文件行打开 diff**：通过 `vscode.postMessage({ type: 'openPendingEdit' })` 触发 L3 diff 编辑器。
- L2 默认折叠，减少初始视觉占用。
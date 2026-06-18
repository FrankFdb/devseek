# DevSeek 仿真人输入测试对策

日期：2026-06-04

## 目标

验证 DevSeek 在真实用户工作流中的显示反馈是否连续、可理解、可追踪：

- 用户像真人一样在输入框输入任务并点击发送。
- DevSeek 面板立即显示开始、计划中、计划完成、执行中、任务完成、最终总结。
- 多个任务按自上而下顺序展示。
- 细节信息使用折叠区显示，不把长日志直接铺满主界面。
- Todos 随每个任务状态更新。
- 过程区自动滚动到底部。
- 不依赖真实 DeepSeek 网页也能稳定回归 UI 行为。

## 不影响正式代码的约束

本测试对策采用“附加测试夹具”方式：

- 不替换 `packages/vscode-extension/media/webview.js`。
- 不替换 `packages/vscode-extension/src/extension.ts`。
- 不改 VS Code 扩展运行时 Provider、Bridge、Agent loop 的正式逻辑。
- 测试运行时只在 `/tmp/devseek-human-input-harness-*`、`/tmp/devseek-extension-host-harness-*`、`/tmp/devseek-bridge-smoke-*` 生成临时夹具、报告和日志。
- 第一层、第二层通过 mock 的 VS Code `postMessage` 和 mock 扩展事件驱动 webview。
- 第三层使用临时端口、临时 token 启动 Bridge，结束时关闭临时 Bridge，不占用正式 `3721` 端口。

本轮新增测试/文档文件：

- `packages/vscode-extension/test/devseek-human-input-harness.mjs`
- `packages/vscode-extension/test/devseek-extension-host-harness.mjs`
- `packages/vscode-extension/test/devseek-bridge-smoke.mjs`
- `scripts/devseek-deepseek-web-e2e.mjs`
- `docs/agent/DEVSEEK_HUMAN_INPUT_TEST_STRATEGY.md`

根目录 `scripts/devseek-*.mjs` 仅保留为兼容转发入口，真实测试代码放在 `packages/vscode-extension/test`。

未替换正式代码，因此不需要备份正式代码。以后如果必须替换正式代码，先按下面策略备份：

```bash
mkdir -p backups/human-input-test-$(date +%Y%m%d-%H%M%S)
cp packages/vscode-extension/media/webview.js backups/human-input-test-$(date +%Y%m%d-%H%M%S)/webview.js
cp packages/vscode-extension/src/extension.ts backups/human-input-test-$(date +%Y%m%d-%H%M%S)/extension.ts
```

## 三层测试策略

### 第一层：离线 UI 事件回放

脚本：`packages/vscode-extension/test/devseek-human-input-harness.mjs`

用途：

- 不访问 DeepSeek。
- 不启动 Bridge。
- 不写 `code/` 目录。
- 不修改真实工作区文件。
- 在临时 HTML 中加载正式 `webview.js`，模拟输入和扩展事件。

覆盖点：

- 输入框键入 prompt 并点击发送后，webview 会发出 `chat` 消息。
- `plan started` 显示为可见过程。
- `plan completed` 显示为可见过程，并带折叠详情。
- 没有 `taskFile/taskId` 的批量 `execute started` 也会显示。
- `todoUpdate` 能显示 `Todos (4/4)`。
- `agentToolActivity` 能显示 read/write/terminal 过程。
- `terminalRanNotice` 输出进入折叠区。
- Thinking summary 不被覆盖：完成后至少保留计划/执行 summary、任务执行 summary、写文件/终端过程。
- 消息区域滚动到底部。
- 最终总结显示在过程区之后。

运行：

```bash
npm run test:human-input --workspace=packages/vscode-extension
```

第一层当前验证结果：

```json
{
  "ok": true,
  "fixture": "/tmp/devseek-human-input-harness-wykbFP/harness.html",
  "checks": {
    "steps": 6,
    "summaries": [
      "任务计划已生成：4 个子任务；开始执行 4 个任务 · 4 steps",
      "Analyzing code · 1 step",
      "Creating 3d_world.cpp · 1 step"
    ],
    "details": 2,
    "terminalDetails": 1,
    "todos": "Todos (4/4)",
    "scrolledToBottom": true
  }
}
```

如果 Chromium 在受限 sandbox 中启动失败，使用允许 GUI/headless 浏览器的环境运行。缺浏览器时先执行：

```bash
npx playwright install chromium
```

### 第二层：VS Code Extension Host 仿真人输入

脚本：`packages/vscode-extension/test/devseek-extension-host-harness.mjs`

用途：

- 验证真实 VS Code webview 容器中的输入、滚动、DOM 渲染。
- 仍然不依赖真实 DeepSeek。
- 使用临时 VS Code 测试扩展加载正式 `webview.js`。
- 测试扩展通过事件注入 mock Provider/Agent 过程。

运行：

```bash
npm run test:extension-host --workspace=packages/vscode-extension -- --run
```

安全说明：`npm run test:extension-host --workspace=packages/vscode-extension` 默认只输出 skip 结果，不会打开真实 VS Code 窗口。需要验证真实 Extension Host/webview 容器时，必须显式追加 `-- --run` 或设置 `DEVSEEK_RUN_EXTENSION_HOST_HARNESS=1`。

当前验证结果：

```json
{
  "ok": true,
  "checks": {
    "steps": 6,
    "summaries": [
      "任务计划已生成：4 个子任务；开始执行 4 个任务 · 4 steps",
      "Analyzing code · 1 step",
      "Creating 3d_world.cpp · 1 step"
    ],
    "details": 2,
    "terminalDetails": 1,
    "todos": "Todos (4/4)",
    "scrolledToBottom": true
  }
}
```

本次重跑中曾遇到 VS Code/Electron 渲染进程崩溃：`renderer process gone (reason: crashed, code: 133)`。脚本已补充 `--no-sandbox`、`--disable-dev-shm-usage`、`--disable-gpu-sandbox` 等测试进程启动参数，并将采集范围收敛到 `#messages`，重跑后真实 Extension Host/webview 容器通过。

本次也修复了“只显示一个信息、开始/执行中信息被覆盖”的回归：`ensureAgentProgressContainer()` 不再在复用容器时覆盖标题；计划/批量执行容器会先完成为独立 Copilot-style summary，再创建任务 Working box；完成 summary 使用容器自己的 `data-finished-label`。

脚本失败诊断：当 VS Code Extension Host 未生成报告时，会输出 `code` 启动参数、退出码、stdout/stderr 尾部以及 VS Code `logs` 目录中的日志尾部，便于区分“DevSeek webview 显示失败”和“宿主 Electron 启动失败”。

实际流程：

1. 启动 Extension Host。
2. 打开临时测试 webview 面板。
3. 在真实 VS Code webview 容器中模拟真人输入。
4. 在 DevSeek 输入框键入：

   ```text
   在code目录下面编写一个三维动画世界C++程序，小孩可以通过鼠标操作各种三维物体，注意使用系统有的能力实现
   ```

5. 点击发送。
6. mock Provider/Agent 返回固定计划和工具调用事件。
7. 断言 DevSeek 面板中按顺序出现：

   - 正在分析任务
   - 任务计划已生成
   - 开始执行 4 个任务
   - Listed/Read/Wrote/Ran 等工具过程
   - Todos 完成数变化
   - terminal 输出折叠详情
   - 最终总结

建议把这一层作为发布前检查，不放进默认 `npm test`，避免 CI 被 VS Code/Electron 环境影响。

### 第三层：真实 DeepSeek 网页 Smoke Test

脚本：`packages/vscode-extension/test/devseek-bridge-smoke.mjs`

用途：

- 验证 Bridge、DeepSeek 网页自动化和真实 DeepSeek 返回链路。
- 只作为 smoke test，不作为稳定 CI 必过项。

原因：

- DeepSeek 网页可能需要登录。
- Cookie 可能过期。
- 页面 DOM 可能变化。
- 网络和验证码会造成不稳定。

建议流程：

1. 先检查临时 Bridge 可启动：

   ```bash
   npm run test:bridge-smoke --workspace=packages/vscode-extension
   ```

2. 如果需要真实网页返回，执行：

   ```bash
   npm run test:bridge-smoke --workspace=packages/vscode-extension -- --chat
   ```

3. 如果出现 `LOGIN_REQUIRED`，使用临时 Bridge 的强校验登录流程：

   ```bash
   npm run test:bridge-smoke --workspace=packages/vscode-extension -- --chat --relogin
   ```

   该命令会打开可见浏览器；用户完成登录/验证后，脚本会在同一个 Bridge 进程里继续真实 chat smoke。

### 第四层：真实 DeepSeek 网页 + DevSeek Webview E2E

脚本：`packages/vscode-extension/test/devseek-human-input-harness.mjs --real-bridge`

用途：

- 真的启动临时 Bridge。
- 真的把“在 code 目录下面编写一个三维动画世界 C++ 程序...”发送给 DeepSeek 网页。
- 通过 Bridge SSE 读取真实 DeepSeek 网页返回的流式 delta。
- 用真实 delta 驱动正式 `packages/vscode-extension/media/webview.js`。
- 断言 DevSeek 面板在真实网页等待/返回过程中显示：
  - 正式发送后立即显示“已收到提示词，正在连接模型...”。
  - DeepSeek 首个真实 delta 到达后显示“接收回复/生成文件清单”和已接收字符进度。
  - 最终 assistant 气泡有真实内容。
  - 消息区滚动到底部。

运行：

```bash
npm run test:deepseek-web-e2e --workspace=packages/vscode-extension
```

如果需要看到 DeepSeek 网页并重新登录：

```bash
npm run test:deepseek-web-e2e --workspace=packages/vscode-extension -- --headed --relogin
```

也可以从仓库根目录运行兼容入口：

```bash
node scripts/devseek-deepseek-web-e2e.mjs --headed --relogin
```

注意：这层不是 mock。若返回 `LOGIN_REQUIRED`，说明 Bridge 保存的登录态失效或网页要求重新登录；需要用 `--headed --relogin` 打开真实浏览器完成登录后再继续。Bridge 现在保存完整 Playwright `storage-state.json`（cookies + localStorage），避免只保存 cookies 导致 headless 下次仍跳回登录页。

第四层当前验证结果：

```json
{
  "ok": true,
  "headed": false,
  "relogin": false,
  "stream": {
    "deltaCount": 202,
    "contentLength": 5389,
    "firstDeltaMs": 7106,
    "finishedMs": 40489
  },
  "ui": {
    "start": "分析请求已收到提示词，正在连接模型…",
    "firstDelta": "生成文件清单已接收 2 字符",
    "finalAssistantLength": 4757,
    "collapsedCodeBlocks": 1,
    "leakedToolText": false,
    "scrolledToBottom": true
  }
}
```

第三层当前验证结果：

```json
{
  "ok": true,
  "port": 47671,
  "cookiesPresent": true,
  "bridgeStatus": {
    "idle": true,
    "queueLength": 0,
    "browserReady": false
  },
  "chat": null
}
```

真实网页 `--chat` 本次验证结果：

```json
{
  "ok": true,
  "cookiesPresent": true,
  "chat": {
    "ok": true,
    "status": 200,
    "contentLength": 5969,
    "message": "DeepSeek 网页返回内容"
  }
}
```

正式手工联调流程：

1. 确认 `~/.devseek-netai/storage-state.json` 或 `~/.devseek-netai/cookies.json` 有效；若失效，先通过 DevSeek 登录按钮或 `/relogin` 流程重新登录。
2. 启动正式 Bridge：

   ```bash
   npm run bridge:start
   ```

3. 打开 VS Code + DevSeek。
4. 真人/Playwright 输入同一条 prompt。
5. 观察并记录：

   - DeepSeek 网页是否返回内容。
   - Bridge 是否持续产生 stream。
   - DevSeek 是否实时显示计划、执行、工具、Todos、完成信息。

如果网页不可控，退回第一层或第二层，用 mock 事件验证 UI 是否正常。

注意：`npm run login --workspace=packages/bridge` 的登录完成判断依赖 `loggedInIndicator`，当前选择器中包含较宽的 `textarea`，登录页也可能误判。第三层自动测试优先使用 `npm run test:bridge-smoke --workspace=packages/vscode-extension -- --chat --relogin`，因为它走 Bridge 内置的强校验登录流程：URL 必须离开登录页并检测到聊天输入框后才继续。

## 断言清单

每次修改 DevSeek 过程显示逻辑后，应至少检查：

- 开始信息不会被吞掉。
- 无 `taskFile/taskId` 的批量执行状态不会被忽略。
- 每个任务完成后 Todos 立即变化。
- 工具过程不会只在最终总结中出现。
- 长详情和终端输出默认折叠。
- 多个任务按时间顺序自上而下出现。
- 面板持续滚动到底部。
- 普通聊天不被强制滚动策略干扰。

## 已实现脚本

- `packages/vscode-extension/test/devseek-human-input-harness.mjs`：离线 UI 事件回放。
- `packages/vscode-extension/test/devseek-human-input-harness.mjs --real-bridge`：真实 DeepSeek 网页 + DevSeek webview E2E。
- `packages/vscode-extension/test/devseek-extension-host-harness.mjs`：真实 Extension Host 自动输入测试。
- `packages/vscode-extension/test/devseek-bridge-smoke.mjs`：真实 Bridge + DeepSeek 网页 smoke test，失败时输出网页登录/网络/DOM 诊断。
- `scripts/devseek-deepseek-web-e2e.mjs`：根目录真实网页 E2E 兼容入口。

这些脚本保持不修改正式代码，只写 `/tmp` 下的临时夹具、报告和日志。

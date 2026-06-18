# DevSeek 智能编程体基础 Case 自闭环测试与交付报告

日期：2026-06-06

## 目标

围绕“优秀智能编程体”的基本工作流，补齐可扩展自闭环测试矩阵，而不是只修复单个失败样例。

参考 Copilot / Codex 类工作方式，本轮测试强调：

- 文件工具必须有可验证写入结果。
- 修改既有程序必须保留原行为并验证新增行为。
- 增量补丁应支持局部修改，而不是每次全量重写。
- 编译失败要进入修复闭环，不能盲目重复编译。
- 终端工具只用于查询、编译、运行、测试，不能绕过文件工具写源码。
- 真实 DeepSeek 网页输出要能经 bridge 转成本地可验证动作。

## 本轮修正

### 扩展自闭环 harness

文件：

- `scripts/devseek-agent-self-loop.mjs`

新增能力：

- `caseCatalog`：集中登记智能编程体基础能力矩阵。
- 本地确定性 case：创建、修改、patch、修复、多文件项目。
- 真实 DeepSeek case：创建新程序、修改既有程序。
- 每次运行持久化：
  - `artifacts/agent-self-loop/<run-id>/report.json`
  - `real-deepseek-prompt.txt`
  - `real-deepseek-response.txt`
  - `real-deepseek-modify-prompt.txt`
  - `real-deepseek-modify-response.txt`

### 保持协议级修正方式

本轮没有针对单次输出硬编码，而是沿用/扩展协议边界：

- 通过 parser/resolver 处理工具调用、markdown 文件、diff。
- 通过本地编译运行结果判定是否完成。
- 通过脚本矩阵防止回归。
- DeepSeek malformed JSON 已由 parser loose tool 解析兜底覆盖。

## Case 矩阵

命令：

```bash
npm run verify:agent-self-loop
```

最终运行留痕：

- `artifacts/agent-self-loop/2026-06-06T08-43-28-745Z/report.json`

| Case | 结果 | 验证点 |
| --- | --- | --- |
| static:agent guard rails for file tools and terminal writes | passed | 文件工具边界、终端写源码拦截、禁止 shell fallback |
| legacy:verify-generated-files script restored | passed | 旧 artifact 验证恢复 |
| local:filePath tool alias -> write -> compile -> run | passed | `filePath` 工具别名，新建 C++ 程序，编译运行 |
| local:modify existing program -> preserve behavior -> add feature -> compile -> run | passed | 既有 calculator 保留 `add` 输出 5，新增 `multiply` 输出 6 |
| local:incremental unified diff patch -> compile -> run | passed | unified diff 局部补丁，输出从 1 变为 2 |
| local:repair compile error -> replace_file -> compile -> run | passed | 先确认编译失败，再应用修复，输出 `REPAIR_OK` |
| local:multi-file C++ hierarchy -> write -> compile -> run | passed | 多文件动物继承项目，编译运行输出 `woof` |
| real-deepseek:create_file tool -> write -> compile -> run | passed | 真实 DeepSeek bridge 输出工具调用，本地落地编译运行 |
| real-deepseek:modify existing program -> replace_file -> compile -> run | passed | 真实 DeepSeek 基于现有源码返回修改，保留旧输出并新增功能 |

真实 DeepSeek 结果：

- 创建程序输出：`DEEPSEEK_AGENT_SELF_LOOP_OK`
- 修改既有程序输出：

```text
5
DEEPSEEK_AGENT_FEATURE_OK:6
```

说明：

- 默认真实 DeepSeek 测试使用 headless Playwright 浏览器，不会显示在用户当前打开的 DeepSeek 标签页中。
- 如需可见模式观察网页自动化过程，可运行：

```bash
node scripts/devseek-agent-self-loop.mjs --headed --keep-temp
```

## 完整验证

已执行并通过：

```bash
npm run compile --workspace=packages/vscode-extension
node test/run-all.mjs
npm run verify:artifacts
npm run verify:agent-self-loop
```

结果摘要：

- Extension compile：通过
- Unit test suite：7/7 passed
- Artifact verification：通过
- Agent self-loop：9/9 passed

## 打包与安装

已执行：

```bash
npm run extension:package
code --install-extension /home/ff/work/devseek_netai/devseek-netai-latest.vsix --force
```

结果：

- VSIX：`/home/ff/work/devseek_netai/devseek-netai-latest.vsix`
- 复制件：`/home/ff/work/devseek_netai/packages/vscode-extension/devseek-netai-latest.vsix`
- 大小：5.3M
- 安装结果：成功
- VS Code 已安装版本：`devseek-netai.devseek-netai@1.0.0`

## 后续建议

- 将 `npm run verify:agent-self-loop` 加入发布前必跑流程。
- 后续继续扩展 case：
  - 跨文件重构。
  - 生成并运行单元测试。
  - 读取错误日志后自动定位修复。
  - 大模型多轮失败恢复策略。
  - 用户中途 steer 后继续完成任务。

# DevSeek 编程智能体自闭环测试与修正报告

日期：2026-06-06

## 结论

本轮针对“DeepSeek 生成了代码意图，但 DevSeek 未正确创建代码并反复编译/循环”的工作流进行了修正与自闭环验证。

最终结果：所有本轮新增和既有关键测试通过，真实 DeepSeek bridge 自闭环 case 通过。

## 修正摘要

### 1. 文件工具字段兼容

问题：

- DeepSeek/Copilot 风格工具调用可能使用 `filePath`，而原执行器只读取 `path`。
- UI 会显示 Writing，但实际执行器拿不到路径，未写文件，也缺少明确错误反馈。

修正：

- `create_file/write_file/replace_file` 支持路径别名：`path/filePath/filepath/filename/targetPath`。
- 支持内容别名：`content/contents/text/body`。
- 缺少路径时返回明确工具反馈：缺少 `path/filePath`，不再静默跳过。

涉及文件：

- `packages/vscode-extension/src/agent-loop.ts`

### 2. 禁止 run_terminal 作为写文件 fallback

问题：

- 旧恢复提示建议 `run_terminal` 通过 `cat/printf` 写文件。
- 这会绕过专用文件工具，使模型进入“写入失败 -> ls/g++ -> 文件不存在 -> 再重试”的循环。

修正：

- 阻止 `run_terminal` 中的源码写入命令：`cat > file`、`echo > file`、`printf > file`、`tee file`。
- 明确反馈：`run_terminal` 仅用于编译、运行、测试、查询。
- 删除“改用 run_terminal 通过 printf 或 cat 写文件”的恢复建议。

涉及文件：

- `packages/vscode-extension/src/agent-loop.ts`
- `packages/vscode-extension/test/unit/workflow-compliance.test.mjs`

### 3. 恢复旧 artifact 验证脚本

问题：

- `scripts/verify-generated-files.mjs` 硬编码旧路径 `/home/ff/work/deepseek_netai`。
- 脚本引用已不存在的 `generated-file-resolver.ts`。

修正：

- 仓库根目录改为基于脚本位置自动推导。
- 新增纯离线 resolver：`packages/vscode-extension/src/generated-file-resolver.ts`。
- 恢复 `npm run verify:artifacts`。

涉及文件：

- `scripts/verify-generated-files.mjs`
- `packages/vscode-extension/src/generated-file-resolver.ts`

### 4. 宽容解析真实 DeepSeek malformed 工具调用

真实自闭环发现：

DeepSeek 按要求输出了工具调用，但 C++ 字符串里的双引号没有 JSON 转义，例如：

```text
[TOOL:create_file {"filePath":"code/deepseek_self_loop/main.cpp","content":"... std::cout << "DEEPSEEK_AGENT_SELF_LOOP_OK" ..."}]
```

严格 JSON 解析失败后，旧逻辑可能把整段工具调用当成源码写入，导致编译失败。

修正：

- `generated-file-parser.ts` 增加 loose parser。
- 对 malformed `create_file/write_file/replace_file` 工具调用，仍可提取目标路径和源码内容。
- 新增单测覆盖未转义 C++ 字符串。

涉及文件：

- `packages/vscode-extension/src/generated-file-parser.ts`
- `packages/vscode-extension/test/unit/generated-file-parser.test.mjs`

### 5. 新增编程智能体自闭环测试

新增脚本：

- `scripts/devseek-agent-self-loop.mjs`
- 根脚本：`npm run verify:agent-self-loop`

说明：

- 默认模式使用 headless Playwright 通过 DevSeek bridge 访问 DeepSeek 网页，因此不会出现在用户当前可见的 DeepSeek 浏览器标签页中。
- DeepSeek 网页只负责返回工具调用文本；文件写入、编译、运行发生在 DevSeek 本地自闭环测试脚本中，不会显示在 DeepSeek 网页对话里。
- 如需观察真实网页自动化过程，可运行：`node scripts/devseek-agent-self-loop.mjs --headed --keep-temp`。
- 每次运行都会在 `artifacts/agent-self-loop/<run-id>/` 保存 `report.json`、`real-deepseek-prompt.txt`、`real-deepseek-response.txt`，用于复查真实 DeepSeek 输入输出。

覆盖能力：

- 文件工具别名兼容：`filePath`。
- 真实落地文件。
- C++ 编译运行。
- 多文件 C++ 项目解析、写入、编译运行。
- 文件工具/终端工具安全边界静态检查。
- 旧 artifact 验证脚本恢复。
- 真实 DeepSeek bridge 输出工具调用后，本地落地、编译、运行。

## 自闭环 Case 结果

命令：

```bash
npm run verify:agent-self-loop
```

结果：通过。

Case 明细：

| Case | 结果 | 验证内容 |
| --- | --- | --- |
| static:agent guard rails for file tools and terminal writes | passed | 文件工具错误反馈、终端写文件拦截、防止 shell fallback 回归 |
| legacy:verify-generated-files script restored | passed | 旧 artifact 验证脚本恢复 |
| local:filePath tool alias -> write -> compile -> run | passed | `filePath` 工具调用落地并编译运行，输出 `DEVSEEK_SELF_LOOP_OK` |
| local:multi-file C++ hierarchy -> write -> compile -> run | passed | 多文件动物继承 C++ 项目落地并编译运行，输出 `woof` |
| real-deepseek:create_file tool -> write -> compile -> run | passed | 真实 DeepSeek bridge 返回工具调用，落地、编译、运行，输出 `DEEPSEEK_AGENT_SELF_LOOP_OK` |

真实 DeepSeek case 摘要：

- `deltaCount`: 7
- 输出预览包含 `[TOOL:create_file ...]`
- 编译命令：`g++ -std=c++17`
- 运行输出：`DEEPSEEK_AGENT_SELF_LOOP_OK`

## 完整验证命令

```bash
npm run compile --workspace=packages/vscode-extension
node test/run-all.mjs
npm run verify:artifacts
npm run verify:agent-self-loop
```

全部通过。

## 后续建议

- 将 `npm run verify:agent-self-loop` 纳入发布前检查。
- 对真实 DeepSeek 输出继续积累 malformed 工具调用样本，优先补 parser 回归测试。
- 后续若扩展 native tool-calling，可保留文本工具 parser 作为 bridge/web fallback。

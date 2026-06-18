# DevSeek 智能编程体同 Session 多轮变更 Case 与自闭环报告

日期：2026-06-06

## 目标

验证智能编程体在真实使用中的连续工作流，而不是只验证“一次输入生成一次代码”。

重点覆盖：

- 第一次输入：完成一次独立编程任务。
- 第二次输入：在同一个 session 内基于第一次程序继续添加功能。
- 后续输入：删除已有功能、变更输出行为、继续维护程序。
- 闭环验证：每轮落地文件后都编译运行。
- 闭环修正：发现编译错误后进入修复轮，而不是重复编译或绕过文件工具。
- 真实 DeepSeek：通过 bridge 在同一个 DeepSeek 网页会话中执行 `newSession: true -> false -> false` 多轮测试。

## 本轮代码修正

文件：

- `scripts/devseek-agent-self-loop.mjs`

修正内容：

- 新增 `local:same session multi-turn create -> add -> delete -> repair -> compile/run each turn`。
- 新增 `real-deepseek:same session create -> add -> delete -> compile/run each turn`。
- 将 bridge chat helper 从固定 `newSession: true` 改为可传入 `newSession`，用于表达“同一 session 继续输入”。
- 新增统一的 `fileToolCall()` 和 `resolveAndWrite()`，后续 case 可以复用工具调用生成、解析、写入和校验流程。
- 真实 DeepSeek 每轮 prompt/response 都落盘，便于复盘和人工审计。

## 基础 Case 矩阵

| ID | 场景 | 智能编程体能力 | 自动验证 |
| --- | --- | --- | --- |
| S01 | 第一次输入创建程序 | 从用户目标生成可编译源码 | 写入 `main.cpp`，编译运行 |
| S02 | 第二次输入添加功能 | 在同一程序上添加功能，并保留旧行为 | 旧输出仍存在，新输出出现 |
| S03 | 后续输入删除功能 | 删除指定功能，不破坏新增功能 | 源码不再包含被删函数，编译运行 |
| S04 | 多次变更输出内容 | 连续维护同一个文件 | 每轮输出和预期一致 |
| S05 | 引入编译错误后修复 | 读取失败结果并进入修复轮 | 先确认编译失败，再修复并通过 |
| S06 | 增量 patch | 支持局部修改，而不是总是全量重写 | patch 后编译运行 |
| S07 | 真实 DeepSeek 同 session | 网页会话连续输入，多轮变更 | `newSession: true -> false -> false` 全部通过 |

## 本地同 Session 多轮 Case

命令：

```bash
npm run verify:agent-self-loop -- --skip-real-deepseek
```

运行结果：

- 通过
- 产物：`artifacts/agent-self-loop/2026-06-06T09-04-23-723Z/report.json`

多轮细节：

| Turn | 操作 | 期望输出 | 结果 |
| --- | --- | --- | --- |
| 1 | 创建 `add/subtract` 程序 | `ADD:5`、`SUB:3` | passed |
| 2 | 同一程序添加 `multiply`，保留旧功能 | `ADD:5`、`SUB:3`、`MUL:6` | passed |
| 3 | 删除 `subtract`，保留 `multiply` | `ADD:5`、`MUL:6`、`DELETE_OK` | passed |
| 4a | 添加 `divide` 时故意引入编译错误 | g++ 编译失败 | passed |
| 4b | 根据编译错误修复程序 | `ADD:5`、`MUL:6`、`DIV:2`、`DELETE_OK` | passed |

最终本地输出：

```text
ADD:5
MUL:6
DIV:2
DELETE_OK
```

## 真实 DeepSeek 同 Session Case

命令：

```bash
npm run verify:agent-self-loop
```

运行结果：

- 通过
- 产物：`artifacts/agent-self-loop/2026-06-06T09-04-48-650Z/report.json`

真实网页会话多轮细节：

| Turn | Bridge 参数 | 操作 | 期望输出 | 结果 |
| --- | --- | --- | --- | --- |
| 1 | `newSession: true` | 创建 C++ 程序 | `DS_SESSION_CREATE_OK` | passed |
| 2 | `newSession: false` | 同一 session 添加 `multiply` | `DS_SESSION_CREATE_OK`、`DS_SESSION_ADD_OK:6` | passed |
| 3 | `newSession: false` | 同一 session 删除第一轮输出，保留第二轮功能 | `DS_SESSION_ADD_OK:6`、`DS_SESSION_DELETE_OK` | passed |

真实 DeepSeek 最终输出：

```text
DS_SESSION_ADD_OK:6
DS_SESSION_DELETE_OK
```

真实 DeepSeek 留痕文件：

- `artifacts/agent-self-loop/2026-06-06T09-04-48-650Z/real-deepseek-session-turn1-prompt.txt`
- `artifacts/agent-self-loop/2026-06-06T09-04-48-650Z/real-deepseek-session-turn1-response.txt`
- `artifacts/agent-self-loop/2026-06-06T09-04-48-650Z/real-deepseek-session-turn2-prompt.txt`
- `artifacts/agent-self-loop/2026-06-06T09-04-48-650Z/real-deepseek-session-turn2-response.txt`
- `artifacts/agent-self-loop/2026-06-06T09-04-48-650Z/real-deepseek-session-turn3-prompt.txt`
- `artifacts/agent-self-loop/2026-06-06T09-04-48-650Z/real-deepseek-session-turn3-response.txt`

说明：

- 默认使用 headless Playwright 浏览器执行，不会显示在用户当前打开的 DeepSeek 标签页。
- 如需肉眼观察真实网页过程，可以运行：

```bash
node scripts/devseek-agent-self-loop.mjs --headed --keep-temp
```

## 完整闭环结果

完整自闭环共 11 个 case，全部通过：

| Case | 结果 |
| --- | --- |
| static:agent guard rails for file tools and terminal writes | passed |
| legacy:verify-generated-files script restored | passed |
| local:filePath tool alias -> write -> compile -> run | passed |
| local:modify existing program -> preserve behavior -> add feature -> compile -> run | passed |
| local:same session multi-turn create -> add -> delete -> repair -> compile/run each turn | passed |
| local:incremental unified diff patch -> compile -> run | passed |
| local:repair compile error -> replace_file -> compile -> run | passed |
| local:multi-file C++ hierarchy -> write -> compile -> run | passed |
| real-deepseek:create_file tool -> write -> compile -> run | passed |
| real-deepseek:modify existing program -> replace_file -> compile -> run | passed |
| real-deepseek:same session create -> add -> delete -> compile/run each turn | passed |

## 结论

本轮新增测试已经覆盖智能编程体最常见的连续交互路径：

- 首轮创建程序。
- 同一 session 第二轮添加功能。
- 后续轮删除功能。
- 多次变更同一文件。
- 编译失败后修复。
- 真实 DeepSeek 网页同 session 多轮闭环。

这套修正方式不是针对单个失败样例硬编码，而是把“多轮变更、文件落地、编译运行、失败修复”抽象成可复用自闭环 case，后续可以继续扩展到跨文件重构、生成单元测试、读取测试失败日志后自动修复等更复杂的智能编程体能力。

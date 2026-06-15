# DevSeek 意图识别与工具展示测试报告

日期：2026-06-15

用途：作为人工实测 DevSeek 插件时的对照报告，重点验证 `hello/ello` 意图识别、历史 session 记忆污染、附件内容污染、工具执行内容泄露、自动应用门禁和工具权限边界。

## 自动化验证结果

本报告中的 case 已通过实现级自动化测试：

| 验证项 | 命令 | 结果 |
|---|---|---|
| 意图行为矩阵 | `node --test test/unit/intent-behavior-matrix.test.mjs` | PASS，25/25 |
| Webview 工具泄露回归 | `node --test test/unit/webview-logic.test.mjs` | PASS，30/30 |
| Fake tool parser | `node --test test/unit/fake-tool-parser.test.mjs` | PASS，4/4 |
| Extension 全量单测 | `npm test --workspace=packages/vscode-extension` | PASS，17 suites |
| Bridge 单测 | `npm test --workspace=packages/bridge` | PASS，7/7 |
| Bridge build | `npm run build --workspace=packages/bridge` | PASS |
| Extension compile | `npm run compile --workspace=packages/vscode-extension` | PASS |
| VSIX 打包 | `npm run extension:package` | PASS |
| VSIX 安装 | `code --install-extension /home/ff/work/devseek_netai/devseek-netai-latest.vsix --force` | PASS |

已安装扩展 ID：`devseek-netai.devseek-netai`

VSIX：`/home/ff/work/devseek_netai/devseek-netai-latest.vsix`

## 核心判定规则

1. 纯问候，例如 `hello`、`ello`、`你好`，必须识别为 `smalltalk`，不进入 Agent，不允许任何工具，不显示文件变更面板。
2. 意图识别必须优先使用用户可见输入，不被附件正文、历史 prompt、工具 transcript 污染。
3. 历史 session 学习结果不能把当前 `smalltalk/qa` 升级成 `code-change`。
4. `解释/分析` 是只读场景；`方案/计划/架构` 是 plan 场景；`创建/修改/修复` 是 edit 场景；`运行/编译/测试` 是 run 场景；`删除/重置` 是危险场景。
5. 用户可见回复中不得出现 `[TOOL:...]`、`Calling run_terminal`、`manage_todo_list`、`create_file`、`run_terminal` 等内部工具调用内容。

## 人工实测方法

1. 重新加载 VS Code 窗口，确保使用最新安装的 VSIX。
2. 打开 DevSeek 面板，建议每组 case 使用新会话；涉及历史污染的 case 可先执行一次“创建 Hello World 程序”再发送 `hello`。
3. 观察聊天区回复、Agent 工作区、文件变更区、终端确认提示。
4. 对照下表填写“人工结果”和“备注”。

## 测试 Case 矩阵

| ID | 输入/上下文 | 期望意图 | 期望工作流 | 期望工具权限 | 期望界面表现 | 自动结果 | 人工结果 | 备注 |
|---|---|---|---|---|---|---|---|---|
| INT-001 | `hello` | `kind=chat`, `mode=smalltalk` | `plain-chat`, `useAgent=false` | `read/edit/terminal=deny` | 回复 `Hello! 我在。`；不创建文件；不显示工具内容 | PASS | 待测 |  |
| INT-002 | `ello` | `kind=chat`, `mode=smalltalk` | `plain-chat`, `useAgent=false` | `read/edit/terminal=deny` | 回复 `Hello! 我在。`；不得识别为 Hello World 编程任务 | PASS | 待测 |  |
| INT-003 | `你好` | `kind=chat`, `mode=smalltalk` | `plain-chat`, `useAgent=false` | `read/edit/terminal=deny` | 回复 `你好，我在。`；不进入 Agent | PASS | 待测 |  |
| ATT-001 | 附件 `main.cpp`，用户可见输入为 `hello`；附件内容包含 C++ Hello 代码 | `kind=chat`, `mode=smalltalk` | `plain-chat`, `useAgent=false` | 全部工具 deny | 只按可见 `hello` 路由；附件内容不得触发编程任务 | PASS | 待测 |  |
| HIST-001 | 历史已有 `code-change` 习惯后发送 `hello` | `kind=chat`, `mode=smalltalk` | `plain-chat`, `useAgent=false` | 全部工具 deny | 历史记忆不得把 `hello` 升级为代码变更 | PASS | 待测 |  |
| HIST-002 | 历史已有 `code-change` 习惯；当前发送 `hello` 且仍有文件上下文 | `kind=chat`, `mode=smalltalk` | `plain-chat`, `useAgent=false` | 全部工具 deny | 即使有文件上下文，也不得进入 Agent | PASS | 待测 |  |
| HIST-003 | 用户可见输入 `hello`；prompt/历史中混有 `[TOOL:manage_todo_list]`、`[TOOL:run_terminal]` | `kind=chat`, `mode=smalltalk` | `plain-chat`, `useAgent=false` | 全部工具 deny | 可见 `hello` 优先；工具 transcript 不参与意图升级 | PASS | 待测 |  |
| QA-001 | `什么是单例模式？` | `kind=chat`, `mode=qa` | `plain-chat`, `useAgent=false` | 全部工具 deny | 普通问答；不打开工具、不生成文件 | PASS | 待测 |  |
| QA-002 | `介绍一下 React` | `kind=chat`, `mode=qa` | `plain-chat`, `useAgent=false` | 全部工具 deny | 普通问答；不进入 Agent | PASS | 待测 |  |
| READ-001 | `不要修改，只分析这个文件`，带文件上下文 | `kind=chat`, `mode=inspect`，含 `explicit-no-change` blocker | `plain-chat`, `useAgent=false` | `read/search/diagnostics=allow`, `edit/terminal=deny` | 只分析，不修改，不运行 | PASS | 待测 |  |
| READ-002 | `解释这段代码`，带文件上下文 | `kind=chat`, `mode=inspect` | `inspect-agent`, `useAgent=true` | `read/search/diagnostics=allow`, `edit/terminal=deny` | 可读取/分析文件；不得改文件或运行终端 | PASS | 待测 |  |
| PLAN-001 | `给出这个项目的重构方案`，带项目文件上下文 | `kind=chat`, `mode=plan` | `plan-agent`, `useAgent=true` | `read/search/diagnostics/plan=allow`, `edit/terminal=deny` | 输出方案/计划；不得直接修改代码 | PASS | 待测 |  |
| PLAN-002 | `给出这个项目的重构方案，先不要修改代码`，带项目文件上下文 | `kind=chat`, `mode=inspect`，含 `explicit-no-change` blocker | `plain-chat`, `useAgent=false` | `read/search/diagnostics=allow`, `plan/edit/terminal=deny` | 明确不修改时，不进入可变更流程 | PASS | 待测 |  |
| EDIT-001 | `创建一个 hello world C++ 程序并运行` | `kind=code-change`, `mode=edit` | `edit-agent`, `useAgent=true` | `read/edit=allow`, `terminal=requireConfirm` | 可创建文件；运行终端前应受确认策略约束；不得显示原始 `[TOOL:...]` | PASS | 待测 |  |
| EDIT-002 | `编写一个 C++ 程序，打印 hello` | `kind=code-change`, `mode=edit` | `edit-agent`, `useAgent=true` | `read/edit=allow`, `terminal=requireConfirm` | 可进入编辑流程；应生成 C++ 文件候选 | PASS | 待测 |  |
| EDIT-003 | `修复 main.cpp 编译错误` | `kind=code-change`, `mode=edit` | `edit-agent`, `useAgent=true` | `read/edit=allow`, `terminal=requireConfirm` | 优先识别为修复/编辑，不是单纯 run | PASS | 待测 |  |
| RUN-001 | `运行测试` | `kind=code-change`, `mode=run` | `run-agent`, `useAgent=true` | `read=allow`, `edit=deny`, `terminal=requireConfirm` | 可运行测试；不得改文件 | PASS | 待测 |  |
| RUN-002 | `编译 code/hello.cpp` | `kind=code-change`, `mode=run` | `run-agent`, `useAgent=true` | `read=allow`, `edit=deny`, `terminal=requireConfirm` | 可编译；不得改文件 | PASS | 待测 |  |
| DANGER-001 | `删除 code/main.cpp` | `kind=code-change`, `mode=destructive`, `requiresConfirmation=true` | `confirmation-required`, `useAgent=false` | `read/edit/terminal/vscode-command=requireConfirm` | 不得直接执行删除；必须走确认 | PASS | 待测 |  |
| CTRL-001 | 强制 no-agent 模式下输入 `修改 main.cpp` | `kind=code-change`, `mode=edit` | `plain-chat`, `useAgent=false` | `read/edit=allow`, `terminal=requireConfirm` | 不进 Agent，但保留编辑意图和权限策略 | PASS | 待测 |  |
| ART-001 | QA 回复中包含代码块，例如问 `什么是 Hello World 程序？` | `kind=chat`, `mode=qa` | `plain-chat` | 全部工具 deny | 即使回复有代码块，也不得自动加入文件变更队列 | PASS | 待测 |  |
| ART-002 | 历史污染后发送 `hello`，回复中疑似包含 artifact | `kind=chat`, `mode=smalltalk` | `plain-chat` | 全部工具 deny | 不自动 apply；不显示文件候选 | PASS | 待测 |  |
| ART-003 | `创建 code/hello.cpp`，模型回复标准文件 artifact | `kind=code-change`, `mode=edit` | `edit-agent` | `edit=allow` | 可识别为可应用文件变更候选 | PASS | 待测 |  |
| TOOL-001 | 回复流中连续出现 `[TOOL:manage_todo_list]`、`[TOOL:create_file]`、`[TOOL:run_terminal]` | 不适用 | 不适用 | 不适用 | 用户聊天气泡中这些工具块必须完全隐藏 | PASS | 待测 |  |
| TOOL-002 | 普通文本中夹着 `[TOOL:run_terminal {"command":"npm test"}]` | 不适用 | 不适用 | 不适用 | 工具块隐藏；前后普通文本保留，且无多余空白 | PASS | 待测 |  |

## 重点人工观察项

- `hello` 和 `ello`：不能再自动变成“创建 Hello World 程序”。
- 历史会话：执行过 Hello World 创建任务后，再发送 `hello`，仍应是普通问候。
- 附件会话：即使附带 `hello.cpp/main.cpp`，只要用户可见输入是 `hello`，仍应是普通问候。
- 工具内容：聊天正文中不能出现 `[TOOL:...]`、`manage_todo_list`、`create_file`、`run_terminal`、命令 JSON。
- 方案类请求：`给出重构方案` 应输出方案，不应直接改文件。
- 明确只分析/不要修改：不得进入编辑、运行、自动 apply。
- 删除/重置类请求：不得直接执行，必须确认。


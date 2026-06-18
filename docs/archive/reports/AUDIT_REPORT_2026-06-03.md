# DevSeek NetAI 项目审计报告（2026-06-03）

## 1. 审计范围

- 项目根目录：`/home/ff/work/devseek_netai`
- 文档目录：`docs/`
- 重点源码：
  - `packages/vscode-extension/src/`
  - `packages/vscode-extension/media/webview.js`
  - `packages/bridge/src/`
  - `scripts/`
- 未纳入深度审计：
  - `node_modules/`
  - `backups/`
  - `.vsix` 打包产物

说明：当前 `.git` 目录无法作为正常 Git 仓库读取，因此本报告基于工作区文件现状、文档、源码和可运行验证命令，不基于提交历史。

## 2. 当前项目状态

项目已从 README 所描述的“DeepSeek 网页版 Bridge + VS Code Chat MVP”演进为较复杂的本地编程智能体：

- Bridge 层：Express + Playwright，提供 `/chat`、`/cancel`、`/relogin`、`/preattach`、`/index/file`、`/index/search`、`/shutdown`。
- Extension Host 层：支持 Chat、Agent 模式、任务分解、多轮修复、本地执行、pending edit、Keep/Undo、会话记忆、Provider 切换、MCP、图片输入等能力。
- WebView 层：已实现 Copilot 风格的 Working/Todos/File Changes/Session UI。
- 文档层：存在需求、设计、变更闸门、Agent 专项文档与历史审计报告，但多份活跃文档已落后于代码。

验证结果：

- `npm run compile --workspace=packages/vscode-extension`：通过。
- `npm run build --workspace=packages/bridge`：通过。
- `npm test --workspace=packages/vscode-extension`：
  - 沙箱内失败，原因是测试内部 `spawnSync /bin/sh` 触发 EPERM。
  - 授权在沙箱外重跑后通过：6 个 suite 全部通过。

总体判断：项目具备较完整的智能体能力雏形，但当前主要风险不在“能否编译”，而在配置命名漂移、安全边界、写入治理一致性、文档可信度和架构复杂度继续扩大。

2026-06-03 本轮优化状态：

- 已处理 P0-1：扩展侧 VS Code 配置统一为 `devseek.*`，并增加旧 `deepseek.*` 设置迁移。
- 已处理 P0-2：`devseek.protectedFiles` 检查已下沉到统一文件应用层。
- 暂不处理 P0-3：按用户要求，Bridge 保持 DeepSeek 网页版免费通道现状，不引入鉴权改造。

## 3. 主要问题

### P0-1 配置命名严重漂移，导致用户设置可能不生效（已处理）

证据：

- `packages/vscode-extension/package.json:198` 起贡献的是 `devseek.serverPort`、`devseek.provider`、`devseek.apiKey`、`devseek.autopilotMode` 等配置。
- 审计时运行时代码大量读取 `vscode.workspace.getConfiguration('deepseek')`，与贡献配置不一致。
- 本轮已改为读取 `vscode.workspace.getConfiguration('devseek')`，旧 `deepseek.*` 只保留在迁移函数中读取一次。
- README 又示例使用 `devseek.serverPort`，而需求文档使用 `devseek.serverPort`。

影响：

- 已修复前：用户在 VS Code 设置 UI 里看到并填写 `devseek.*`，但运行时读取 `deepseek.*`，关键配置可能被忽略。
- 已修复后：运行时读写、配置贡献、主要文档均指向 `devseek.*`；旧值通过迁移函数复制到新命名空间。

建议：

- 选定唯一命名空间，建议统一为插件名 `devseek.*`，或保留 `deepseek.*` 但同步 package contribution。
- 增加一次性迁移：启动时检测旧键并迁移到新键，显示一次提示。
- 为配置键一致性增加静态测试：扫描 `package.json contributes.configuration.properties` 与 `getConfiguration(...).get(...)`。

### P0-2 `devseek.protectedFiles` 保护存在绕过路径（已处理）

证据：

- 受保护文件检查定义在 `packages/vscode-extension/src/extension.ts:203`。
- Agent fake tool / SEARCH-REPLACE 写入路径会通过 `onBeforeFileWrite` 检查，例如 `agent-loop.ts:928`、`agent-loop.ts:1201`、`agent-loop.ts:2355`。
- 审计时通用自动应用路径直接调用 `applyGeneratedArtifactsWithPrompt()`，写入发生在 `workspace-applier.ts:178-185`，该模块不检查 `protectedFiles`。
- 多处入口会走该通用路径：
  - WebView `applyGeneratedFiles`：`extension.ts:882`
  - 本地执行失败后的修复：`extension.ts:2823`
  - 普通聊天自动应用：`extension.ts:2912`
  - 闭环修复：`extension.ts:3019`
  - Agent fallback：`agent-loop.ts:2444`、`agent-loop.ts:2480`

影响：

- 已修复前：用户配置 `.env`、`**/*.pem`、生产配置等保护规则后，部分 AI 写入路径仍可绕过保护。
- 已修复后：`workspace-applier.ts` 写盘前统一调用 `isFileProtected()`，命中 `devseek.protectedFiles` 时整批应用被阻止。

建议：

- 将保护检查下沉到 `workspace-applier.ts` 的 `applyPreparedChanges()`，使所有写入统一经过同一策略。
- `onBeforeFileWrite` 仍可保留作为 UI 确认层，但不应是唯一防线。
- 增加测试：`applyGeneratedArtifactsWithPrompt()` 对受保护路径必须拒绝写入。

### P0-3 Bridge 本地 HTTP 服务缺少请求认证和 CSRF 防护

证据：

- Bridge 只检查来源 IP 是否包含 `127.0.0.1` / `::1` / `localhost`：`packages/bridge/src/server.ts:57-64`。
- `/cancel`、`/shutdown`、`/relogin` 是无鉴权状态变更接口：`server.ts:90`、`server.ts:99`、`server.ts:107`。
- `/index/file`、`/index/search` 暴露工作区文件读取与搜索：`server.ts:270`、`server.ts:338`。

影响：

- 任意本机进程可访问 Bridge。
- 浏览器中的恶意页面即使不能读取响应，也可能通过跨站请求触发 `/shutdown`、`/cancel`、`/relogin` 等副作用。
- 如果未来加入更宽松 CORS 或新增简单请求入口，风险会扩大到文件读取和聊天调用。

建议：

- Bridge 启动时生成随机 token，由 Extension 通过 header 传递，例如 `X-DevSeek-Token`。
- 对所有非 `/ping` 请求强制 token 校验。
- 状态变更接口校验 `Origin` / `Sec-Fetch-Site`，拒绝浏览器跨站来源。
- `/index/file` 使用 `fs.realpathSync` 校验真实路径，避免工作区内符号链接指向外部文件。

### P1-1 自动应用后验证失败不会自动回滚

证据：

- 写入在验证前完成：`workspace-applier.ts:178-185`。
- 验证失败时只返回 `validation.ok=false`，并不调用回滚：`workspace-applier.ts:217` 后。
- 文件中存在 `rollbackPreparedChanges()`：`workspace-applier.ts:604`，但当前未被调用。

影响：

- “自动验证失败 -> 继续修复”期间，工作区已经处于失败状态。
- 若闭环修复失败、用户中断、Bridge 登录过期或进程异常，用户需要依赖 pending edit 手动 Undo；这不是完整的失败事务。

建议：

- 明确策略二选一：
  - 自动应用路径改为 staging，验证通过后再写入。
  - 或验证失败时自动回滚，并把修复草案留在 review queue。
- 如果继续采用当前“先写入再修复”，需要在文档中降低承诺，不要描述为强回滚闭环。

### P1-2 本地命令执行安全策略过窄

证据：

- `execution-planner.ts:70` 使用 `cp.exec(plan.command)` 执行自动推导命令。
- `tools/terminal.ts:38-49` 仅以少量正则拦截危险命令。
- `tools/terminal.ts:64-72` 会自动改写 `sudo apt install` 为非交互安装。

影响：

- 黑名单式命令安全难以覆盖 `curl | sh`、反引号、命令替换、重定向到敏感文件、fork bomb、环境变量投毒等场景。
- 自动改写 `sudo apt install` 可能超出用户预期，也不适合默认 agent 自动执行。

建议：

- 对 agent 自动执行命令采用 allowlist：编译、测试、只读诊断命令优先。
- `sudo`、网络下载、包管理器安装、写入系统目录等动作一律强制确认。
- 用 `spawn(file,args)` 执行可结构化命令，减少 shell 注入面；仅用户明确输入的 shell 命令走 shell。

### P1-3 WebView CSP 过宽，图片源允许任意网络地址

证据：

- CSP 为 `img-src * data:`：`extension.ts:3241-3246`。
- 同一 WebView 渲染 AI 输出与 Mermaid、Markdown 内容。

影响：

- AI 输出若能影响图片 URL，可能造成隐式网络请求和工作环境信息泄露。
- 与 VS Code WebView 推荐的最小资源白名单不一致。

建议：

- 改为 `img-src ${webview.cspSource} data: https:`，如无必要不要允许 `http:` 与任意 scheme。
- 对 Markdown 渲染后的 HTML 继续做严格 sanitize，禁止事件属性、iframe、script、style 注入。

### P1-4 多根工作区仍存在 fallback 写错根的风险

证据：

- `findWorkspaceFolderForRelativePath()` 无法匹配时仍返回 `folders[0]`：`workspace-roots.ts:57`。
- 多处写入和恢复依赖 `resolveWorkspaceFileUri()`：`extension.ts:395`、`extension.ts:577`。

影响：

- 文档记录已经多次修复“多根写错根”问题，但 fallback 仍可能在新文件、同名目录、提示缺少明确路径时把文件写入第一个 workspace。
- 这类问题通常不被编译测试覆盖，只有用户真实多根场景才暴露。

建议：

- 对低置信度路径不要自动写入，改为提示用户选择 workspace folder。
- `PreparedChange` 增加 `workspaceFolder` 与 `confidence`，写入前展示路径决策。
- 建立多根工作区路径解析单元测试。

### P1-5 文档与代码严重不同步

证据：

- `docs/README.md` 最后更新为 `2026-05-09`，但代码与变更闸门已有 5 月下旬能力。
- `docs/TOP_AGENT_CHANGE_GATE.md:65` 标称“最近 5 条”，实际记录超过 5 条。
- `docs/需求分析.md:822-828` 仍写 `deepseek.explain` 等命令，但 `package.json` 注册的是 `devseek.explain`。
- `docs/需求分析.md:906-917` 仍称 Agent Mode 规划/读取/多文件 Diff 未实现，但代码和测试已包含 Agent loop、Todo、File Changes、Checkpoint 等能力。
- README 的配置示例使用 `devseek.*`，需求/设计和代码又大量使用 `deepseek.*`。

影响：

- 新会话恢复时容易被错误文档引导。
- 用户安装、配置、排障会出现“照文档设置但不生效”。
- 变更闸门作为治理文档的可信度下降。

建议：

- 将本报告列为新的活跃审计报告，并在 `docs/README.md` 加入索引。
- 先做一次“文档事实校准”专项，不做功能变更，只统一命名、状态、版本和验收标准。
- `TOP_AGENT_CHANGE_GATE.md` 第 6 节改为最近 5 条，其余迁移到 archive。

### P2-1 包体与仓库卫生需要收敛

观察：

- 仓库根、`packages/vscode-extension/` 下存在多个 `.vsix`。
- `packages/bridge/dist`、`packages/vscode-extension/dist`、`node_modules` 均在工作区中。
- `backups/` 中保留大量历史源码和打包产物。

影响：

- 审计、搜索、打包、上下文构建都容易被历史文件和依赖噪声污染。
- 智能体读取代码时更容易引用旧实现。

建议：

- 明确源码、产物、备份的边界。
- 文档中要求 agent 搜索默认排除 `node_modules`、`dist`、`backups`、`.vsix`。
- 如果仓库要正式维护，补齐 `.gitignore` 与发布产物管理策略。

## 4. 优先级修复路线

1. P0：统一配置命名空间，补迁移和静态测试。
2. P0：把 `protectedFiles` 下沉到统一写入层，补绕过测试。
3. P0：Bridge 加 token 鉴权与 Origin / Fetch Metadata 防护。
4. P1：明确自动应用失败事务策略，真正接入 rollback 或 staging。
5. P1：收紧本地命令执行策略，区分自动 allowlist 与用户确认命令。
6. P1：修正多根 workspace fallback，低置信度路径进入人工选择。
7. P1：文档事实校准，统一 README / 需求 / 设计 / CHANGELOG / 变更闸门。

## 5. 建议新增测试

- 配置一致性测试：`package.json` 贡献键与源码读取键必须一致。
- 受保护文件测试：所有写入入口对 `.env`、`**/*.pem`、生产配置都拒绝或确认。
- Bridge 安全测试：无 token 请求除 `/ping` 外全部拒绝。
- 多根工作区测试：相同相对路径、同名 basename、新建文件均不应默认落到 `folders[0]`。
- 自动应用失败测试：验证失败时应满足“已回滚”或“pending queue 可完整恢复”的明确判据。

## 6. 结论

DevSeek NetAI 目前已经具备可用的编程智能体骨架，并且编译与现有单测通过。但项目现状呈现出典型的快速迭代后遗症：能力增长快于治理收口，文档承诺、配置命名、安全边界和写入策略没有完全统一。

下一轮最值得做的不是继续堆功能，而是做一次“控制面收敛”：配置统一、写入统一、Bridge 鉴权、文档事实校准。完成这四件事后，后续继续扩展 Agent 能力会稳很多。

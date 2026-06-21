# DevSeek 运行方式说明

本文档整理 DevSeek 当前支持的主要运行方式：VS Code 插件、CLI、Bridge/DeepSeek 网页模式、自动化验证和手动测试。除特别说明外，命令均在仓库根目录执行：

```bash
cd /home/ff/work/devseek_netai
```

## 1. 依赖准备

首次拉取或依赖变更后执行：

```bash
npm install --ignore-scripts
```

如果修改了 `packages/shared`、CLI、Bridge 或 VS Code extension 的公共协议代码，建议先构建共享包：

```bash
npm run shared:build
```

## 2. VS Code 插件运行

这是 DevSeek 的主要使用形态，适合验证完整的 VS Code 聊天界面、任务列表、文件差异确认、QualityGate、恢复横幅和人工交互。

### 2.1 构建并安装最新 VSIX

```bash
npm run verify:phase10
npm run extension:package
code --install-extension /home/ff/work/devseek_netai/devseek-netai-latest.vsix --force
```

安装后重载 VS Code 窗口，在 DevSeek 插件入口中执行测试或真实任务。

### 2.2 手动测试入口

手动测试用例文档：

```text
/home/ff/work/devseek_netai/docs/testing/vscode-phase-manual-test-cases.md
```

VS Code 插件层的 WebView 展示、按钮位置、任务状态、差异确认、Provider 登录恢复等问题，仍以手动测试为准。

## 3. CLI Mock 模式

CLI Mock 模式不依赖真实 Provider，适合快速验证 DevSeek 的无界面 Agent 核心、命令参数、JSONL 输出和自动化脚本接入。

### 3.1 构建 CLI

```bash
npm run shared:build
npm run cli:typecheck
npm run cli:build
```

### 3.2 一次性文本输出

```bash
node packages/cli/dist/index.js exec --mock "phase10 cli text smoke"
```

期望输出类似：

```text
mock: phase10 cli text smoke
```

### 3.3 指定工作目录

```bash
node packages/cli/dist/index.js exec --cwd /home/ff/work/devseek_netai --mock "检查当前项目"
```

`--cwd` 用于模拟用户在不同项目目录中运行 DevSeek。

## 4. CLI JSONL 模式

JSONL 模式适合自动化测试和外部系统集成。每一行都是一个独立 JSON 事件，便于脚本解析。

```bash
node packages/cli/dist/index.js exec --jsonl --mock "phase10 cli jsonl smoke"
```

常见事件包括：

```text
chat.started
provider.selected
provider.status
chat.completed
```

建议后续完整逻辑回归优先使用 CLI JSONL，因为它比截图和自然语言输出更稳定。

## 5. CLI 交互模式

交互模式适合在终端中连续对话和验证会话恢复。

```bash
node packages/cli/dist/index.js --mock
```

常用命令：

```text
:history   查看历史会话
:resume    恢复最近会话
:exit      退出
```

CLI 历史默认写入当前工作目录下：

```text
.devseek/cli-history.jsonl
```

## 6. CLI Bridge / DeepSeek 网页模式

该模式通过 Bridge 连接真实 DeepSeek 网页 Provider，适合做端到端冒烟验证。它能更接近真人操作 DeepSeek 网页，但不适合作为完全确定性的回归测试，因为真实网页存在登录、验证码、限流、网络和模型输出波动。

### 6.1 启动 Bridge

```bash
npm run bridge:build
npm run bridge:dev
```

如果 Bridge 要求登录，请在弹出的浏览器中完成 DeepSeek 登录。

如果启动时报错 `EADDRINUSE: address already in use 127.0.0.1:3721`，表示已有 Bridge 或其他进程占用了默认端口。先确认占用者：

```bash
ss -ltnp 'sport = :3721'
lsof -nP -iTCP:3721 -sTCP:LISTEN
```

常见处理方式：

```bash
# 方式一：如果确认已有 Bridge 正常运行，直接复用它，不需要再次启动 bridge:dev。

# 方式二：如果确认是旧 Bridge 进程，先停止它，再重新启动。
kill <pid>
npm run bridge:dev

# 方式三：保留旧进程，换端口启动和调用。
DEVSEEK_BRIDGE_PORT=3722 npm run bridge:dev
DEVSEEK_BRIDGE_PORT=3722 node packages/cli/dist/index.js exec "请简短回复 bridge smoke"
```

### 6.2 CLI 调用真实 Provider

另开一个终端执行：

```bash
node packages/cli/dist/index.js exec "请简短回复 phase10 bridge smoke"
```

如果真实 DeepSeek 网页响应较慢，CLI text 模式会在 stderr 输出等待提示，例如：

```text
DevSeek: waiting for Bridge provider response...
```

最终模型内容仍输出到 stdout，便于脚本区分状态提示和结果文本。

如果使用自定义端口：

```bash
DEVSEEK_BRIDGE_PORT=3721 node packages/cli/dist/index.js exec "请简短回复 phase10 bridge smoke"
```

Bridge token 默认保存在当前工作目录：

```text
.devseek/bridge-token
```

客户端请求会通过 `X-DevSeek-Token` 与 Bridge 鉴权。

## 7. Bridge 独立验证

Bridge 本身可以独立构建和测试：

```bash
npm run bridge:build
npm run test --workspace=packages/bridge
```

这类测试用于验证 Bridge 协议、安全校验、Provider 恢复和基础服务逻辑。

## 8. 自动化验证组合

日常开发建议按风险选择验证范围。

### 8.1 CLI / Headless 核心

```bash
npm run shared:build
npm run cli:typecheck
npm run cli:build
npm run cli:test
```

适合验证无界面核心逻辑、协议、会话和命令行行为。

### 8.2 VS Code Extension

```bash
cd /home/ff/work/devseek_netai/packages/vscode-extension
npm test
```

如需回到仓库根目录：

```bash
cd /home/ff/work/devseek_netai
```

### 8.3 Phase 10 综合验证

```bash
npm run verify:phase10
```

### 8.4 发布安装闭环

修改 DevSeek extension 或 Bridge 行为后，默认执行本地发布闭环：

```bash
npm run verify:phase10
npm run extension:package
code --install-extension /home/ff/work/devseek_netai/devseek-netai-latest.vsix --force
```

## 9. 推荐测试分层

| 层级 | 推荐方式 | 适合验证 |
| --- | --- | --- |
| Headless Agent 核心 | CLI Mock / CLI JSONL | 任务协议、会话、状态机、自动化脚本 |
| Bridge 服务 | Bridge 单测 / CLI Bridge 冒烟 | Provider 连接、鉴权、恢复、安全边界 |
| 真实 DeepSeek 网页 | CLI Bridge / VS Code 插件 | 登录、真实网页可用性、端到端链路 |
| VS Code UI | 手动测试用例 | WebView 展示、按钮位置、Todos、diff 确认、人机交互 |

## 10. 常用路径

| 用途 | 路径 |
| --- | --- |
| 本文档 | `/home/ff/work/devseek_netai/docs/usage/devseek-running-modes.md` |
| CLI 入口源码 | `/home/ff/work/devseek_netai/packages/cli/src/index.ts` |
| CLI 构建产物 | `/home/ff/work/devseek_netai/packages/cli/dist/index.js` |
| VS Code extension 源码 | `/home/ff/work/devseek_netai/packages/vscode-extension/src/extension.ts` |
| 最新根目录 VSIX | `/home/ff/work/devseek_netai/devseek-netai-latest.vsix` |
| extension 包内 VSIX | `/home/ff/work/devseek_netai/packages/vscode-extension/devseek-netai-latest.vsix` |
| 手动测试用例 | `/home/ff/work/devseek_netai/docs/testing/vscode-phase-manual-test-cases.md` |
| Phase 10 设计文档 | `/home/ff/work/devseek_netai/docs/architecture/10-运行形态与界面解耦架构设计.md` |

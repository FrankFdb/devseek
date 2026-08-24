# N3 跨平台真实用户仿真包

这套测试从真实 VS Code、DevSeek UI、真实 Provider 和真实文件系统入口验证候选，不调用内部测试 API。它用于 N3 产品证据，不产生 Gate 0 claim，也不能替代 protected holdout 或外部发布裁决。

## 当前结果

- 本地平台实现与故障 oracle：40/40 PASS。
- Shared、Bridge、CLI、Headless、Extension 的 Phase 10 编译、类型检查和测试：PASS。
- exact candidate identity：11/11 PASS；本机只有一个 stable Bridge。
- 本测试包 contract/攻击测试：14/14 PASS。
- 本地授权真实 Provider 波次：最终 exact candidate 的 headed VS Code natural UI 前台任务 3/3 PASS；C13 和 R3-08A 全空闲，R3-09A 前台完成时仍有 2 个无写入的后台记忆请求，故只记“前台通过”，不记 full-idle 通过。
- 外部真实用户结果：0 份；`windows-x64-v1`、`wsl2-linux-x64-v1`、`macos-arm64-v1` 尚未执行，因此 N3 matrix 当前应为 `accepted=false`，不能写成跨平台通过。

测试包 SHA-256 通过 `result-tool.mjs packet` 现场计算；每个结果必须绑定同一 hash，避免后续修改 case 后混用旧结果。

## 固定候选

- VSIX：`devseek-netai-2.0.32-debug.20260824.t170937.g2db5768.vsix`
- SHA-256：`236d45d9ad7559e82912435e3f47bd0633e4259617e8bb2cda235a1b96875951`
- Packaged Bridge SHA-256：`8add0a5912cd4c70ed107a459b32881af8b1086ee18e0083a90058dcd93a5ef7`
- Extension：`devseek-netai.devseek-netai@2.0.32-debug.20260824.t170937.g2db5768`
- Source commit：`2db5768a70ebd53aea6c279328e2c87a9ad1aab2`
- VS Code engine：`^1.85.0`

测试者应拿到本目录和 exact VSIX，但不应查看 DevSeek 实现、历史失败答案或隐藏 oracle。结果必须按 `cases.json` 中的八个 case 顺序执行；失败、阻塞和中断同样是有效发现，不能通过选择性补跑覆盖。

结果工具需要 Node.js 20 或更高版本，以及仓库锁文件中的依赖。首次执行时在仓库根目录运行 `npm ci --ignore-scripts`；该命令只准备校验器，不构建或安装另一个 DevSeek 候选。

## 平台矩阵

| Profile | 环境 | N3 口径 |
| --- | --- | --- |
| `linux-x64-v1` | Linux x64 native | 当前本机基线，仍可另做独立复测 |
| `windows-x64-v1` | Windows x64 native | 必需独立主机 |
| `wsl2-linux-x64-v1` | Windows + WSL2 Linux x64 | 必需独立主机，使用 Remote WSL 产品入口 |
| `macos-arm64-v1` | macOS Apple Silicon | 必需独立主机 |
| `macos-x64-v1` | macOS Intel | 补充 profile，声明支持时转为必需 |

每个平台使用独立 OS 账户、全新 VS Code user-data/profile 和独立 extension directory。开始前关闭其他 DevSeek 窗口及 Bridge，Provider 账号可由测试者自行登录，但 cookie、token、Authorization header、`.devseek/bridge-token` 和完整命令行不得进入证据。

## Case 顺序

| 顺序 | Case | 验证重点 |
| ---: | --- | --- |
| 1 | `N3-UW-01-INSTALL-IDENTITY` | exact VSIX、安装版本、单一 Bridge |
| 2 | `N3-UW-02-NATURAL-MEDIUM-TASK` | 自然语言中型任务、真实写盘、独立运行 |
| 3 | `N3-UW-03-PATH-SYMLINK-BOUNDARY` | OS 路径、symlink/junction、workspace containment |
| 4 | `N3-UW-04-PERMISSION-FAILURE-RECOVERY` | 原生权限拒绝、失败可见、继续只读工作 |
| 5 | `N3-UW-05-STEERING-CANCEL` | 最新 steering、取消、停止陈旧 effect |
| 6 | `N3-UW-06-RESTART-RESUME` | Extension Host/Bridge 重启、恢复、不重放 |
| 7 | `N3-UW-07-NETWORK-INTERRUPTION` | Provider 断网、有限重试、资源回收 |
| 8 | `N3-UW-08-DELIVERY-CLEANUP` | readback、测试、总结一致性、进程清理 |

具体 prompt、动作、通过条件和必需 evidence kind 以 `cases.json` 为唯一机器来源。

## 初始化结果

先核对 VSIX。Windows PowerShell：

```powershell
(Get-FileHash .\devseek-netai-2.0.32-debug.20260824.t170937.g2db5768.vsix -Algorithm SHA256).Hash.ToLower()
```

Linux/WSL：

```bash
sha256sum devseek-netai-2.0.32-debug.20260824.t170937.g2db5768.vsix
```

macOS：

```bash
shasum -a 256 devseek-netai-2.0.32-debug.20260824.t170937.g2db5768.vsix
```

从仓库根目录创建一次 append-only 结果。把 `<profile>` 换成平台矩阵中的 ID：

```bash
node code/devseek-tests/n3-cross-platform-user-way/result-tool.mjs init \
  --platform <profile> \
  --output artifacts/n3-cross-platform-user-way/<run-id>/result.json \
  --run-id <run-id>
```

填写 `tester`、`environment` 和总开始时间。`implementation_contributor=false` 表示测试者没有参与该候选实现；公开的 case 和 pass criteria 可以阅读，但测试者不得提前查看实现或隐藏 oracle。

## 安装与证据

使用 fresh user-data 强制安装 exact VSIX。Windows PowerShell：

```powershell
code --user-data-dir <fresh-user-data> --extensions-dir <fresh-extensions> `
  --install-extension <path-to-devseek-netai-2.0.32-debug.20260824.t170937.g2db5768.vsix> --force
code --user-data-dir <fresh-user-data> --extensions-dir <fresh-extensions> <workspace>
```

Linux 与 macOS：

```bash
code --user-data-dir <fresh-user-data> --extensions-dir <fresh-extensions> \
  --install-extension <path-to-devseek-netai-2.0.32-debug.20260824.t170937.g2db5768.vsix> --force
code --user-data-dir <fresh-user-data> --extensions-dir <fresh-extensions> <workspace>
```

WSL 使用 fresh Windows VS Code profile 打开 `Remote-WSL: New WSL Window`，并确认 DevSeek 安装在 WSL Extension Host。工作区路径必须包含空格和非 ASCII 字符，例如 `DevSeek 人工测试/<run-id>/项目 空格`。

每个 case 至少保留 `cases.json` 要求的 evidence kind：

- `ui-transcript`：逐轮 prompt、steering、审批、取消和最终 UI 文本，必须脱敏。
- `screenshot`：可见 UI 状态；不可包含账号、cookie、token 或其他个人信息。
- `workspace-snapshot`：case 前后文件树、文件 SHA-256、`git diff --no-index` 或等价 readback。
- `run-log`：对应 `.devseek/runs` 日志的脱敏副本，不得包含 Bridge token。
- `process-snapshot`：时间点、DevSeek Bridge 数量、可执行文件和脱敏后的 extension/script path，不记录完整命令行。
- `test-output`：独立终端实际执行结果及 exit code。
- `boundary-snapshot`、`permission-snapshot`、`network-timeline`：case 设置、前后 digest/权限和中断时间线。

证据文件放在 `result.json` 同目录或子目录，并在每个 `case_results[].evidence[]` 中填写相对路径。一个证据文件不能跨 kind 或跨 case 重用。

## 平台设置

`N3-UW-03-PATH-SYMLINK-BOUNDARY` 的外部目录与链接只放在测试临时目录中。POSIX：

```bash
mkdir -p ../outside && printf 'N3-OUTSIDE-SENTINEL\n' > ../outside/outside-secret.txt
ln -s ../outside linked-outside
```

Windows PowerShell 使用不需要文件 symlink 权限的目录 junction：

```powershell
New-Item -ItemType Directory -Force ..\outside | Out-Null
Set-Content ..\outside\outside-secret.txt 'N3-OUTSIDE-SENTINEL'
cmd /c mklink /J linked-outside ..\outside
```

`N3-UW-04-PERMISSION-FAILURE-RECOVERY` 在 POSIX 上使用 `chmod 0555 locked` 与 `chmod 0444 locked/config.json`，证据完成后恢复为 `0755/0644`。Windows 用临时测试账户的 ACL 移除 `locked` 写权限，结束后用 `icacls <locked-path> /reset /T` 恢复。任何设置失败都记录为 `BLOCKED`，不要降低边界后改记 PASS。

`N3-UW-07-NETWORK-INTERRUPTION` 只短暂断开测试主机网络 20 秒；不要修改 DevSeek 源码、注入内部 transport 或手工重复提交 prompt。

## 封存与校验

每个 case 结束后立即填写状态、时间、观察和证据路径。八个 case 完成后填写总结束时间，再由工具计算证据 SHA-256：

```bash
node code/devseek-tests/n3-cross-platform-user-way/result-tool.mjs seal \
  --result artifacts/n3-cross-platform-user-way/<run-id>/result.json
```

执行 fail-closed 校验：

```bash
node code/devseek-tests/n3-cross-platform-user-way/result-tool.mjs verify \
  --result artifacts/n3-cross-platform-user-way/<run-id>/result.json \
  > artifacts/n3-cross-platform-user-way/<run-id>/verification.json
```

只有 exact candidate、独立性声明、平台身份、八个 PASS、完整非空证据、路径 containment、文件 SHA-256 和脱敏检查全部通过时，命令才返回 0。FAIL/BLOCKED 时命令返回 1 是预期行为，必须连同原始 evidence 一起保留。

当各平台结果都位于同一 artifact root 的独立 `<run-id>/result.json` 下时，复算完整 N3 矩阵：

```bash
node code/devseek-tests/n3-cross-platform-user-way/result-tool.mjs matrix \
  --root artifacts/n3-cross-platform-user-way \
  > artifacts/n3-cross-platform-user-way/matrix-verification.json
```

矩阵校验拒绝缺失的必需 profile、重复 profile、候选漂移以及任一失败结果；补充 profile 不会掩盖必需 profile 缺失。

## 回传方式

回传整个 `<run-id>` 目录的压缩包，至少包含 `result.json`、`verification.json` 及其引用的全部 evidence。多平台回传时再附 `matrix-verification.json`。也可以把解压后的绝对路径提供给我；我会运行同一 `verify`/`matrix` 命令、核对失败时间线和候选身份，然后给出 `accepted`、`rejected` 或需要根因迭代的结论。不要通过聊天粘贴 token、cookie、账号或未脱敏日志。

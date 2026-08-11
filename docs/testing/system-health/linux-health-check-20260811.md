# Linux 系统健康与 DevSeek 运行残留检查报告

## 1. 检查信息

- 检查时间：`2026-08-11T09:29:55+08:00`
- 主机时区：`Asia/Shanghai`
- 工作目录：`/home/ff/work/devseek_netai`
- 检查方式：只读采样；未停止进程、未删除目录、未修改系统服务
- 结论适用范围：本次采样时刻的系统资源、进程、服务和内核状态，不代表对未来状态的永久保证

## 2. 结论

**本次采样没有发现 Linux 系统级卡顿或资源争用证据。**

| 检查项 | 结果 | 判定 |
| --- | --- | --- |
| 系统负载 | 12 CPU；load average=`0.38/0.63/0.50`，后续短采样约 `0.71/0.66/0.52` | 远低于 CPU 容量 |
| CPU | `vmstat` 空闲 94%～97%，I/O wait=0%；短时 `top` 空闲 89%～92% | 无 CPU 饱和或 I/O 等待 |
| 内存 | 15 GiB 总量，约 10 GiB available | 无内存压力 |
| Swap | 2 GiB 总量，使用 0 B | 无换页压力 |
| PSI | CPU、memory、I/O 的 `avg10` 均为 0.00 | 无当前压力停顿 |
| 磁盘 | 根分区 118 GiB，使用 64 GiB，利用率 58%，可用 48 GiB | 容量正常 |
| 异常进程状态 | D-state=0，zombie=0 | 无阻塞或僵尸残留 |
| 系统服务 | failed unit=0 | 正常 |
| 内核异常 | 当前启动无 OOM、hung task、I/O error 命中 | 正常 |
| DevSeek 测试进程 | 无 test/build/package/VSIX harness 运行 | 无测试执行残留 |

唯一较活跃的非 DevSeek 进程是主 VS Code 进程树中的 PID `4037`。3 秒短采样约占单核 33%～59%，但整机仍有 89%～92% CPU 空闲；该进程属于当前主 VS Code 会话，不是 `.vscode-test` 或 controlled VSIX harness。采样期间工具输出持续更新，也会触发 VS Code 渲染，因此没有证据表明它是失控后台任务。

## 3. 运行中保留项

### 3.1 DevSeek Bridge 与 DeepSeek 页面

存在一组**此前按授权有意保留**的运行时，不判定为意外残留：

- Bridge PID：`185311`
- Bridge 版本路径：`devseek-netai-1.0.0-debug.20260810.t172136.g2edc604`
- 监听地址：`127.0.0.1:3721`，未监听外部网卡
- 进程组成：1 个 Node Bridge 加 8 个 Playwright Chromium 进程（采样时）
- RSS 简单求和：约 `996 MiB`；该数值包含共享页重复计算，不等于真实独占内存
- CPU 短采样：Bridge 与抽查的 Chromium 进程均为 `0.0%`
- 运行时长：约 15.9 小时
- 用途：保留 VS Code 窗口和 DeepSeek 页面

系统仍有约 10 GiB available memory，且 Swap 未使用，因此该保留运行时当前不会构成系统卡顿瓶颈。若后续不再需要保留 DeepSeek 页面，可在停止对应 DevSeek/VS Code 会话后再清理其浏览器 profile；本报告未执行停止操作。

### 3.2 未发现的运行残留

以下进程模式均未命中：

- `npm` 测试或构建任务
- `node ... test` / `node ... verify`
- `tsc`
- `vsce`
- `devseek-controlled` harness
- `.vscode-test`
- `extensionTestsPath`

## 4. 已停止但仍占磁盘的残留

这些目录没有对应运行进程，但仍占用磁盘。本报告只盘点，没有删除。

### 4.1 Controlled VSIX 临时目录

| 路径 | 大小 |
| --- | ---: |
| `/tmp/devseek-controlled-vsix-2GrMbI` | 119 MiB |
| `/tmp/devseek-controlled-vsix-42MTPF` | 120 MiB |
| `/tmp/devseek-controlled-vsix-K0sqe0` | 119 MiB |
| `/tmp/devseek-controlled-vsix-aLuPLG` | 119 MiB |
| `/tmp/devseek-controlled-vsix-sWVSLy` | 120 MiB |
| `/tmp/devseek-controlled-vsix-zdKxJA` | 120 MiB |
| `/tmp/devseek-surface-product-conformance-6V1HmE` | 88 KiB |

六个 stopped controlled VSIX 目录合计约 `717 MiB`，属于可审查后清理的磁盘残留。

### 4.2 Playwright profile

- `/tmp/playwright_chromiumdev_profile-h6gzpT`：`6.3 MiB`
- 该目录正被 PID `185311` 的 Chromium 进程树使用，不应在运行时删除。

### 4.3 已安装 DevSeek Extension 版本

| 版本目录 | 大小 | 状态 |
| --- | ---: | --- |
| `g940d77e` | 100 MiB | 旧版本目录，未运行 |
| `g924f8af` | 100 MiB | 旧版本目录，未运行 |
| `g2edc604` | 100 MiB | 当前运行版本 |

两个旧安装目录约占 `200 MiB`，是可审查后清理的非运行残留。当前运行时只精确指向 `g2edc604`。

排除当前运行版本及正在使用的 Playwright profile，可回收候选空间约 `917 MiB`。这部分不会造成当前卡顿，只影响磁盘占用。

## 5. 实际执行的健康检查命令

以下按执行顺序列出本次健康确认使用的全部诊断命令。

### 5.1 系统负载与 CPU 数量

```bash
uptime
```

关键输出：

```text
up 17:49, 1 user, load average: 0.38, 0.63, 0.50
```

```bash
nproc
```

关键输出：`12`

### 5.2 内存与 CPU/I/O 连续采样

```bash
free -h
```

关键输出：15 GiB 总内存、约 10 GiB available、Swap 使用 0 B。

```bash
vmstat 1 5
```

关键输出：五次采样 CPU idle=94%～97%，`wa=0`，`si/so=0`，blocked process=`0`。

### 5.3 磁盘与 PSI

```bash
df -h / /home
```

关键输出：`/dev/sda3` 使用率 58%，可用 48 GiB。

```bash
cat /proc/pressure/cpu /proc/pressure/memory /proc/pressure/io
```

关键输出：三类资源的 `some avg10=0.00`，memory/I/O 的 `full avg10=0.00`。

### 5.4 CPU 与内存热点进程

```bash
ps -eo pid=,ppid=,stat=,etimes=,%cpu=,%mem=,rss=,comm=,args= --sort=-%cpu | head -20
```

关键结果：主 VS Code PID `4037` 是最活跃进程；Bridge/Chromium 没有进入高 CPU 区间。

```bash
ps -eo pid=,ppid=,stat=,etimes=,%cpu=,%mem=,rss=,comm=,args= --sort=-rss | head -20
```

关键结果：内存主要由主 VS Code、GNOME、OpenClaw 和保留的 Chromium 使用；系统仍有约 10 GiB available。

### 5.5 D-state 与 zombie 检查

```bash
ps -eo pid=,ppid=,stat=,etimes=,comm=,args= | awk '$3 ~ /^[DZ]/ {print}'
```

结果：无输出，即 D-state=0、zombie=0。

### 5.6 DevSeek 与测试进程盘点

```bash
ps -eo pid=,ppid=,stat=,etimes=,%cpu=,%mem=,rss=,args= | rg -i 'devseek|playwright_chromiumdev_profile|vscode-test|extensionTestsPath|controlled-vsix' | rg -v 'rg -i'
```

结果：仅命中当前 Bridge PID `185311` 及其 Playwright Chromium 树。

```bash
ps -eo pid=,ppid=,stat=,etimes=,%cpu=,%mem=,args= | rg -i 'npm( |$)|node .*test|node .*verify|tsc( |$)|vsce|devseek-controlled|\.vscode-test|extensionTestsPath' | rg -v 'rg -i'
```

结果：无运行中的 DevSeek test/build/package harness。

### 5.7 Bridge 进程树、监听端口与内存汇总

```bash
pstree -ap 185311
```

结果：确认 1 个 Node Bridge 及其 Chromium 子进程/线程，没有额外测试 Extension Host。

```bash
ss -ltnp | rg 'pid=185311'
```

关键输出：

```text
LISTEN 0 511 127.0.0.1:3721 0.0.0.0:* users:(("node",pid=185311,fd=21))
```

```bash
node -e "const fs=require('fs');let n=0,rss=0,items=[];for(const d of fs.readdirSync('/proc').filter(x=>/^\\d+$/.test(x))){try{const cmd=fs.readFileSync('/proc/'+d+'/cmdline','utf8').replace(/\\0/g,' ');if(d==='185311'||cmd.includes('playwright_chromiumdev_profile-h6gzpT')){const s=fs.readFileSync('/proc/'+d+'/status','utf8');const m=s.match(/^VmRSS:\\s+(\\d+)/m);const kb=Number(m?.[1]||0);n++;rss+=kb;items.push({pid:Number(d),rssMiB:Math.round(kb/1024),kind:d==='185311'?'bridge':'chrome'});}}catch{}}console.log(JSON.stringify({processes:n,totalRssMiB:Math.round(rss/1024),items},null,2))"
```

结果：采样时共 9 个相关进程，RSS 简单相加约 996 MiB。

### 5.8 系统服务与内核异常

```bash
systemctl --failed --no-legend --no-pager
```

结果：无 failed system service。

```bash
journalctl -k -b --no-pager | rg -i 'out of memory|oom-kill|blocked for more than|hung task|I/O error' | tail -20
```

结果：当前启动没有 OOM、hung-task 或 I/O-error 命中。

### 5.9 短时 CPU 采样及回退

首先尝试：

```bash
pidstat -u -r -p 4037,185311,186057,186093,186145 1 3
```

结果：系统未安装 `pidstat`，命令返回 `127`：

```text
/bin/bash: line 1: pidstat: command not found
```

随后使用系统已有的 `top` 完成等价短采样：

```bash
top -b -d 1 -n 3 -p 4037,185311,186057,186093
```

结果：整机 CPU idle=88.9%～92.3%，I/O wait=0%～0.1%；Bridge 与 Chromium 抽查进程均为 0.0% CPU。

### 5.10 主 VS Code 活跃进程归属

```bash
pstree -ap 4037
```

结果：PID `4037` 属于主 VS Code 进程树，不是 DevSeek 测试 harness。

### 5.11 临时目录与安装版本盘点

```bash
find /tmp -maxdepth 1 -type d \( -name 'playwright_chromiumdev_profile-*' -o -name '*vscode*test*' -o -name '*devseek*' \) -printf '%TY-%Tm-%Td %TH:%TM %p\n' | sort
```

结果：发现 6 个 stopped controlled VSIX 目录、1 个 surface conformance 小目录和 1 个当前使用中的 Playwright profile。

```bash
du -sh /tmp/devseek-controlled-vsix-* /tmp/devseek-surface-product-conformance-* /tmp/playwright_chromiumdev_profile-*
```

结果：controlled VSIX 目录约 717 MiB；surface conformance 目录 88 KiB；当前 profile 6.3 MiB。

```bash
find /home/ff/.vscode/extensions -maxdepth 1 -type d -name 'devseek-netai.devseek-netai-*' -printf '%f\n' | sort
```

结果：发现 `g940d77e`、`g924f8af`、`g2edc604` 三个安装版本。

```bash
du -sh /home/ff/.vscode/extensions/devseek-netai.devseek-netai-*
```

结果：每个安装目录约 100 MiB；只有 `g2edc604` 正在运行。

### 5.12 报告时间戳

```bash
date --iso-8601=seconds
```

输出：`2026-08-11T09:29:55+08:00`

## 6. 报告落盘准备命令

以下命令仅用于选择报告目录和确认 Git 行为，不参与系统健康判定：

```bash
find docs -maxdepth 2 -type d -printf '%p\n' | sort | head -80
git check-ignore -v docs/testing/system-health/linux-health-check-20260811.md
mkdir -p docs/testing/system-health
```

目标报告路径未被 `.gitignore` 忽略。

## 7. 后续处理边界

- 当前无需为“系统卡顿”采取处理，继续观察即可。
- 不应在 Bridge 运行时删除 `/tmp/playwright_chromiumdev_profile-h6gzpT`。
- 六个 stopped controlled VSIX 目录与两个旧 Extension 版本是可清理候选，预计可释放约 917 MiB。
- 清理属于状态修改，不在本次只读确认范围内，需单独执行并在执行后复核当前 Extension 与 Bridge 身份。

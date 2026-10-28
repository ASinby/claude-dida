# Windows 播放窗口消除方案（wscript 隐藏启动器）

> 解决每次播放提示音时 CMD / Windows Terminal 闪出一个窗口的问题。
>
> 状态：**已实施并验证**（2026-10-28）
>
> 实施偏差：`hiddenLauncher()` 用 `%SystemRoot%\System32\wscript.exe` 的文件存在性判断代替 `where wscript`，避免播放热路径上多开一个进程。其余按本方案执行。
>
> 最后更新：2026-10-28

---

## 1. 问题

每次触发提示音，用户会看到一个 Windows Terminal 窗口闪出，播放结束后自动关闭。

**现状实现**：`scripts/player.mjs` 的 `windowsCommand()` 用 `shell: true` 拉起 PowerShell：

```js
const line = `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${b64}`;
return { type: 'cmdline', line };
```

`playSound()` 中以 `spawn(line, [], { shell: true, detached: true, stdio: 'ignore', windowsHide: true })` 启动。

`windowsHide: true` **已经设了，但对这个场景无效**——原因见下节。

---

## 2. 根因

### 2.1 窗口来自外层 shell，不是 PowerShell

用 Win32 `EnumWindows` + `IsWindowVisible` 枚举可见顶层窗口，逐个对比播放前后的窗口列表。测试环境：Windows 11 Home China 10.0.26300 / Node v22.10.0。

| 启动方式 | 新增可见窗口 | 脚本是否执行 |
|---|---|---|
| `shell:true + detached`（现状） | **WindowsTerminal**，标题为 `powershell -NoProfile -NonInteractive ... -EncodedCommand ...` | 是 |
| `shell:true + detached + -WindowStyle Hidden` | **WindowsTerminal**（同上） | 是 |
| `argv + detached` | 无 | **否** |
| `argv + detached + -WindowStyle Hidden` | 无 | **否** |
| `argv + 非 detached + windowsHide` | 无 | 是（但父进程退出即被杀） |

关键点：`-WindowStyle Hidden` 隐藏的是 **PowerShell 自己的窗口**，管不到外层 cmd 那个。窗口标题里那串 `-EncodedCommand` 就是证据——弹出来的是承载命令行的那一层。

### 2.2 `detached` 下 PowerShell 根本不启动

这是一个死锁，两侧都堵死：

- **`shell: true`**：Node 经 cmd.exe 中转，cmd 需要控制台 → Windows Terminal 被拉起 → **闪窗**
- **去掉 `shell: true`**：Node 的 `detached` 会设置 `DETACHED_PROCESS` 标志，子进程**完全没有控制台**；而 `powershell.exe` 是控制台子系统程序，没有控制台就**静默不执行**

第二种情况我逐项验证过，五种调用形式全部一样地静默失败（不留日志、退出码正常、无报错）：

| 调用形式 | 结果 |
|---|---|
| `detached` + `-Command` | 不执行 |
| `detached` + `-EncodedCommand` | 不执行 |
| `detached` + `-File` | 不执行 |
| `detached` + `-WindowStyle Hidden` + `-File` | 不执行 |
| `detached` + `-NoLogo` + `-File` | 不执行 |

**对既有文档的更正**：`implementation-plan.md` 第 43 行写道"裸 `detached: true` 会被回收（实测子进程写不出文件）"。这个结论的现象描述正确（确实写不出文件），但归因错误——**不是被回收，而是从没启动**。当时用 `process.execPath`（node.exe）做对照实验时会存活，掩盖了这一点：node.exe 同样是控制台程序，但它是被 Node 自己 spawn 的，继承了控制台；换成真正的 detached 场景（父进程立即 `process.exit()`）才暴露。

补充实测：`argv + 非 detached + windowsHide` 能让 PowerShell 正常执行（ready=632ms）且无窗口，但**父进程一退出子进程就被杀**，3/3 全部失败。所以这个方向不可用。

### 2.3 结论

需要一个**本身不需要控制台**的进程去拉起需要控制台的 PowerShell，并告诉它隐藏窗口。

`wscript.exe`（Windows Script Host）是 **GUI 子系统程序**：不需要控制台、不创建窗口、父进程退出后照常存活。它提供的 `WScript.Shell.Run(cmd, 0, wait)` 正好能指定"隐藏窗口启动"。

---

## 3. 方案

### 3.1 思路

```
dida.mjs
   │
   ▼
player.mjs  ──spawn(detached)──▶  wscript.exe        （GUI 子系统，无控制台，存活）
                                      │
                                      │ sh.Run(cmd, 0, wait)
                                      ▼
                                  powershell.exe     （--WindowStyle Hidden，无窗口）
                                      │
                                      ▼
                                  MediaPlayer 播放
```

### 3.2 新增文件

**`scripts/win-play.ps1`** —— 实际播放脚本，接收文件路径与音量两个参数：

```powershell
param([string]$File, [double]$Volume = 0.7)
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName PresentationCore
$p = New-Object System.Windows.Media.MediaPlayer
$p.Volume = [Math]::Min(1, [Math]::Max(0, $Volume))
$p.Open([uri]$File)
$p.Play()

# 等 NaturalDuration 就绪（最长 2.5s 保护）
$g = 0
while (-not $p.NaturalDuration.HasTimeSpan -and $g -lt 250) {
  Start-Sleep -Milliseconds 10
  $g++
}
$ms = if ($p.NaturalDuration.HasTimeSpan) { $p.NaturalDuration.TimeSpan.TotalMilliseconds } else { 800 }

Start-Sleep -Milliseconds ([int]$ms + 150)
$p.Close()
```

逻辑与现有内联脚本一致，只是从 base64 编码改为独立文件 + 参数传入。

**`scripts/win-play.vbs`** —— 隐藏启动器：

```vbs
Option Explicit
Dim sh, fso, ps1, file, vol, waitFlag

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

If WScript.Arguments.Count < 1 Then WScript.Quit 2

file = WScript.Arguments(0)
' 防引号破坏参数结构
file = Replace(file, """", "")

vol = "0.7"
If WScript.Arguments.Count > 1 Then vol = WScript.Arguments(1)

waitFlag = False
If WScript.Arguments.Count > 2 Then waitFlag = (WScript.Arguments(2) = "1")

ps1 = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "win-play.ps1")
If Not fso.FileExists(ps1) Then WScript.Quit 3

sh.Run "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass " & _
       "-WindowStyle Hidden -File """ & ps1 & """ """ & file & """ " & vol, _
       0, waitFlag
```

- `0` = 窗口隐藏（`SW_HIDE`）
- `waitFlag`：`False` 用于正常播放（后台，不阻塞），`True` 用于 `/dida-preview`（阻塞到播完）
- 第三个参数 `0|1` 控制等待模式，避免维护两个 VBS 文件

### 3.3 修改 `scripts/player.mjs`

只改 Windows 分支，macOS / Linux 一行不动：

```js
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const LAUNCHER = path.join(SCRIPT_DIR, 'win-play.vbs');

function windowsCommand(file, volume, inline) {
  return {
    type: 'argv',
    command: 'wscript',
    args: ['//nologo', '//B', LAUNCHER, file, String(clampVolume(volume)), inline ? '1' : '0'],
  };
}
```

`buildCommand()` 增加一个 `inline` 参数透传：

```js
export function buildCommand(file, volume, inline = false) {
  if (PLATFORM === 'win32') return windowsCommand(file, volume, inline);
  ...
}
```

`playSound()` 里已经算好了 `inline`（`const inline = options.mode === 'inline'`），传给 `buildCommand` 即可。因为 `windowsCommand` 返回 `argv` 类型，现有的 `shell: true` 分支（`spec.type === 'cmdline'`）自然不再命中，`spawn` 走正常 argv 路径——**这正是我们要的**：wscript 作为 GUI 进程，`detached` 下完全正常。

### 3.4 降级路径

VBScript 已被微软列入逐步弃用计划（走向"按需功能"）。在 `detectPlayer()` 里加探测：

```js
function windowsBackend() {
  const hasWscript = spawnSync('where', ['wscript'], { stdio: 'ignore', windowsHide: true }).status === 0;
  const hasFiles = fs.existsSync(LAUNCHER) && fs.existsSync(path.join(SCRIPT_DIR, 'win-play.ps1'));
  return hasWscript && hasFiles;
}
```

- 有 wscript + 两个文件 → 走隐藏启动器
- 否则 → 回落到现在的 `shell:true` 方式（会闪窗，但**保证能响**，不会变哑）

`detectPlayer()` 的返回需相应调整，让 `/dida-doctor` 能显示当前实际使用的后端。

---

## 4. 实测数据

测试环境：Windows 11 Home China 10.0.26300 / Node v22.10.0 / 系统自带 PowerShell 5.1。

### 4.1 方案效果

| 项目 | 结果 |
|---|---|
| 是否弹窗 | **无**（`EnumWindows` 枚举增量确认） |
| 父进程退出后存活 | **可靠**，`process.exit(0)` 后正常播放 |
| ready（从启动到出声） | **294–717ms**，中位数约 **450ms**，波动较大 |
| `inline` 阻塞模式 | 正常（1087ms 音频实测 2625ms 返回，含启动开销） |
| 中文路径 | **正常**（`Test-Path` 为 True，文件长度 104489 字节对得上） |
| 无参数调用 | 干净退出，退出码 2 |
| 文件不存在 | 静默失败，退出码 0，不弹窗 |

### 4.2 各环节耗时拆解（现状 PowerShell 路径）

| 环节 | 耗时 |
|---|---|
| PowerShell 冷启动（下限，什么都不做） | ~217ms |
| `Add-Type -AssemblyName PresentationCore` | +70ms |
| `MediaPlayer.Open()` | ~27ms |
| `MediaOpened`（真正出声） | ~280ms |
| **合计** | **~880ms** |

`dida.mjs` 自身开销（node 启动 + 读配置 + spawn）另计约 134–235ms。

新方案省掉了 PowerShell 作为 shell 中转的那一层，所以有改善，但**没有数量级变化**——大头仍是 PowerShell 冷启动。

### 4.3 排除掉的替代方案

| 方案 | 实测 | 为何不用 |
|---|---|---|
| `System.Media.SoundPlayer` | `PlaySync` 内部开销 280ms；总耗时 1238ms（0.6s 音频 + 218ms 基线） | 不比 MediaPlayer 快，且**只支持 WAV**，会逼着放弃现有 MP3 主题 |
| `WMPlayer.OCX`（wscript 直接播） | ready≈476ms | 可用，但需改音频对象，收益不明确 |
| 常驻 PowerShell 进程（TCP 常驻） | 就绪 **496ms**（vs 冷启动 880ms） | 能省约 380ms，但需守护进程、端口管理、失效重建，复杂度显著上升 |
| `argv + 非 detached` | ready=632ms，无窗口 | 父进程退出即被杀，3/3 失败 |

---

## 5. 已踩过的坑

实施时逐条避开。

### 5.1 必须加 `//B`

用故意抛错的 VBS 测试：

- **不加** `//B` → 错误弹出**模态对话框**，进程挂住不退出（10 秒超时才被杀掉）
- **加** `//B` → 静默退出

所以 `spawn` 的参数必须是 `['//nologo', '//B', ...]`。漏了这个，一旦 VBS 出错就会留下一个卡死的隐藏对话框进程。

### 5.2 引号过滤不能省

试过 `Windows Ding.wav" "; echo INJECTED` 这种构造，**实测未被执行**。但这仍是字符串拼接，`overrides` 配置里的路径若含双引号，理论上能破坏参数结构。`Replace(file, """", "")` 一行，成本极低，建议保留。

### 5.3 测试时的假失败

`win-play.ps1` 是在**播放结束后**才写日志的。3.2 秒音频 + 启动时间很容易超过测试脚本的等待窗口，导致看起来"没执行"。

第一轮 6 次里"失败"1 次，把等待从 3.5s 延长到 6s 后 **8/8 全部成功**。这是测试假象，不是方案缺陷。验证时注意给足时间。

### 5.4 插件路径含空格

VBS 里对 `ps1` 和 `file` 都用了 `""" & x & """` 包裹。插件实际安装路径（`~/.claude/plugins/...`）通常含空格，已按此处理。

---

## 6. 风险与回滚

**风险面**：只改 `player.mjs` 的 `windowsCommand()`，macOS 的 `afplay`、Linux 的 `paplay/ffplay/mpv` 分支完全不碰。

**回滚**：删掉 `scripts/win-play.vbs` 和 `scripts/win-play.ps1`，恢复 `windowsCommand()` 原实现即可。无状态残留、无配置变更、无迁移步骤。

**打包影响**：`.claude-plugin/marketplace.json` 的 source 是 `./`，新文件自动包含，无需改 manifest。`.gitignore` 只忽略 `node_modules/`、`.DS_Store`、`*.log`、`.claude/settings.local.json`，新文件正常纳入版本控制。

---

## 7. 验证步骤

实施后按顺序确认：

1. **直接调用启动器**
   ```bash
   wscript //nologo //B scripts/win-play.vbs "D:/.../sounds/default/task-complete.mp3" 0.7
   ```
   预期：听到声音，**无窗口闪出**

2. **走完整 CLI 路径**
   ```bash
   node scripts/dida.mjs play task-complete
   ```
   预期：同上

3. **`/dida-preview`**：确认能依次试听 5 个音效，且阻塞行为正常（播完一个才播下一个）

4. **`/dida-doctor`**：确认"播放器"一节显示新的后端名称，且无报错

5. **真实 hook 场景**：在对话中触发一次任务完成，确认无窗口闪现

6. **可靠性**：连续触发 10 次，确认无遗漏、无残留进程

7. **停止音效**：手动触发 5 个以上音效，确认不会叠音（现有去抖逻辑 `dedupeMs` 默认 1500ms 仍在生效）

---

## 8. 遗留问题

- **延迟波动**：ready 在 294–717ms 之间跳动，是 Windows 进程调度的正常波动。若后续对稳定性有要求，唯一解是常驻播放进程（见 4.3）
- **VBScript 长期兼容**：微软已宣布弃用计划。当前 Windows 11 26300 实测正常，降级路径（3.4）可兜底
- **多格式支持**：本方案不涉及。当前 `sounds.mjs` 仍写死 `.mp3`，如需支持 WAV 应单独处理（`overrides` 可作临时变通，见 README 第 107 行）

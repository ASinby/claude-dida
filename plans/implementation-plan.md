# claude-dida 实现方案

> Claude Code 声音反馈插件：任务完成、需要输入、出错时播放提示音，内置 6 套可选音效主题。
>
> 状态：方案定稿，待实施
> 最后更新：2026-10-27

---

## 1. 目标与范围

**要解决的事**：Claude Code 长时间跑任务时用户会切走，不知道何时完成、何时在等确认。本插件在关键时刻播放声音，让用户凭听觉掌握进度。

**本期范围**

- 6 套主题 × 5 类事件，事件触发即播放
- 主题首次选择后持久化，之后自动沿用
- 音量、总开关、事件级开关、静默时段
- 跨平台播放（Windows / macOS / Linux）

**不做**

- 语音播报（TTS）
- 语音输入
- 自定义音效上传（仅预留配置项，P3 再考虑）

---

## 2. 已确认的技术事实

以下均为本机（Windows 11 / Claude Code 2.1.153 / Node v22.10.0）实测或从 CLI 二进制中提取，非文档推测。

| 项 | 结论 |
|---|---|
| 音源 | `sounds/` 下 6 主题 × 5 个 mp3：`session-start` `task-complete` `need-input` `idle` `error`。文件名与事件名天然对齐 |
| 插件结构 | `.claude-plugin/plugin.json` + `hooks/hooks.json`，`commands/*.md` 自动发现 |
| 路径占位符 | `${CLAUDE_PLUGIN_ROOT}`、`${CLAUDE_PLUGIN_DATA}`、`${CLAUDE_PROJECT_DIR}` 均会展开 |
| Hook 执行器 | Windows 走 `cmd.exe /d /s /c <command>`；POSIX 走 `/bin/sh -c` |
| 异步 Hook | 2.1.153 schema 内置 `async`（"runs in background without blocking"）与 `asyncRewake` |
| Windows 播放 | PowerShell + `PresentationCore` 的 `MediaPlayer` 可用；`Position` 随真实时间推进（实测 574ms 音效播到 574ms 结束），非静默空转 |
| 音量 | `MediaPlayer.Volume` 取值 0~1 |
| 冷启动 | PowerShell `-NoProfile` 约 290ms，单次播放进程总耗时约 1.9s（含等待时长）→ **不能同步阻塞** |
| 子进程存活 | 裸 `detached: true` 下 PowerShell **根本没启动**（现象是写不出文件，但归因是没控制台，不是被回收）；`detached + shell: true` 能存活但会闪窗。现行方案改用 wscript 隐藏启动器，详见 `windows-hidden-launcher-plan.md` |
| `SessionStart` matcher | `source`：`startup` / `resume` / `clear` / `compact` |
| `Notification` matcher | `notification_type`：`permission_prompt` / `idle_prompt` / `auth_success` / `elicitation_dialog` / `elicitation_complete` / `elicitation_response` |
| 上下文注入 | `hookSpecificOutput.additionalContext` 可用 |

**环境前置**：`~/.claude/settings.json` 中原有的 `claude-ding` 全局 hooks 已清理（`hooks` 为空，命令已卸载），不存在双响或失效命令问题。

---

## 3. 已锁定的设计决策

| 决策 | 取值 |
|---|---|
| 主题选择时机 | **选一次记住**。`SessionStart` 只播已选主题，不每次询问；未配置时才引导一次 |
| `Stop` 默认状态 | **默认开启**（每轮回复结束都响） |
| 播放进程模型 | 短命进程 + detach，无常驻守护进程 |
| 配置驱动 | `hooks.json` 恒定注册全部事件，开关判断在脚本内完成，切换即时生效 |

---

## 4. 架构

每次事件都是一个短命 Node 进程，拉起独立播放器后立刻退出：

```
hooks.json
   │  cmd.exe /d /s /c node "<plugin>/scripts/dida.mjs" play <event>
   ▼
dida.mjs play <event>          ~60ms 启动，读完 stdin 即 spawn 并 exit
   │  1. 读 config → 总开关 / 事件开关 / 静默时段 / 音量
   │  2. 解析 sounds/<theme>/<event>.mp3
   │  3. 去抖检查（时间戳文件）
   ▼
player.mjs                     shell:true + detached 拉起，父进程立即退出
   ▼
powershell / afplay / paplay   独立存活，播完自行结束（~600ms）
```

**为什么不要常驻守护进程**：初版方案设想用守护进程解决阻塞与叠音。实测 `async` 字段存在、且脚本本身即可秒退，守护进程带来的单例锁、端口冲突、空闲回收等复杂度全部不必要。去抖改用时间戳文件，成本仅一次 64 字节读写。

**为什么用 `-EncodedCommand` 而不是传路径参数**：Hook 命令经 `cmd.exe` 解析，路径含空格/`&`/`^` 时引号规则极易出错。把整段 PowerShell 脚本 base64 编码后传递，内容只剩 `A-Za-z0-9+/=`，从根上消除 Windows 引号问题。

---

## 5. 目录结构

```
claude-dida/
├── .claude-plugin/
│   └── plugin.json
├── hooks/
│   └── hooks.json
├── commands/
│   ├── dida-setup.md          # 交互选择主题 + 试听
│   ├── dida-preview.md        # 试听全部 / 单个音效
│   ├── dida-theme.md          # 直接切换主题
│   ├── dida-doctor.md         # 健康检查
│   ├── dida-on.md             # 总开关开
│   └── dida-off.md            # 总开关关
├── scripts/
│   ├── dida.mjs               # CLI 入口，子命令路由
│   ├── config.mjs             # 配置读写与默认值
│   ├── player.mjs             # 跨平台播放抽象
│   └── sounds.mjs             # 主题枚举与音效解析
├── sounds/                    # 已存在，6 主题 × 5 mp3
└── README.md
```

零 npm 依赖，纯 ESM，不需要 `node_modules`。

---

## 6. 组件设计

### 6.1 `.claude-plugin/plugin.json`

```json
{
  "name": "claude-dida",
  "version": "0.1.0",
  "description": "Claude Code 声音反馈：任务完成、需要输入、出错时播放提示音",
  "license": "MIT",
  "keywords": ["sounds", "notifications", "hooks"]
}
```

### 6.2 `hooks/hooks.json`

全部事件恒定注册；是否发声由脚本内配置判断，确保 `/dida-off` 无需改动 hooks.json 即可即时生效。

```json
{
  "description": "claude-dida 声音反馈 hooks",
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/dida.mjs\" play session-start",
            "timeout": 10,
            "async": true
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/dida.mjs\" play task-complete",
            "timeout": 10,
            "async": true
          }
        ]
      }
    ],
    "Notification": [
      {
        "matcher": "permission_prompt",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/dida.mjs\" play need-input",
            "timeout": 10,
            "async": true
          }
        ]
      },
      {
        "matcher": "idle_prompt",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/dida.mjs\" play idle",
            "timeout": 10,
            "async": true
          }
        ]
      }
    ],
    "PostToolUseFailure": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/dida.mjs\" play error",
            "timeout": 10,
            "async": true
          }
        ]
      }
    ],
    "StopFailure": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/dida.mjs\" play error",
            "timeout": 10,
            "async": true
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/dida.mjs\" play task-complete --source subagent",
            "timeout": 10,
            "async": true
          }
        ]
      }
    ]
  }
}
```

`async: true` 与 detach 是双保险：即便 `async` 未被运行时尊重，脚本也会在 60ms 内自行退出，不会阻塞对话。

### 6.3 `scripts/config.mjs`

配置目录优先级：`${CLAUDE_PLUGIN_DATA}` → `~/.claude-dida/`（插件更新不覆盖用户配置，故不放在插件目录内）。

```json
{
  "theme": null,
  "volume": 0.7,
  "enabled": true,
  "events": {
    "task-complete": true,
    "need-input": true,
    "idle": true,
    "error": true,
    "session-start": true
  },
  "subagentStop": false,
  "dedupeMs": 1500,
  "playbackMode": "detach",
  "quietHours": { "enabled": false, "start": "22:00", "end": "08:00" },
  "overrides": {}
}
```

- `theme: null` 表示尚未选择 → `SessionStart` 改注入引导提示，不播放
- `overrides` 允许把某个事件映射到自定义 mp3 路径
- `playbackMode: "detach" | "inline"`，见 §10 风险 1 的降级开关

### 6.4 `scripts/sounds.mjs`

- `listThemes()`：扫描 `sounds/` 下含 `task-complete.mp3` 的子目录
- `listEvents()`：固定 5 个事件名
- `resolveSound(theme, event, config)`：优先 `overrides[event]`，否则 `<pluginRoot>/sounds/<theme>/<event>.mp3`，校验存在性

### 6.5 `scripts/player.mjs`

按平台分发，全部以「父进程立刻返回」方式执行：

- **Windows**：`PresentationCore` MediaPlayer

  ```js
  const script = `
    Add-Type -AssemblyName PresentationCore
    $p = New-Object System.Windows.Media.MediaPlayer
    $p.Volume = ${volume}
    $p.Open([uri]'${file.replace(/'/g, "''")}')
    $p.Play()
    $n = 0
    while (-not $p.NaturalDuration.HasTimeSpan -and $n -lt 200) { Start-Sleep -Milliseconds 25; $n++ }
    $ms = if ($p.NaturalDuration.HasTimeSpan) { $p.NaturalDuration.TimeSpan.TotalMilliseconds } else { 800 }
    Start-Sleep -Milliseconds ([int]$ms + 150)
    $p.Close()
  `;
  const b64 = Buffer.from(script, 'utf16le').toString('base64');
  spawn(`powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${b64}`, [], {
    detached: true, stdio: 'ignore', windowsHide: true, shell: true,
  }).unref();
  ```

- **macOS**：`afplay <file> -v <volume>`
- **Linux**：依次探测 `paplay` → `ffplay` → `mpv`，都无则记录错误日志

### 6.6 `scripts/dida.mjs`

子命令：

| 命令 | 用途 |
|---|---|
| `play <event> [--source subagent]` | Hook 调用。读配置 → 判开关 → 去抖 → spawn 播放 → `exit 0` |
| `set <key> <value>` | 改配置（`theme` / `volume` / `enabled` / `dedupeMs` 等） |
| `get` | 输出当前配置 JSON |
| `themes` | 列出主题 |
| `preview [theme] [event]` | 试听，可指定主题与单个音效 |
| `doctor` | 健康检查，输出逐项诊断 |
| `on` / `off` | 总开关 |

`play` 的执行顺序：

1. 立即完成所有 IO，不读 stdin 内容（Hook 输入为小体积 JSON，不消费不会阻塞）
2. `enabled === false` → 静默退出
3. 事件开关关闭 → 静默退出（`subagentStop` 单独判断）
4. 命中静默时段 → 静默退出
5. 去抖：`<dataDir>/last-<event>.stamp` 的 mtime 距今 < `dedupeMs` → 退出
6. 无主题 → 跳过 `session-start`（此时由 SessionStart hook 注入引导）
7. spawn 播放并 `process.exit(0)`

所有异常路径一律 `exit 0`，绝不向 Claude 输出内容、绝不返回非零码（非零会被 Claude Code 当作 Hook 失败展示给用户）。

### 6.7 命令（`commands/*.md`）

**`/dida-setup`** —— 首次选择主题：

```markdown
---
description: 选择 claude-dida 声音主题
allowed-tools: Bash, AskUserQuestion
---

为用户选择声音主题：

1. 运行 `node "${CLAUDE_PLUGIN_ROOT}/scripts/dida.mjs" themes` 获取主题列表
2. 对每个主题运行 `node "${CLAUDE_PLUGIN_ROOT}/scripts/dida.mjs" preview <theme> task-complete` 让用户试听
3. 用 AskUserQuestion 让用户选择主题
4. 运行 `node "${CLAUDE_PLUGIN_ROOT}/scripts/dida.mjs" set theme <所选主题>`
5. 运行 `preview <主题>` 播放完整 5 个音效确认
```

**`/dida-preview`**：试听当前主题全部 5 个音效（或按参数指定）。
**`/dida-theme <name>`**：直接切换，不等交互。
**`/dida-doctor`**：逐项输出 Node 版本、配置路径与内容、主题目录、播放器可用性、最近错误日志、Hook 是否已加载。
**`/dida-on` / `/dida-off`**：总开关。

### 6.8 首次使用引导

`play session-start` 检测到 `theme === null` 时，向 stdout 输出结构化 JSON：

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "claude-dida 尚未选择声音主题。请在回复末尾简短提示用户运行 /dida-setup 选择音效主题（仅提示一次，用户未响应则不再重复）。"
  }
}
```

`SessionStart` 之外的事件在无主题时静默退出。

---

## 7. 事件映射

| Hook | matcher | 音效 | 默认 | 说明 |
|---|---|---|---|---|
| `SessionStart` | `startup` | `session-start` | 开 | 仅新会话；`resume`/`clear`/`compact` 不响 |
| `Stop` | — | `task-complete` | **开** | 每轮回复结束 |
| `Notification` | `permission_prompt` | `need-input` | 开 | 需要用户批准 |
| `Notification` | `idle_prompt` | `idle` | 开 | 等待用户输入 |
| `PostToolUseFailure` | — | `error` | 开 | 工具调用失败 |
| `StopFailure` | — | `error` | 开 | 整轮失败（限流/鉴权/服务端错误） |
| `SubagentStop` | — | `task-complete` | **关** | 子代理结束，开启会显著增加噪音 |

`PostToolUseFailure` 与 `StopFailure` 共用 `error` 音效，由去抖避免叠音。

---

## 8. 交付阶段与验收

### P1 — 可听的最小闭环

- `plugin.json`、`hooks.json`、`dida.mjs`、`config.mjs`、`player.mjs`、`sounds.mjs`
- `/dida-setup`、`/dida-preview`

**验收**

1. `claude --plugin-dir ./claude-dida` 启动，执行 `/dida-setup` 选主题成功
2. 让 Claude 完成一轮回复 → **真的出声**（task-complete）
3. 触发一次权限请求 → 出声（need-input）
4. 触发一次工具失败 → 出声（error）
5. `Stop` 触发的 hook 不产生可感知延迟
6. **关键验证点**：detach 出来的播放器进程在真实 Hook 环境下未被回收（这是全案最大不确定项）

### P2 — 可控与可诊断

- 去抖、音量、静默时段、`/dida-on` / `/dida-off` / `/dida-theme`
- `/dida-doctor`
- 错误日志落盘

**验收**

1. 连续两次工具失败只响一次
2. `/dida-off` 后所有事件静默；`/dida-on` 恢复
3. 静默时段内不发声
4. `/dida-doctor` 能准确报出「未选主题」「播放器缺失」「配置路径」等状态

### P3 — 跨平台与打包

- macOS / Linux 播放适配
- README、音效来源与许可说明
- `marketplace.json`，可通过 `/plugin marketplace add` 安装

**验收**：换一台机器仅依赖 Node ≥ 18 即可运行。

---

## 9. 验证方法

```bash
# 直接验证播放链路（不经过 Claude Code）
node scripts/dida.mjs preview minimal

# 验证单个事件
node scripts/dida.mjs play task-complete

# 验证配置
node scripts/dida.mjs get

# 验证健康
node scripts/dida.mjs doctor

# 端到端
claude --plugin-dir ./claude-dida
```

---

## 10. 风险与未验证项

| # | 风险 | 影响 | 应对 |
|---|---|---|---|
| 1 | `async: true` 的**运行时行为未实测**，仅确认字段在 schema 内 | 中 | 脚本自身 60ms 退出，不依赖 `async`；若 detach 在真实 Hook 下被回收，切 `playbackMode: "inline"` 改为 `async` hook 内同步播放 |
| 2 | detach 存活只验证了「能写文件」，未验证真实 Hook 环境下「能出声」 | 高 | P1 第一个验收项即为该验证；失败则走风险 1 的降级路径 |
| 3 | `node` 是否在 Hook 的 `cmd.exe` 环境 PATH 内（nvm4w 路径） | 中 | `/dida-doctor` 检测；未解析到时提供写入绝对路径的安装步骤 |
| 4 | `Stop` 是「每轮回复结束」而非「任务真正完成」，长对话会频繁响 | 低 | 默认开但提供 `/dida-off`；README 说明语义 |
| 5 | 多会话并发时去抖文件共享，可能互相抑制一次 | 低 | 可接受，不修 |
| 6 | 音效版权：仅 `doom/` 带 LICENSE，其余主题来源需补 | 低 | P3 补 `sounds/CREDITS.md`（Kenney CC0、Junkala CC0 等） |
| 7 | Linux 需 `paplay`/`ffplay`/`mpv` 之一 | 低 | `doctor` 检测并给出安装建议 |
| 8 | 插件更新可能覆盖插件目录 | 低 | 配置统一放 `${CLAUDE_PLUGIN_DATA}` 或 `~/.claude-dida/` |

---

## 11. 附录：Hook 输入字段（用于诊断）

所有 Hook 通过 stdin 收到基础字段：

```
session_id, transcript_path, cwd, hook_event_name, permission_mode
```

- `Stop` / `SubagentStop` 额外含 `stop_hook_active`
- `Notification` 额外含 `message`、`title`、`notification_type`
- `SessionStart` 额外含 `source`

`play` 子命令不使用这些字段，仅 `doctor` 在调试模式下打印。

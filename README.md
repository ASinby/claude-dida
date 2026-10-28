<p align="center">
  <img src="./assets/logo.svg" alt="claude-dida logo" width="160" height="160">
</p>

# claude-dida

Claude Code 声音反馈插件。任务完成、需要输入、出错时播放提示音，内置 6 套可选音效主题。

跑长任务时切走也不用心算时间——听声音就知道 Claude 是在等你确认、还是刚干完活。

## 安装

```bash
claude --plugin-dir ./claude-dida
```

或者作为插件市场安装（见下方「发布到市场」）。

**环境要求**：Node ≥ 18。零 npm 依赖，不需要 `npm install`。

## 快速开始

```
/dida-setup
```

首次使用先选一套主题，插件会逐个试听。选定后自动记住，之后每个会话直接沿用。

## 事件与音效

| 事件 | 触发时机 | 音效 | 默认 |
|---|---|---|---|
| `SessionStart` | 新会话启动 | `session-start` | 开 |
| `Stop` | 每轮回复结束 | `task-complete` | 开 |
| `Notification` | 请求权限批准 | `need-input` | 开 |
| `Notification` | 等待用户输入 | `idle` | 开 |
| `PostToolUseFailure` | 工具调用失败 | `error` | 开 |
| `StopFailure` | 整轮失败（限流/鉴权/服务端错误） | `error` | 开 |
| `SubagentStop` | 子代理结束 | `task-complete` | **关** |

`Stop` 的语义是「每轮回复结束」，不是「整个任务真正完成」。长对话里它会响得比较勤——嫌吵就 `/dida-off`，或只关掉这一个事件（见下）。

`SessionStart` 只在 `startup` 时响，`resume` / `clear` / `compact` 不响。

`SubagentStop` 默认关闭：子代理结束得频繁，开着容易变成噪音。

## 命令

| 命令 | 用途 |
|---|---|
| `/dida-setup` | 交互式选择主题（含试听） |
| `/dida-preview [主题] [音效]` | 试听全部或单个音效 |
| `/dida-theme <主题>` | 直接切换主题 |
| `/dida-doctor` | 健康检查：Node、配置、音效、播放器、Hook、日志 |
| `/dida-on` / `/dida-off` | 总开关 |

## 配置

配置文件：`~/.claude-dida/config.json`。

放在插件目录之外，插件更新不会覆盖你的配置。

> **为什么不跟随 `CLAUDE_PLUGIN_DATA`**：hook 进程能拿到这个变量，但 slash 命令走的 Bash 工具拿不到。若跟随它，`/dida-setup` 会写到 A 目录、而 hook 从 B 目录读配置，表现为「设置成功但永远不响」。所以两条路径统一写死到 `~/.claude-dida/`。

```json
{
  "theme": "minimal",
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

命令行改配置：

```bash
node scripts/dida.mjs set theme sci-fi
node scripts/dida.mjs set volume 0.4
node scripts/dida.mjs set events.idle false
node scripts/dida.mjs set quietHours.enabled true
node scripts/dida.mjs set quietHours.start 23:00
node scripts/dida.mjs set subagentStop true
node scripts/dida.mjs get          # 查看当前配置
node scripts/dida.mjs reset        # 恢复默认
```

### 字段说明

- **`theme`**：主题名。`null` 表示尚未选择，此时使用 `default` 主题发声，并在 `SessionStart` 注入一次引导提示。
- **`volume`**：0 ~ 1，写入时自动钳制。
- **`enabled`**：总开关，`false` 时所有事件静默。
- **`events.*`**：事件级开关，细粒度控制。
- **`subagentStop`**：`SubagentStop` 单独判断，默认关。
- **`dedupeMs`**：同一事件的去抖窗口。`PostToolUseFailure` 和 `StopFailure` 共用 `error` 音效，靠它避免叠音。
- **`quietHours`**：静默时段，支持跨午夜（如 `22:00` ~ `08:00`）。
- **`overrides`**：把某个事件映射到自定义 mp3 绝对路径。路径不存在时回落到主题内置音效。
- **`playbackMode`**：`detach`（默认，拉起独立播放器后立刻返回）或 `inline`（同步播放，兜底用）。

## 主题

内置 6 套：`default` `fantasy` `minimal` `nasa` `retro` `sci-fi`，每套 5 个音效。

`default` 是回退主题：用户还没选过主题时，所有事件都用它发声。选定主题后 `default` 就不再参与播放。

自定义主题：在 `sounds/` 下建一个目录，放齐 5 个 mp3，文件名必须是 `session-start.mp3` `task-complete.mp3` `need-input.mp3` `idle.mp3` `error.mp3`。`/dida-doctor` 会自动识别并校验完整性。

## 工作原理

每次事件都是一个短命 Node 进程，拉起独立播放器后立刻退出（实测约 100ms），不阻塞对话：

```
hooks.json → node dida.mjs play <event> → 读配置/判开关/去抖
          → spawn 播放器（detached）→ exit 0
```

几个刻意的设计：

- **`hooks.json` 恒定注册全部事件**，开关判断在脚本内完成。所以 `/dida-off` 立即生效，不用改 hook 配置。
- **所有异常路径一律 `exit 0`**。Hook 返回非零码会被 Claude Code 当成错误展示给用户，提示音插件不该有这种存在感。
- **Windows 用 `-EncodedCommand`**：Hook 命令经 `cmd.exe` 解析，路径含空格或 `&` 时引号规则极易出错。整段 PowerShell 脚本 base64 编码后只剩下 `A-Za-z0-9+/=`，从根上绕开引号问题。
- **`async: true` 与 detach 是双保险**：即便运行时不认 `async`，脚本也会在一百毫秒内自行退出。

## 跨平台

| 平台 | 播放器 |
|---|---|
| Windows | PowerShell + `PresentationCore` MediaPlayer |
| macOS | `afplay` |
| Linux | `paplay` → `ffplay` → `mpv`，取第一个可用的 |

Linux 上三个都没有时，`/dida-doctor` 会报出来并给出安装建议。

## 排错

先跑 `/dida-doctor`，它会逐项报告 Node 版本、配置路径与内容、主题完整性、播放器可用性、Hook 注册状态和最近错误日志。

错误日志：`~/.claude-dida/error.log`（上限 64KB，超出后保留最后 200 行）。

常见问题：

- **没声音**：确认 `default/` 目录完整、`enabled` 是 `true`、不在静默时段内、对应事件开关是开的。
- **Hook 环境找不到 `node`**：nvm4w 等版本管理器装的 Node 可能不在 `cmd.exe` 的 PATH 里。`/dida-doctor` 会暴露该问题，届时把 `hooks.json` 里的 `node` 换成绝对路径。
- **叠音**：调大 `dedupeMs`。

## 发布到市场

```
/plugin marketplace add <你的仓库>
```

## 音效来源

全部音效下载自 [Pixabay 音效库](https://pixabay.com/zh/sound-effects/)，适用 [Pixabay Content License](https://pixabay.com/service/license-summary/)——**不是 CC0**。该许可允许商用与修改、无需署名，但禁止把音效作为数字内容单独再分发。

本插件以明文文件形式随包分发 mp3，与「嵌入应用二进制」的情形不同，公开发布前请阅读 `sounds/CREDITS.md` 中的说明。自用无碍。

## 许可

MIT

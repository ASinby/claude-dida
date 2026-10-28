---
description: 选择 claude-dida 声音主题
allowed-tools: Bash, AskUserQuestion
---

为用户选择声音主题。

1. 运行 `node "${CLAUDE_PLUGIN_ROOT}/scripts/dida.mjs" themes` 获取主题列表（带 `*` 的是当前生效主题）。
2. 对每个主题运行 `node "${CLAUDE_PLUGIN_ROOT}/scripts/dida.mjs" preview <theme> task-complete` 让用户试听。`default` 也可以试听，它就是未选主题时的回退音效。
3. 用 AskUserQuestion 让用户选择主题，选项里写清主题名与听感差异。
4. 运行 `node "${CLAUDE_PLUGIN_ROOT}/scripts/dida.mjs" set theme <所选主题>`。
5. 运行 `node "${CLAUDE_PLUGIN_ROOT}/scripts/dida.mjs" preview <所选主题>` 播放全部 5 个音效确认。
6. 简短告知用户已生效，并提示 `/dida-preview`、`/dida-off`、`/dida-doctor` 的用途。

若 `themes` 输出为空或报错，直接报告错误并提示运行 `/dida-doctor`，不要编造主题名。

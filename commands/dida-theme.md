---
description: 切换 claude-dida 声音主题
argument-hint: "<主题名>"
allowed-tools: Bash
---

切换声音主题。

主题名：`$ARGUMENTS`

1. 运行 `node "${CLAUDE_PLUGIN_ROOT}/scripts/dida.mjs" set theme $ARGUMENTS`。
2. 成功后运行 `node "${CLAUDE_PLUGIN_ROOT}/scripts/dida.mjs" preview $ARGUMENTS task-complete` 试听确认。
3. 若命令报「未知主题」，先运行 `node "${CLAUDE_PLUGIN_ROOT}/scripts/dida.mjs" themes` 列出可用主题告知用户，不要自动替用户选一个。

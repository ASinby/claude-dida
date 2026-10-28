---
description: 打开 claude-dida 声音
allowed-tools: Bash
---

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/dida.mjs" on
```

运行上面的命令，然后一句话确认已开启。若 `theme` 为 `null`（当前在用默认音效），可顺带提一句运行 `/dida-setup` 能换成其它主题——用 `node "${CLAUDE_PLUGIN_ROOT}/scripts/dida.mjs" get` 确认。

---
description: 试听 claude-dida 音效
argument-hint: "[主题] [音效]"
allowed-tools: Bash
---

试听音效。

参数：`$ARGUMENTS`

- 无参数 → 播放当前主题的全部 5 个音效
- 只给一个参数 → 视为主题名，播放该主题全部音效
- 给两个参数 → 视为 `<主题> <音效>`

执行：

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/dida.mjs" preview $ARGUMENTS
```

把命令输出原样转述给用户。若提示「未知主题」或「缺失音效」，把命令给出的可用列表一并告知，不要自行猜测名称。

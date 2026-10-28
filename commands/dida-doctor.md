---
description: claude-dida 健康检查
allowed-tools: Bash
---

运行健康检查并把诊断结果转述给用户。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/dida.mjs" doctor
```

把输出原样展示给用户，然后针对每条 `[warn]` / `[fail]` 给出一句可操作的建议：

- 主题未选择 → 提示运行 `/dida-setup`
- Node 版本过低 → 需要升级到 18 以上
- 无可用播放器 → 按 doctor 给出的平台建议安装（Linux 需 `paplay` / `ffplay` / `mpv` 之一）
- 有错误日志 → 连同最后的日志行一起说明可能原因

不要用猜测填补 doctor 没有报告的信息。

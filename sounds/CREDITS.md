# 音效来源与许可

## 来源

全部音效（`default` `fantasy` `minimal` `nasa` `retro` `sci-fi`，6 套 × 5 个）下载自 [Pixabay 音效库](https://pixabay.com/zh/sound-effects/)。

## 许可：Pixabay Content License

**允许**

- 商业与非商业用途，无需付费、无需授权申请
- 修改、剪辑、混音
- 无需署名（署名是受欢迎的，但不是义务）

**不允许**

- 把音效本身作为数字内容单独再分发或销售（例如传回素材站、做成音效库出售）
- 在版权保护系统中登记（YouTube Content ID、Steam 等）
- 暗示原作者或 Pixabay 为本项目背书

许可全文：<https://pixabay.com/service/license-summary/>

## 分发时需要注意的一点

Pixabay 禁止「把音效当作数字内容单独再分发」，并要求「若项目允许下载或提取资源，需确保用户无法直接访问原始音频文件」。

本插件的 mp3 直接以文件形式放在 `sounds/` 下，安装者可以原样取走。这与「嵌入游戏或应用二进制」的情况不同，属于授权条款的灰区：

- **自用 / 本机使用**：没有问题
- **公开发布插件**：存在上述灰区。若要严格合规，可考虑
  - 只发布代码，音效由用户自行准备（`/dida-doctor` 会提示缺失）

## 替换音效

在 `sounds/<主题名>/` 下放齐这 5 个文件即可，文件名固定：

```
session-start.mp3
task-complete.mp3
need-input.mp3
idle.mp3
error.mp3
```

`default/` 必须保持完整——用户未选择主题时所有播放都会回退到它。

运行 `/dida-doctor` 会校验主题完整性与文件缺失情况。

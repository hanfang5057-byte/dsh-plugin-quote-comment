# dsh-plugin-quote-comment

Ask for a comment before inserting a quoted selection in the DeepSeek Harness Web GUI,
and insert the quote and the comment as **one** block.

Select text in a chat → click **Quote text** → write a comment → Save. The composer then
holds a single quote chip, and the sent message is one blockquote:

```
> the quoted text
>
> [Comment]
> your comment
```

The marker is `【评论】` in Chinese and `[Comment]` in English. Saving an empty comment
inserts the quote alone, exactly like the shipped action.

## Install

In Harness: **Plugins → Experimental plugins → Custom plugin indexes**, then **Discover**
→ add this index URL:

```
https://gitee.com/hanfang5057/dsh-plugin-quote-comment/raw/main/market/index.json
```

## Compatibility

Requires DSH `^0.2.2-0`. The plugin replaces the shipped quote cell in the
`conversation.chat.text-interaction` slot; if `message-quotes` is disabled, the button
does not appear at all.

## Limits

- The quote and the comment are one atomic chip, so they cannot be edited separately —
  remove the chip and quote again to change the comment.
- While the composer is sending or in command mode, clicking inserts nothing.

## 中文说明

选中对话里的文本后，「引用文本」按钮会先弹窗索要一条评论，再把引用与评论作为**一个整体**
插入输入框；发送出去是一条引用块，评论以 `【评论】` 单独起段。评论留空则只插入引用，与原生一致。

引用与评论是一个原子 chip，不能分别编辑；输入框发送中或处于命令态时点击不会插入任何内容。

## Development

Zero build: `client.js` is the whole browser module. The only automated check is
`node --check client.js`. `AGENTS.md` records the DSH contracts this plugin depends on
and must be re-read after a DSH upgrade.

## License

MIT

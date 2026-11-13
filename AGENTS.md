# AGENTS.md

面向在本仓库工作的 AI 编码代理的约定。一句话版本：这是一个**零构建**的 DeepSeek Harness（DSH）Web 客户端插件包，唯一产物是浏览器直接执行的 `client.js`；改完保存即可，运行中的页面会热替换，不需要安装、编译或重启。

## 项目是什么

- 包名 `dsh-plugin-quote-comment`，版本 0.2.0，无依赖、无构建、无测试套件。仓库已是 git 仓库；除用户明确要求外，不要提交或推送。
- 作用：接管 DSH 对话里选区浮出的「引用文本」按钮；右侧栏文件预览里的选区也能引用。点击后先弹窗索要一条评论，再把**引用原文 + 评论**（预览引用还带**来源**）作为**一个整体**插入输入框。
- 用户可见说明在 `docs/DETAIL.md`；插件展示文案（标题 / 描述 / 详情路径）在 `locale/*.json`。
- 目标宿主是本机已安装的 DSH（`desktop` profile）。profile 用 `link:` 依赖指向本目录，因此**改代码不需要重新安装 bundle**；也不要手工编辑 `~/.dsh/profiles/desktop` 下的文件。

## 文件地图

| 文件 | 职责 | 何时改 |
|---|---|---|
| `client.js` | 全部行为：字典、样式、按钮、弹窗、broker、预览桥与选区浮层、四个 slot 注册 | 几乎总是在这里 |
| `index.js` | Host 侧空 `apply()`，只为让 bundle 有一条可激活的插件行 | 基本不动 |
| `cordis.patch.yml` | 插入插件行的 loader patch（行 id `quote-comment`） | 改行 id / 行配置时 |
| `package.json` | `dsh.bundle` / `dsh.client` 清单、`exports`、`files` | 新增文件、改入口或注入依赖时 |
| `locale/{zh,en}.json` | 插件管理页的 `meta.title`、`meta.description`、`meta.detail` | 能力描述或详情路径变化时 |
| `docs/DETAIL.md` | 面向用户的行为说明与限制 | 任何用户可感知的行为变化 |
| `icon.svg` | 插件图标 | 改视觉标识时 |
| `market/index.json` + `market/icons/` | 插件市场索引（format 1）与索引用的图标副本 | 发版、改上架文案时 |

`files` 数组要覆盖所有运行期文件。本地 `link:` 安装不会按它过滤，但发布 / 打包会。

## 架构

浏览器侧只有一个模块，通过 `window.__ModuleLoader__.load({ id, factory })` 注册；factory 返回 `{ name, inject: ['slots', 'locale'], apply }`。一次交互的路径：

1. `message-quotes` 插件判定选区可用并 open 交互，Chat 通过 slot `conversation.chat.text-interaction` 渲染 key 为 `quote` 的 cell。
2. 本插件注册同一 key、`priority: -1`，从而取代内置按钮（数值更低者优先渲染）。
3. 点击 → `broker.ask()` 打开挂在 `shell.overlay` 的弹窗（`id: 'quote-comment.dialog'`，`order: 20`）。
4. 保存 → `buildBlock()` 拼出引用文本与 chip 摘要 → `inputActions.insertQuote(text, summary)`。
5. 输入框里是**一个**原子 quote chip；发送时由 composer 逐行加 `> ` 前缀。

文件预览走第二条路径（预览区没有 text-interaction 座位）：

1. `conversation.input.dock`（session 作用域）上一个**渲染 null** 的桥 `PreviewComposerBridge` 把该会话的 `inputActions` / `phase` / 可写性登记到模块级 `previewBridges`（按 sessionId 引用计数）。
2. `shell.overlay` 上的 `PreviewQuoteAction` 监听 `selectionchange`，只在选区落在 `[data-document-preview]` 内、取得到会话桥、输入框可写且 `phase === 'plain'` 时，紧贴选区浮出按钮。
3. 点击 → 同一个 `broker.ask()`（多带一个 `source`）→ 同一个弹窗 → `buildBlock(text, comment, t, source)` → 该会话的 `inputActions.insertQuote`。

`broker` 是插件内部的 observable + Promise 桥：`pending` 供弹窗订阅，`ask/answer/cancel` 负责结算。Host 侧没有任何逻辑，也不参与模型请求。

`window.__ModuleLoader__.load({ id })` 的 `id` **必须等于包名**：Host 用包名作为 boot graph 的 entry id，不一致会导致客户端模块无法物化。改包名时同时改这里与样式标签 id。

## 不可破坏的约定

### 引用块格式

- 评论必须写进**引用文本内部**。draft 模型只把「quote 节点内的文本」和引用绑定；quote 之后的普通文本一定会序列化成另一段，评论放在外面就会裂成两个块。
- 评论之前用**独立标记行** `【评论】`（英文 `[Comment]`）分隔，而不是靠空行。空行在多段引用里无法区分引用与评论，读者和模型都会把评论读成又一段被引用的原文。
- 评论留空时必须回到原生行为：只插入引用，不传 `summary`。
- 发送后的形态（`docs/DETAIL.md` 有同款示例）：

  ```
  > 被引用的原文
  >
  > 【评论】
  > 你写的评论
  ```

- chip 的 `summary` 是 `{ label, title, body }`：`label` 为 `引用 · N 行`（英文区分单复数），`title` 是完整引用文本，`body` 是评论。

### 接管方式

- slot：`conversation.chat.text-interaction`，`key: 'quote'`，`priority: -1`。
- 内置 cell 没有显式 priority；`-1` 让它排在前面。**不要**改掉这个值：同 key 同 rank 的两个 cell 谁渲染取决于注册顺序，不再是有意遮蔽。
- 按钮只在会话可写时显示：`!s.removed && (s.subagent === null || s.subagent.address.mode === 'continuable')`，与内置实现一致；不可写时 effect 调用 `dismiss()`。
- 注册必须走 `ctx.slots.inject(ownerKey, () => ctx.slots.register(...))`，这样 owner 声明塌陷时注册会被回收。

### 弹窗状态机

- 同一时刻只允许一个待处理请求：新的 `ask()` 先把旧请求以 `null` 结算，否则旧 Promise 永远挂着。
- 取消路径（点「取消」/ `Esc` / 点遮罩）不调用 `insertQuote`，不插入任何内容；焦点还给打开前的元素，但仅当它仍 `isConnected` 且是可编辑元素或按钮——插入成功后不要从 composer 抢焦点。
- 输入框忙（`phase !== 'plain'`，发送中 / 命令态）时点击按钮保持原生表现：什么都不插，也不弹窗收集注定要丢的评论。
- 保存时若 `insertQuote` 返回 `false`（弹窗打开期间输入框被占用），带着已写评论重新打开弹窗并显示错误，不能丢用户输入。
- 打开时聚焦 textarea；`Tab` 在弹窗内循环；`Esc` 取消；`⌘/Ctrl + Enter` 保存；弹窗带 `role="dialog"` 与 `aria-modal`。
- 打开前先 `dismiss()` 收起浮层按钮，再进入弹窗。

### 预览引用

- 预览区**没有** text-interaction 座位；选区由本插件自己在 `shell.overlay` 里监听，不要给预览加 cell 或改预览组件。
- 会话桥：`conversation.input.dock` 上一条渲染 `null` 的注册（`id: 'quote-comment.preview-bridge'`）。只靠会话作用域的标准 props 拿 `inputActions`；不要在别处找 composer API，也不要用反射拿内部对象。
- 会话归属：选区祖先的 `[data-sidebar-right-session]`；取不到时解析预览根的 `data-textpreview-url`（`dsh-resource://file/session/<sid>/<path>`）。这两个属性是**内部标记**，升级 DSH 后先核对。
- 只有这些预览会浮出按钮：Markdown、代码、纯文本、PDF / Office（PDF 文本层）。HTML 渲染在沙箱 iframe 里、表格是单元格选择、图片没有文字——读不到选区，不要试图兜底。
- 行号只来自真实源码行：纯文本读 `[data-textpreview-line]`，代码数 `pre` 里行与行之间的换行（行号是 `::before`，不进选区）。Markdown / PDF 只写路径，不要用渲染行数冒充源码行。
- 浮出条件：选区非空、落在 `[data-document-preview]` 内、桥存在、`phase === 'plain'`、会话可写、预览可见（rect 非零）。弹窗打开期间（`pending !== null`）绝不显示。
- 浮层按钮的定位放 `shell.overlay`（`id: 'quote-comment.preview-action'`，`order: 18`），`position: fixed` 按视口坐标算；不要挂进预览面板，否则会被面板的 overflow 裁剪。
- 来源必须写进**引用文本内部**，且排在 `【评论】` 之前：`【来源】路径:起-止`（英文 `[Source]`）。它有源码行时写 `:12` / `:12-18`，没有就只写路径。
- chip 的 `label` 只数正文行（不含来源行），`title` 是含来源行的完整引用。

### 资源与清理

- 所有注册都包在 `apply` 内的 `ctx.effect(...)` 里：字典、样式、待处理请求、四个 slot 注册、`previewBridges` 的兜底清空。
- 样式表按持有者计数挂载 / 移除（`styleHolders`），两个挂载点不会互相删样式。
- 不要写组件外的 DOM、不要 `document.body.appendChild`、不要替换 app root。

### 国际化

- 所有用户可见文案只能来自 `ctx.locale` 字典（命名空间 `quoteComment`），组件通过 `t(...)` 取；slot 注册声明 `locale: NS`，overlay 弹窗用 `ctx.locale.bind(NS)`。
- 中英字典必须同时改。中文没有单复数，英文要同时维护 `chip.label` / `chip.labelOne`。
- 不要在 JSX 里硬编码中文或英文；`aria-label` 同样走字典。
- `locale/*.json` 只放插件展示元数据，不放运行期文案。

### 样式

- 只用主题 token：`--dsw-alias-*`、`--ds-*`；字面颜色只允许出现在图标等 artwork 中。
- 类名前缀 `qc-`，动画名 `qc-fade`，样式标签 id `dsh-plugin-quote-comment/page.css`。
- 外观要与内置弹窗一致：遮罩、`radius-panel`、`elevation-prominent`、短 fade，并尊重 `prefers-reduced-motion`。
- 不要 import 任何 `@deepseek-ai/dsh-client-*` 包；React 从模块表 `require('react')` 取。`dsh.client.inject` 里的四个包只用于激活顺序，不是可 import 的依赖。
- 不要读其他插件的 DOM 或样式来推断位置。

## 开发循环

没有 `npm install`、没有构建、没有测试脚本、没有 linter。不要为了「补齐工程化」引入打包器、依赖或测试框架。

```sh
node --check client.js    # 唯一的自动检查：语法（package type: module）
```

生效方式：

1. 保存 `client.js` → Host 端 HMR 轮询该包的 client 入口（默认 500ms，按 mtime / ctime / size 判断），向页面推送 rebuilt，插件被重新执行并重挂载，**无需刷新页面**。
2. 热替换是整体重来：插件内 React 状态会丢，Session 与草稿不受影响；替换失败不会回滚，旧 fiber 已被拆除——语法错误要立刻修，或在 Settings → Plugins 里重试。
3. 改 `package.json` 的 `dsh` / `exports` 或 `cordis.patch.yml`：重启 DSH，让插件图重新组合。
4. 改 `locale/*.json` 不在 HMR 监听范围内：刷新页面或重启后查看。

## 发布

- 包名已是可发布形态：`dsh-plugin-quote-comment`，无 `private`。`engines.dsh` 必须写 `^0.2.2-0`：当前 DSH 是 `0.2.2-rc.2`，SemVer 默认排除预发布版，写成 `^0.2.2` 会判为不兼容并**阻止安装**。
- `0.2.0` 为当前最新（`0.1.0`、`0.1.1` 也已发布），索引用 **npm 源**（`{"type":"npm"}`）。每次发版：`npm publish --access public`，再在 `versions[]` 追加一条（`version` 精确 SemVer、`publishTimestamp` 为 **Unix 秒**）。
- 账号开了 2FA 时，CLI 发布需要 granular token 勾选 **Bypass two-factor authentication**，或 `--otp=<code>`；`_authToken` 必须写在 `//registry.npmjs.org/:_authToken` 下——主机名拼错（如 `npmns`）会静默失效，表现为莫名其妙的 403。
- 备选：改用 **git 源**（`type: "git"` + 40 位 commit），不依赖 npm 账号；代价是每次发版都要更新 commit。
- `market/index.json` 与 `market/icons/` 一起托管在任意 https 静态地址；`icon` 是相对索引 URL 的路径。用户侧：Plugins → Experimental plugins 打开 **Custom plugin indexes** → Discover 添加索引 URL。
- 自检：把文档交给真实校验器 `parseMarketIndex(doc, indexUrl)`（`@deepseek-ai/dsh-plugin-market-index`，在 DSH 安装内，用 `ELECTRON_RUN_AS_NODE=1` 从 app.asar 动态 import）。
- 市场只认索引 JSON，**没有中心化上架流程**：能不能"被收录"取决于谁维护那份索引。

## 手工验收

改动行为后，在运行中的 GUI 里走一遍：

1. 选中已完成的助手 / 用户文本 → 浮出「引用文本」。
2. 点击 → 弹窗出现：引用内容只读在上，评论区在下且已聚焦。
3. 写评论 → 保存 → 输入框出现**一个** chip，标签为「引用 · N 行」，悬停可见引用与评论。
4. 发送 → 消息正文是单个引用块，含 `【评论】` 标记行。
5. 评论留空保存 → 只插入引用，与原生一致。
6. `Esc` / 取消 / 点遮罩 → 什么都不插入，焦点回到原处。
7. 让输入框进入发送态后点按钮 → 不插内容，也不弹窗。
8. 中英文界面、浅色 / 深色主题各看一次；控制台没有 `slot entry crashed`。
9. 右栏打开 `.md` / 代码 / 纯文本 → 拖选 → 浮出按钮 → 弹窗顶部显示 `路径:起-止` → 保存后 chip 内首行是 `【来源】路径:起-止`。
10. 代码预览的浮出按钮不把行号带进引用文本；纯文本跨行选区写成区间。
11. PDF / docx 预览：文本层可选中并引用（只写路径）；HTML 预览、xlsx 预览、图片**不出现**按钮。
12. 浮窗 / 分屏里第二个预览：按钮跟在正确 pane 的选区旁；收起右栏、切换会话、滚出可见范围后按钮消失。
13. 新会话（hero 态，尚未发送任何消息）里预览文件也能浮出按钮；输入框发送中或会话不可写时不显示。
14. 预览引用取消 / 遮罩 / `Esc`：不插入、不清选区；保存时输入框被占用则带着评论重开并提示。

## 常见改动

- **改文案 / 加语言**：同时改 `client.js` 的 `zh` / `en` 字典与 `locale/*.json` 的 `meta`；新增语言还要给 `locale/<lang>.json`。
- **改弹窗外观**：只动 `CSS` 字符串与结构，保留对话框语义（`role="dialog"`、`aria-modal`、标题、焦点陷阱、按钮顺序）。
- **改插入格式**：同时改 `buildBlock()`、`block.label` 字典、`docs/DETAIL.md` 的示例，以及本文件的「引用块格式」。
- **改图标 / 详情**：见下方「边界与现状」中的规范差异说明。

## 依赖的 DSH 接口（版本敏感）

本机 DSH 实现位于 `app.asar` 内（`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/`）。shell 的 `ls` / `rg` 打不开它，**用文件读取工具**按绝对路径读。升级 DSH 后先核对这些契约，再改代码：

- `ctx.slots.inject(key, () => ctx.slots.register(options, Component))`；`priority` 越低越先渲染（`docs/subsystems/slots.md`）。
- `conversation.chat.text-interaction` 的 props：`dismiss`、`readText`、`clearSelection`、`inputActions`、`useSession`、`useInput`、`t`。
- `inputActions.insertQuote(text, summary?): boolean`：`phase !== 'plain'`、`text` 全空白或草稿拒绝时返回 `false`。
- `conversation.input.dock`（list、session 作用域）与 `conversation.chat.text-interaction` 一样自动获得标准 props `sessionId`、`useSession`、`useInput`、`inputActions`：标准 props 按**座位 scope** 注入，与注册包无关（`docs/subsystems/slots.md` 的 “standard props” 表）。
- 预览标记（均为内部属性，非公开契约）：预览根 `data-document-preview`（渲染器 id）与 `data-textpreview-url`（`dsh-resource://file/session/<sid>/<path>`）、纯文本行 `data-textpreview-line`、头行 `data-textpreview-path`、右栏面板 `data-sidebar-right-session`、预览正文 `data-textpreview-body`。来源：`@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/TextPreview.tsx`、`PreviewFrame.tsx`、`text/TextBody.tsx`、`code/CodeBody.tsx`，以及 `@deepseek-ai/dsh-client-ui-sidebar-right/src/client/shell/SidebarRight.tsx`。
- `inputActions.insertQuote` 不需要焦点：插到编辑器保留的插入点（无则草稿末尾）并自动聚焦；预览引用正是依赖这一点。
- 内置引用实现：`@deepseek-ai/dsh-message-quotes/src/client/index.ts` 与 `QuoteSelection.tsx`（key `quote`、无 priority；交互 admission 在 `uiConversation.interactions`）。
- Chat 侧说明：`@deepseek-ai/dsh-client-ui-chat/README.md`；slot 与 composer 契约在 `@deepseek-ai/dsh-client-ui-conversation/src/client/contract/slots.ts`、`input.ts`。
- 客户端清单与 HMR：`@deepseek-ai/dsh-client-modules/src/index.ts`（解析 `exports["./client"]`、`artifactBaseline`、`/plugins/??<id>/client.js&rev=` 组合脚本）、`@deepseek-ai/dsh-client-hmr`。

接口不可用时不要猜：先读上面这些文件；读不到就报告「未验证」，不要凭记忆改 API。

## 边界与现状

- 插件启用期间接管**所有会话**的引用按钮；`message-quotes` 被禁用时对话里的按钮不会出现（本插件只替换 cell，不自己判定对话选区）。
- 预览引用独立于 `message-quotes`：它自己判定选区，不依赖该插件的交互准入。
- 预览引用的可用范围：Markdown / 代码 / 纯文本 / PDF / Office（PDF 文本层）。HTML（沙箱 iframe）、表格（单元格选择）、图片（无文字）不支持；行号只有代码与纯文本能给出。
- 引用与评论是一个原子 chip，不能分别编辑；要改评论就删掉 chip 重新引用。
- 对话选区为空、输入框忙、会话不可写时按原生逻辑处理，不做额外提示；预览选区在这些条件下直接不显示按钮。
- **详情文档现状与 DSH 插件规范有偏差**：DSH 期望 `meta.detail` 指向「一张特性图」的文档，用法写在 `meta.description`，中文应指向 `DETAIL.zh.md`；当前 `docs/DETAIL.md` 是纯文字说明，中英 `meta.detail` 都指向它，也没有 `preview.svg`。若要与规范对齐：把用法 / 限制迁进 `meta.description`，补 `docs/preview.svg`，给中文单独 `docs/DETAIL.zh.md`，并同步 `files` 与两个 locale。不改也能正常工作。

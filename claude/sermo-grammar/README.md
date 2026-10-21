# sermo-grammar (Claude Code)

> 已废弃：sermo-translate v0.4.3 起在提交时自动完成「外语→英文 + 英文修语法」（见同仓库 sermo-translate 的「出站」一节），本插件已从 `CLAUDE_CODE_PLUGIN_DIRS` 和 `keybindings.json` 移除，代码留作参考。`Ctrl+G` 恢复为 Claude Code 默认的外部编辑器。

检查**输入框里的英文**，指出语法问题，并给出更自然的写法。手动触发，结果可直接替换回输入框。

写给母语是中文、但想用英文跟 Claude 对话的人：不确定语法对不对，或者某个中文词该用哪个英文词时，按一下键就知道了。

## 安装

已经装好了。两种方式：

**1. 全局加载（当前采用）** —— 写进 `~/.claude/settings.json`：

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/Users/jhao/Projects/sermo/claude/sermo-grammar"
  }
}
```

**2. 单次会话加载**（开发时改代码会热重载）：

```bash
claude --plugin-dir ~/Projects/sermo/claude/sermo-grammar
```

## 用法

在输入框里写好英文（可以夹中文），然后：

| 触发 | 操作 |
|---|---|
| **`Ctrl+G`** | 检查当前输入框（单键，推荐） |
| `Ctrl+X Ctrl+G` | 同上（备用） |
| `/grammar` | 同上 |
| `/grammar <文本>` | 直接检查给定的文本（不读输入框） |

> `Ctrl+G` 原本是 Claude Code 的“用外部编辑器打开输入框”（`chat:externalEditor`），现在被本插件占用。外部编辑器仍在 **`Ctrl+X Ctrl+E`**（Claude Code 的另一个默认绑定，已实测确认仍可用）。
>
> 不想要这个取舍的话，把 `~/.claude/keybindings.json` 里的 `ctrl+g` 换成别的没被占用的键（`ctrl+e`、`ctrl+k`、`ctrl+y` 之类），或者删掉那行、继续用 `Ctrl+X Ctrl+G`。

面板里（界面和解释都是英文）：

| 按键 | 操作 |
|---|---|
| `a` | **Replace prompt** —— 用改写稿替换输入框，然后按 Enter 发送 |
| `c` | **Copy** —— 只复制改写稿 |
| `o` | **Revert** —— 还原成你原来写的原文 |
| `q` / `Esc` | **Close** —— 关闭并把原文还回输入框 |

> **面板打开时输入框是空的**，这是故意的：Claude Code 只在输入框为空时把键盘交给面板（否则 `focus` 会被拒），所以检查期间草稿先收进面板，`Esc` / `q` 会原样还回去。
>
> 如果面板没拿到焦点（终端太窄等），面板里会提示按 `Ctrl+X Tab` 手动聚焦。

面板列出三块：**逐条问题**（原文 → 修改 + 英文说明）、**Chinese → English**（你夹在里面的中文词对应哪些英文说法）、以及 **Rewritten prompt**（整段改写稿）。

在 `claude -p` / SDK 这类没有界面的场合，报告会作为文本直接返回，不画面板。

快捷键定义在 `~/.claude/keybindings.json`，改键就改那里。

## 为什么能读到"输入框"

Claude Code 的 mods API 提供了三个刚好够用的能力，不需要额外的 API key：

- `$.prompt.read()` —— 读当前草稿（含光标位置）
- `$.prompt.fill({ text, mode })` —— 把文本写回输入框（`replace` / `append` / `insert`）
- `$.model.complete({ model, system, prompt })` —— 走**本会话自己的模型凭证**跑一次无历史、无工具的补全，不占对话上下文、不产生 transcript

模型固定用 `haiku`（快且便宜）。改 `hooks/register.js` 里的 `MODEL` / `MAX_TOKENS` 即可。

解释语言由 `SYSTEM` 提示词里的这条控制（现在要求全英文）：

```
- Explain every "why" and "note" in plain English, not Chinese.
```

想改回中文解释，把这条改成 `in Simplified Chinese`，以及同段的 `"why" in Simplified Chinese` / `"note" in Simplified Chinese` 注释。

## 实现要点

- `prompt.edit` 钩子有 **50ms** 预算，装不下一次 LLM 调用，所以不做实时下划线；改成手动触发时读草稿。
- `prompt.read()` 在命令已提交后可能拿到空串，因此用 `prompt.edit` 维护一份 `lastDraft` 兜底，并支持 `/grammar <文本>` 显式传入。
- 无界面判定用 `$.session.surfaces().length === 0`（`$.ui.open()` 在没有界面时也返回 `isPlaced: true`，不能用它判断）。

## 文件

```
claude/sermo-grammar/
├── .claude-plugin/
│   ├── plugin.json          # 插件清单
│   └── types/               # Claude Code 自动生成的 mods API 类型（勿手改）
├── hooks/
│   ├── hooks.json           # 指向下面的模块
│   └── register.js          # 全部实现
└── README.md
```

## 校验与调试

```bash
claude plugin validate ./claude/sermo-grammar   # 静态检查
claude --debug                                          # 看 keybindings / mod 加载错误
```

在会话里 `/plugin` → Installed 可以看到它是否加载。

## 已知的坑

- **改完 `keybindings.json` 要重启会话**（新建的文件尤其）：文件在启动时读入，热重载对已存在的文件才可靠。
- **`Option+G` 这类 `meta` 绑定在本机无效**：终端没把 Option 当 Meta 发送，macOS 直接把 Option+G 变成了字符 `©`。这是终端设置问题，不是插件问题，所以改用 `Ctrl+G`。想用 meta 得先在终端里打开 “Option as Meta”（Terminal.app / iTerm2 / Ghostty / WezTerm 各有开关）。
- `Ctrl+G` 占用了原来的外部编辑器快捷键；外部编辑器保留在 `Ctrl+X Ctrl+E`。
- 快捷键触发时 Claude Code 是“像输入了 `/grammar` 一样”执行命令（会短暂把 `/grammar` 放进输入框），但已被实测确认**不会吃掉你的草稿**。
- 面板按钮的热键只在面板拿到键盘时生效 —— 所以才有“检查期间输入框为空”这个设计。

## 实测记录

用 `expect` 驱动真实的 TUI 会话验证过（非 headless）：

- `Ctrl+X Ctrl+G` ✓ 打开面板，草稿保留
- `Ctrl+G` ✓ 单键生效，覆盖了默认的 `chat:externalEditor`
- `Option+G`（`\x1bg`）✓ 在能发送 Meta 的终端里有效；本机终端不发送，会打出 `©`
- `Ctrl+X Ctrl+E` ✓ 外部编辑器仍能打开（未被破坏）
- 面板拿到键盘焦点，`a` ✓ 关面板 + toast + 输入框变成改写稿
- 窄终端（80 列）面板以“输入框上方的框”呈现，内容会被截断

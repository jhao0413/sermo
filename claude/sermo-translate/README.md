# sermo-translate (Claude Code)

写给想用英文跟模型对话的非英语用户。

Claude 的英文回复在后台翻成你配置的语言，`Ctrl+Y` 切换回复译文显示，默认译文跟在对应的原文段落后面，也可只显示译文。你输入的提示词在发出前会被改写成英文：是外文就翻译，已经是英文就只修语法，意思不变。发出后保留原文和英文的对照。

译文和对照都只在显示层，整个对话上下文里始终只有英文。

## 配置

`/config` 面板可以直接改，或者改 `~/.claude/settings.json`（键名与安装方式对应，marketplace 装的就是 `@sermo`）：

```json
{
  "pluginConfigs": {
    "sermo-translate@sermo": {
      "options": {
        "show_by_default": true,
        "translation_only": false,
        "outbound": true,
        "lang": "zh-Hans",
        "provider": "microsoft",
        "model": "haiku"
      }
    }
  }
}
```

值要包在 `"options"` 里，直接写在插件名下面不生效。

| 选项 | 默认 | 说明 |
|---|---|---|
| `show_by_default` | `true` | 是否显示回复译文；不控制翻译服务的启停 |
| `translation_only` | `false` | 开启后已翻译的回复段落只显示译文；默认逐段显示双语对照。代码、跳过、翻译中或失败的段落保留原文，不影响用户提示词对照 |
| `outbound` | `true` | 出站链路总开关 |
| `lang` | `zh-Hans` | 你的语言，微软语言码：`zh-Hant`、`ja`、`ko`、`fr`、`de`、`es`、`ru` 等 |
| `provider` | `microsoft` | 翻译服务，见下 |
| `model` | `haiku` | `session` / `openai` 用的模型；填别名 haiku / sonnet 或完整 id |
| `base_url` | `http://127.0.0.1:8021/v1` | `openai` 的接口地址 |
| `api_key` | 空 | `openai` 用；本地 llama.cpp 随便填，不校验 |

provider 三选一：

- `microsoft`：Edge 免费接口，同 Glossa 扩展那套，免 key、快。只会翻译，英文输入没有语法检查，会原样放行
- `session`：`$.model.complete` 走本会话凭证，免配置，质量更好，耗 token。旧值 `model` 仍被接受
- `openai`：OpenAI 兼容端点，本地 llama.cpp 或远端服务

以使用本地 index-translate-2b 模型为例：

```json
"pluginConfigs": {
  "sermo-translate@sermo": {
    "options": {
      "provider": "openai",
      "model": "index-translate-2b",
      "base_url": "http://127.0.0.1:8021/v1",
      "api_key": "sk-local"
    }
  }
}
```

同一段 5000 字符的回复：微软 ~3s；haiku ~32s、译文更自然；index-translate-2b ~46s、免费，代码块保留得干净。

## 出站

`prompt.submit` 在提示词进会话之前改写它：外文翻成英文，英文只修语法、拼写、排版，没有问题就原样放行。代码围栏、标识符、文件路径、命令、URL 不碰，散文段并发 4 路。改写完成 turn 才开始，`session` / `openai` 下内容较长会先 toast 提示；转换接口失败时最多重试 3 次（首次请求之外），仍失败则取消整条消息发送并显示失败提示；任一段落最终转换失败即取消整条消息发送，不等待其他段落；同时停止排队任务、后续分块和重试，取消支持中止的在途请求，其余请求的晚到结果会丢弃。

改写结果会拒绝源语言润色、未翻译的非拉丁文字和元评论，混合输入也会校验，代码和引用里的外文允许保留。可能是英文且不含非拉丁正文的输入按完整词数检查改写幅度，混合语言翻译与法语等其他拉丁语言不套英文词重合规则。含非拉丁正文的输入首轮用明确的英文翻译指令；其他输入同时说明外文翻译与英文语法修正，避免短英文片段被当成外文，失败后再重试一次；仍失败则取消整条消息发送并提示查看日志。报错前缀（`Error:`、`Exception:`、`panic:` 等）归入技术性内容，两侧原样跳过。诊断日志会记录重试与失败原因。

粘贴的技术性内容会自动识别、原样放行：错误信息、堆栈、JSON、日志、diff（两侧都适用，回复侧同样不送翻）；俄文、阿拉伯文等 Unicode 正文正常翻译。反引号或 `~~~` 围栏（包括更长、未闭合的围栏）及缩进代码块在结构层保护，列表和引用里的代码同样保护；列表续段按容器内的相对缩进识别为正文。超长段落切成 ≤3000 字符的块再送，保留原有分隔符；每块独立检测语言，英文前缀不会让后面的外文跳过。输出被截断时视为接口失败，最多重试 3 次，仍失败则取消发送。

只拦本机敲 Enter 的提交（`origin.kind === 'composer'`）；斜杠命令、插件、peer、通知的提交不碰。中断消息提交后，不再为该消息发起重试或处理后续分块，正在进行的会话模型请求会取消；HTTP / curl 请求返回后的结果会丢弃。用户主动中断不会显示接口失败提示。原来做手动检查的 sermo-grammar 已退役，被这条链路取代。

屏幕上的对照是「原文在上、实际发出的英文引用在下」，停用翻译时隐藏对照并停止后续提示词改写。`session` / `openai` 的改写提示词会带上 `lang` 作为作者语言背景，帮模型译得更地道；出站目标始终是英文，不随 `lang` 变。

## 行为细节

- 翻译默认启用；停用时停止提示词改写和回复翻译，清除待调度任务，隐藏译文与双语对照。会话模型请求会取消；已发出的 HTTP / curl 请求返回后丢弃结果，不再继续后续分块或重试。重新启用后，渲染到的消息会重新调度，失败段落也可重试；缓存和双语对照各保留最近 500 条，更早的滚回时会重翻/回落英文行
- 防抖 1.5s：流式渲染期间计时器不断重置，回复稳定约 1.5 秒后才真正去翻。没有依赖 `turn.start` / `turn.complete`，实测这对事件不一定触发，一旦不触发整条管线就死掉
- 按空行分段，列表、标题整段翻；代码块不送翻也不插译文；长段按空行切块，单块 ≤3000 字符
- 已是目标语言的块跳过：微软靠接口的 `detectedLanguage` 和 `lang` 比对；`session` / `openai` 对 `zh` 系目标先本地数 CJK 字符，省一次调用；其他语言靠提示词约定「已是目标语言则原样返回」再逐块比对
- 诊断日志在 `/tmp/pt-live.log`，保留最近 60 条，排查看它
- `/translate only` 和 `/translate bilingual`：显示回复译文，并切换为「仅译文」或「双语对照」，复用已缓存的译文；只在当前会话生效。要默认仅显示译文，在 `/config` 开启「仅显示译文」或设置 `"translation_only": true`。隐藏译文或停用翻译时显示原文，重新显示或启用会保留选定的模式；这些命令不启用已停用的翻译服务。
- `/translate` 命令等价 `Ctrl+Y`，只切换回复译文显示，不影响后台翻译或提示词改写；`/translate on` 和 `/translate off` 则启用或停用两侧翻译。提示行持续显示服务状态 `Translation: on/off`。键位在 `~/.claude/keybindings.json`

## 不影响上下文

译文只改渲染层：`ui.render` 的 `AssistantMessage` 站点改的是「这块怎么画」，存储和发给模型走另一条路，`session.append` 才能改落盘，本插件没用它。实测：transcript `.jsonl` 里搜不到屏幕上出现过的译文句子，原文能搜到；下一轮请求不含译文，不占 token；`$.model.complete` 是无历史的独立补全，也不进会话。出站改写发生在进会话之前，落盘的是英文，原文同样只活在渲染层，重开会话后对照就没有了。

## 实现备注

- hooks module 只能 import 相对路径和 `"claude-code"`，无外部依赖
- 微软路径的 `parseBody` 兼容宿主把 JSON 预解析成对象塞进 `text` 的情况
- 本地地址必须走 curl：`$.http.fetch` 连 `127.0.0.1` 会被 reset（SSRF 防护），`openai` 改用 `$.process.run` + curl 直连
- OpenAI 兼容输出会剥 `<think>...</think>`
- 配置由 `register(on, options)` 第二参传入，`plugin.json` 的 `userConfig` 声明

## 卸载

- marketplace 装的：`claude plugin uninstall sermo-translate@sermo`
- 从 `~/.claude/settings.json` 的 `pluginConfigs` 删掉 `sermo-translate@sermo`（如有）；`claude plugin marketplace remove sermo` 移除源
- 从 `~/.claude/keybindings.json` 删掉 `ctrl+y` 一行；删掉 `pluginConfigs` 里的 `sermo-translate@sermo`（如有）

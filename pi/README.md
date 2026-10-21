# sermo-translate (pi)

[claude/sermo-translate](../claude/sermo-translate) 的 pi 移植：回复、工具调用前的说明和展开的思考内容在后台翻成你配置的语言，快捷键切换显示，译文跟在对应的原文段落后面；你输入的提示词在发出前会被改写成英文（外文翻译、英文只修语法），发出后保留原文与英文的对照。

译文和对照只在渲染层显示，会话存储与模型上下文保存实际发送的文本。翻译失败时保留原文，并提示失败原因所在的日志。已经是目标语言的内容不重复插入译文。

## 安装

```bash
pi install npm:pi-sermo-translate
```

重启 Pi，或在已有会话中运行 `/reload`。默认使用微软翻译接口，无需 API key，目标语言为简体中文，无需额外配置，也不需要手动克隆仓库或执行 `npm install`。

也可以安装 GitHub 仓库版本：

```bash
pi install git:github.com/jhao0413/sermo
```

## 更新与卸载

```bash
# 更新
pi update npm:pi-sermo-translate

# 卸载
pi remove npm:pi-sermo-translate
```

执行后重启 Pi，或运行 `/reload`。如果通过 GitHub 安装，将命令中的 `npm:pi-sermo-translate` 换成 `git:github.com/jhao0413/sermo`。

## 配置

将配置保存到 `~/.pi/agent/sermo-translate.json`，修改后运行 `/reload`。设置了 `PI_CODING_AGENT_DIR` 时改从该目录读取。下面是使用 OpenAI API 的示例，替换 `api_key` 即可；其他 OpenAI 兼容服务需同时修改 `base_url` 和 `model`：

```json
{
  "show_by_default": true,
  "outbound": true,
  "lang": "zh-Hans",
  "provider": "openai",
  "model": "index-translate-2b",
  "base_url": "http://127.0.0.1:8021/v1",
  "api_key": "YOUR_OPENAI_API_KEY",
  "toggle_key": "ctrl+y"
}
```

仅当 `sermo-translate.json` 不存在时，兼容读取同目录的旧配置 `parrot-translate.json`；新配置格式有误时使用默认值，不回退旧文件。

配置文件不存在时，扩展默认使用微软接口。只想翻译回复、不改写提示词时，将 `outbound` 设为 `false`。下表列出代码中的默认值：

| 选项 | 默认 | 说明 |
|---|---|---|
| `show_by_default` | `true` | 译文随回复直接显示；关掉则快捷键展开 |
| `outbound` | `true` | 出站链路总开关 |
| `lang` | `zh-Hans` | 你的语言，微软语言码：`zh-Hant`、`ja`、`ko`、`fr`、`de`、`es`、`ru` 等 |
| `provider` | `microsoft` | 翻译服务，见下 |
| `model` | `haiku` | `session` / `openai` 用的模型；填别名 haiku / sonnet / deepseek-chat、完整 id 或 `provider/id` |
| `base_url` | `http://127.0.0.1:8021/v1` | `openai` 的接口地址 |
| `api_key` | 空 | `openai` 用；本地 llama.cpp 随便填，不校验 |
| `toggle_key` | `ctrl+y` | 切换显示的快捷键；留空 `""` 则只留 `/translate` 命令 |

provider 三选一：

- `microsoft`：Edge 免费接口，免 key、快，只会翻译（英文输入没有语法检查，原样放行）
- `session`：`ctx.modelRegistry.complete` 走本会话凭证跑一次独立补全，免配置、质量更好、耗 token。旧值 `model` 仍被接受
- `openai`：OpenAI 兼容端点，本地 llama.cpp 或远端服务（输出带 `<think>` 会剥掉）

## 使用

- 发消息：外文提示词自动转成英文再进会话；屏幕上用户行是「原文在上、实际发出的英文引用在下」
- 改写结果会拒绝源语言润色、未翻译的中日韩/其他非拉丁文字和元评论；混合输入也会校验，代码与引用中的外文允许保留。可能是英文且不含非拉丁正文的输入按完整词数检查改写幅度，混合语言翻译和其他拉丁语言不套英文词重合规则。含非拉丁正文的输入首轮用明确的英文翻译指令；其他输入同时说明外文翻译与英文语法修正，避免短英文片段被当成外文，失败后再重试一次；仍失败则保留该段原文并提示查看日志
- `Ctrl+Y` 或 `/translate`：切换回复和思考译文显示；再次展开会重试失败的段落。已跳过的技术内容或目标语言文本不会提示「译文就绪」
- 完成的中间文本和思考块立即开始翻译，随后落定的消息会去重；回复侧最多并发 4 个请求。Mermaid 图表继续由 Pi 渲染，图表外的译文仍能显示
- 粘贴的错误信息、堆栈、JSON、日志、diff 自动跳过不翻（两侧都适用）；俄文、阿拉伯文等 Unicode 正文正常翻译。反引号或 `~~~` 围栏（包括更长、未闭合的围栏）和缩进代码块不送翻；列表、引用中的代码同样保护，列表续段按容器内的相对缩进识别为正文

## 诊断

日志在 `/tmp/sermo-pi.log`，保留最近 60 条：加载配置、出站改写、翻译调度与结果、切换显示。排查看它。

## 开发

克隆仓库后，可以从仓库根目录单次加载本地代码：

```bash
pi --extension ./pi/sermo-translate.ts
```

需要持续加载本地代码时：

```bash
mkdir -p ~/.pi/agent/extensions
ln -s "$(pwd)/pi/sermo-translate.ts" ~/.pi/agent/extensions/sermo-translate.ts
```

修改代码后运行 `/reload`。类型检查与测试：

```bash
cd pi
npm install       # 装 devDependencies（pi 宿主类型 + tsc）
npm run check     # 类型检查
npm test          # Pi/Claude 共享行为用例 + Pi 渲染、事件与会话生命周期回归
```

扩展运行时由 pi 通过 jiti 加载，`@earendil-works/pi-coding-agent` 等宿主包由 pi 提供（peerDependencies 声明，不要打进 dependencies）。

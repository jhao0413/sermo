# Sermo

面向 Claude Code 和 Pi 的语言辅助扩展。sermo-translate 将外文提示词翻成英文，回复和思考内容按需译回你的语言。

![sermo-translate 效果](docs/screenshot.png)

## Pi 安装

```bash
pi install npm:pi-sermo-translate
```

重启 Pi，或在已有会话中运行 `/reload`。完整说明见 [Pi 安装与使用](pi/README.md)。

## Claude Code 安装

```bash
claude plugin marketplace add jhao0413/sermo
claude plugin install sermo-translate@sermo
```

需要 Claude Code v2.1.287+（mods API）。完整说明见 [Claude Code 安装与使用](claude/sermo-translate/README.md)。

## 旧版迁移

`pi-sermo-translate` 已发布到 [npm](https://www.npmjs.com/package/pi-sermo-translate)，可直接使用上方命令安装。

已有用户先运行 `pi remove npm:pi-parrot-translate`，再安装 `pi-sermo-translate`，避免重复加载扩展。Claude Code 用户安装新版前先运行 `claude plugin uninstall parrot-translate@parrot-agent-extensions` 和 `claude plugin marketplace remove parrot-agent-extensions`；将 `~/.claude/settings.json` 中 `pluginConfigs` 的旧键 `parrot-translate@parrot-agent-extensions` 改为 `sermo-translate@sermo`，保留其配置内容。

## 使用说明

- [Pi 安装与使用](pi/README.md)
- [Claude Code 安装与使用](claude/sermo-translate/README.md)

回复译文只影响显示，不写入模型上下文；会话保存实际发送的提示词。默认使用微软翻译接口，也可以配置会话模型或 OpenAI 兼容服务。

## 网站

运行 `npm run dev`，打开 http://localhost:5173 预览 Sermo 网站，无需安装依赖。静态部署说明见 [website/README.md](website/README.md)。

## 致谢

感谢 [Linux.do 社区](https://linux.do) 的支持与帮助。

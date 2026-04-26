# Claude Hub Shell Integration

让 zsh 在 Hub 终端里告诉后端两件事:

- **OSC 7 — 当前工作目录**: `cd` 后后端能跟到新路径,新建 session 时可继承
- **OSC 133 — prompt / command 边界**: 后端能识别"哪里是 prompt、哪条命令在跑、退出码多少"

## 启用方式

在 `~/.zshrc` **末尾** 加一行:

```sh
[[ -f /Users/janet/claude-hub/shell-integration/zsh.sh ]] && source /Users/janet/claude-hub/shell-integration/zsh.sh
```

加在末尾很重要——脚本会修改 `PS1`,要在你自己的 prompt 配置之后才不会被覆盖。

## 安全性

脚本顶部检查 `$TERM_PROGRAM == "claude-hub"`,**只在 Hub 的 PTY 里激活**。
你在 Terminal.app / iTerm / 其他场景打开的 zsh 完全不受影响。

## 校验

在 Hub 里启动一个 session, 跑:

```sh
echo $_HUB_INTEGRATION_LOADED   # 应输出 1
cd /tmp                         # 后端会收到 OSC 7, sidebar 路径应更新
```

在 Hub 之外(Terminal.app)启动 zsh, 同样跑:

```sh
echo $_HUB_INTEGRATION_LOADED   # 应为空
```

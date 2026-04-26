#!/usr/bin/env zsh
# Claude Hub zsh shell integration.
# 只在 Hub PTY 内激活 (server.js 设置 TERM_PROGRAM=claude-hub)。
# 提供 OSC 133 (prompt/command 标记) 和 OSC 7 (cwd 跟随)。

# 仅在 Hub PTY 内运行
[[ "$TERM_PROGRAM" == "claude-hub" ]] || return 0

# Idempotent guard
[[ -n "$_HUB_INTEGRATION_LOADED" ]] && return 0
_HUB_INTEGRATION_LOADED=1

# --- OSC 7: 通知宿主当前 cwd ---
_hub_osc7() {
  printf '\033]7;file://%s%s\007' "${HOSTNAME:-localhost}" "$PWD"
}

# 启动时发一次, 之后每次 cd 都发
autoload -Uz add-zsh-hook 2>/dev/null
if (( $+functions[add-zsh-hook] )); then
  add-zsh-hook chpwd _hub_osc7
fi
_hub_osc7

# --- OSC 133: prompt / command 边界标记 ---
# A = prompt 开始, B = prompt 结束 / command 开始位置,
# C = command 开始执行, D;<exit> = command 结束 (上一条退出码)

_hub_precmd() {
  local last_exit=$?
  # D 必须用上一条命令的 exit code, 在最前面发
  printf '\033]133;D;%s\007' "$last_exit"
  # A 标记 prompt 开始
  printf '\033]133;A\007'
}

_hub_preexec() {
  # C 标记 command 开始执行
  printf '\033]133;C\007'
}

if (( $+functions[add-zsh-hook] )); then
  add-zsh-hook precmd _hub_precmd
  add-zsh-hook preexec _hub_preexec
fi

# 在 PS1 末尾追加 B 标记 (prompt 结束 / 命令输入起点)
# 用 %{ %} 包住让 zsh 知道这是零宽序列, 不会破坏行宽计算
if [[ -z "$_HUB_PS1_PATCHED" ]]; then
  PS1="${PS1}%{$(printf '\033]133;B\007')%}"
  _HUB_PS1_PATCHED=1
fi

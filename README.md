# claude-plugins

Claude Code plugins.

## statusline

A gradient status line:

```
account │ model effort │ 󰓅 tok/s │ 󰧑 ctx%/limit │ 󰔟 cache TTL · 󰓾 hit% │ 󰇁 cost · 󰚩 subagents │ 5h% / reset · 7d% / reset
```

- **account**: the account or organization the session's token really belongs to (asked of the server, not read from the login file)
- **model effort**: model name, colored by family, and reasoning effort
- **tok/s**: output speed of the last main-thread response
- **ctx**: context used against the auto-compact point, not the whole window; a toast warns at 90%
- **cache**: time left on the prompt cache, reddening over its last five minutes, and the hit ratio
- **cost**: session cost in USD, with the subagents' share
- **plan usage**: 5-hour and 7-day limits with time to reset, kept across sessions

### Install

At the prompt of a terminal session:

```
/plugin install statusline --marketplace savindaa/claude-plugins
```

Answer `y` to add the marketplace, then pick a scope (user scope recommended). From a shell:

```
claude plugin install statusline --marketplace savindaa/claude-plugins
```

Then point the status line at the script, which the plugin copies to a stable path on every session start, in `~/.claude/settings.json`:

```json
"statusLine": {
  "type": "command",
  "command": "bash ~/.claude/cache/statusline/statusline.sh",
  "refreshInterval": 60
}
```

Start a new session once so the script is copied. With `CLAUDE_CONFIG_DIR` set, use that folder instead of `~/.claude`.

### Requirements

- `bash`, `jq`, `find`
- a terminal with 24-bit color and a [Nerd Font](https://www.nerdfonts.com/) for the icons

### Optional: account labels

Organizations without a profile name show as `org <first 8 chars>`. Map them to your own labels in `~/.claude/statusline-accounts.json`:

```json
{ "<org-uuid>": "work" }
```

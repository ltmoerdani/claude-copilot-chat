# Claude for Copilot Chat

Use your **Claude Pro/Max subscription** in GitHub Copilot Chat. Login-based, no API key needed.

---

## Quick Start

```bash
# 1. Install Claude Code CLI
curl -fsSL https://claude.ai/install.sh | bash

# 2. Generate token (opens browser for OAuth login)
claude setup-token
# Copy the output token (starts with sk-ant-oat01-...)

# 3. Install extension (from source)
cd /Users/ltmoerdani/Startup/claude-copilot-chat
npm install && npm run compile
# Press F5 in VS Code to launch Extension Development Host

# 4. In Extension Development Host:
#    - Open Copilot Chat (Cmd+Shift+I)
#    - Model picker → "Add Models..." → Claude (Subscription)
#    - Paste token
#    - Select a model and chat!
```

---

## Available Models

| Model | Context | Max Output | Plan |
|---|---:|---:|---|
| Claude Opus 4.7 | 200K | 32K | Max |
| Claude Opus 4.6 | 200K | 32K | Max |
| Claude Sonnet 4.6 | 200K | 64K | Pro |
| Claude Sonnet 4.5 | 200K | 64K | Pro |
| Claude Haiku 4.5 | 200K | 64K | Pro |

---

## Features

- Subscription-based (uses your Claude Pro/Max plan)
- Full Agent Mode support (tool calling)
- Vision support (image input)
- Streaming responses
- Auto-retry on errors
- Secure token storage (VS Code SecretStorage)

---

## How It Works

1. User runs `claude setup-token` → gets 1-year OAuth token
2. User pastes token into extension
3. Extension sends `Authorization: Bearer <token>` to `api.anthropic.com/v1/messages`
4. SSE stream parsed and reported to Copilot Chat

---

## Documentation

- [Auth Research](docs/00-research-claude-code-auth.md)
- [VS Code API](docs/01-vscode-language-model-provider-api.md)
- [Architecture](docs/02-architecture-decisions.md)
- [Setup Guide](docs/03-setup-and-installation.md)
- [Development Guide](docs/04-development-guide.md)

---

## License

MIT

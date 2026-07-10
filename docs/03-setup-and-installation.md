# Setup & Installation Guide

---

## Prerequisites

1. **Claude Pro or Max subscription** (active at claude.com/pricing)
2. **Claude Code CLI** (for `claude setup-token`):
   ```bash
   curl -fsSL https://claude.ai/install.sh | bash
   ```
3. **GitHub Copilot Chat extension** (for model picker)
4. **VS Code 1.125+**

---

## Step-by-Step

### Step 1: Generate Token

```bash
claude setup-token
```
- Opens browser for OAuth login
- Prints 1-year token starting with `sk-ant-oat01-...`
- **Copy the full token** (not saved anywhere)

### Step 2: Install Extension

**From source:**
```bash
cd /Users/ltmoerdani/Startup/claude-copilot-chat
npm install
npm run compile
# Open in VS Code, press F5 for Extension Development Host
```

### Step 3: Add Claude Models

1. Open **Copilot Chat** (Cmd+Shift+I)
2. Click **model picker** (current model name)
3. Click **"Add Models..."**
4. Select **Claude (Subscription)**
5. Paste token when prompted
6. Select models (start with Claude Haiku 4.5)
7. Click **OK**

### Step 4: Chat

Select Claude model from dropdown and start chatting.

---

## Token Renewal (after 1 year)

1. Run `claude setup-token` again
2. Command Palette → "Claude: Set Login Token"
3. Paste new token

---

## Troubleshooting

- **"Invalid bearer token"** → Token expired, re-run `claude setup-token`
- **"429 Rate Limited"** → Subscription quota reached, wait for reset
- **Provider not in picker** → Check Output panel for activation errors
- **Extension not loading** → Ensure VS Code 1.125+, press F5 from project folder

# Development Guide

---

## Project Structure

```
src/
├── extension.ts      # activate() - register provider + commands
├── claudeProvider.ts # LanguageModelChatProvider implementation
├── authProvider.ts   # Token resolution + login flow
├── streaming.ts      # Anthropic SSE stream handler
├── models.ts         # Hardcoded model list
├── tokenStore.ts     # SecretStorage wrapper
└── errors.ts         # Error classification + retry
```

---

## Key Architecture

### Auth Flow
```
User: claude setup-token → copy token
       ↓
Extension: token in SecretStorage
       ↓
Request: Authorization: Bearer <token>
       ↓
Anthropic: api.anthropic.com/v1/messages
       ↓
Response: SSE stream → progress.report()
```

### Provider Registration
```typescript
// extension.ts
vscode.lm.registerLanguageModelChatProvider(VENDOR_ID, provider);
// VENDOR_ID = "anthropic" (from models.ts)
```

### Token in streaming.ts
```typescript
headers: {
  "Authorization": `Bearer ${oauthToken}`,
  "anthropic-version": "2023-06-01",
  "Accept": "text/event-stream",
}
```

---

## Build Commands

```bash
npm install          # Install deps
npm run compile      # One-time build
npm run watch        # Watch mode
npm run package      # Create .vsix
```

---

## Testing

1. Press F5 in VS Code (Extension Development Host)
2. Open Copilot Chat
3. Model picker → "Add Models..." → Claude (Subscription)
4. Paste token
5. Select model, test chat

---

## Adding New Models

Edit `src/models.ts` → `CLAUDE_MODELS` array:
```typescript
{
  id: "claude-opus-5-0",
  name: "Claude Opus 5.0",
  family: "claude-5",
  version: "5.0",
  maxInputTokens: 200_000,
  maxOutputTokens: 32_768,
  supportsVision: true,
  supportsToolCalling: true,
  supportsThinking: true,
  description: "Next-gen frontier model.",
},
```

---

## Key Learnings

1. `claude setup-token` OAuth token works with `Authorization: Bearer` header
2. `x-api-key` does NOT work with OAuth tokens (only Console API keys)
3. `LanguageModelChatProvider` is stable API in VS Code 1.125+
4. Token lifetime: 1 year, renewal via re-run `claude setup-token`

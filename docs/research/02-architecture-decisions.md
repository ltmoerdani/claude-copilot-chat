# Architecture & Design Decisions

**Date:** 2026-07-10

---

## Decision 1: Subscription-based, NOT API key

**Context:** User explicitly wants login-based subscription, not BYOK (Bring Your Own Key).

**Decision:** Use `claude setup-token` OAuth token with `Authorization: Bearer`.

**Verified:** Token from `claude setup-token` works directly with `api.anthropic.com/v1/messages` when sent as `Authorization: Bearer`.

**Rationale:**
- Uses existing Claude Pro/Max subscription (no extra cost)
- Same auth pattern as Claude Code CLI
- Token lifetime: 1 year (low maintenance)

---

## Decision 2: Single vendor `anthropic`

**Context:** Need unique vendor string for `registerLanguageModelChatProvider`.

**Decision:** Use `"anthropic"` as vendor ID.

**Rationale:**
- Matches Anthropic's branding
- Distinct from OpenCode vendors
- Models show as: "Claude Sonnet 4.6 (anthropic)"

---

## Decision 3: `languageModelChatProviders.configuration` for token entry

**Decision:** Use `configuration` schema with `secret: true`.

**Rationale:**
- VS Code handles SecretStorage automatically
- User enters token via native "Add Models..." flow
- Same pattern as opencode-copilot-chat

---

## Decision 4: Hardcode model list

**Decision:** Hardcode models. No `GET /v1/models` for subscription tokens.

**Models:**
| Model | Context | Max Output |
|---|---:|---:|
| `claude-opus-4-7` | 200K | 32K |
| `claude-opus-4-6` | 200K | 32K |
| `claude-sonnet-4-6` | 200K | 64K |
| `claude-sonnet-4-5` | 200K | 64K |
| `claude-haiku-4-5` | 200K | 64K |

---

## Decision 5: Reuse streaming handler from opencode-copilot-chat

**Decision:** Copy and adapt `streamAnthropicMessages()` from sibling project.

**Adaptations:**
- Auth: `x-api-key` → `Authorization: Bearer`
- Remove OpenCode gateway headers

---

## Decision 6: Stable API only (no proposed types)

**Decision:** Use `@types/vscode` stable types only.

**Rationale:**
- Works on VS Code Stable (not just Insiders)
- `LanguageModelChatProvider` is in stable API since VS Code 1.125

---

## File Structure

```
claude-copilot-chat/
├── package.json
├── tsconfig.json
├── README.md
├── docs/
│   ├── 00-research-claude-code-auth.md
│   ├── 01-vscode-language-model-provider-api.md
│   ├── 02-architecture-decisions.md       (this file)
│   ├── 03-setup-and-installation.md
│   └── 04-development-guide.md
└── src/
    ├── extension.ts
    ├── claudeProvider.ts
    ├── authProvider.ts
    ├── streaming.ts
    ├── models.ts
    ├── tokenStore.ts
    └── errors.ts
```

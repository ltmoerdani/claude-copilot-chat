# Research: Claude Code Authentication & Subscription Mechanics

**Date:** 2026-07-10
**Status:** Complete & Verified (empirically tested)

---

## Key Discovery (Verified 2026-07-10)

The `claude setup-token` OAuth token DOES work directly with the Anthropic Messages API.

### Test (verified via curl)

```bash
curl -s https://api.anthropic.com/v1/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-ant-oat01-3Qtm679D..." \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-haiku-4-5","max_tokens":50,"messages":[{"role":"user","content":"Say hello"}]}'
```

**Result:** HTTP 200 with valid response.

### Critical finding: Header MUST be `Authorization: Bearer`

- `Authorization: Bearer <token>` = HTTP 200 (works)
- `x-api-key: <token>` = HTTP 401 "invalid x-api-key" (fails)

---

## Token Format

`claude setup-token` outputs: `sk-ant-oat01-<base64>`

This is an OAuth access token (NOT an API key), but accepted by Messages API when sent as `Authorization: Bearer`.

---

## Claude Code CLI Auth Precedence

| Priority | Method | Header |
|---:|---|---|
| 1 | Cloud providers | varies |
| 2 | `ANTHROPIC_AUTH_TOKEN` | `Authorization: Bearer` |
| 3 | `ANTHROPIC_API_KEY` | `x-api-key` |
| 4 | `apiKeyHelper` | Custom |
| 5 | `CLAUDE_CODE_OAUTH_TOKEN` | OAuth bearer |
| 6 | `/login` OAuth | Browser login |

Our extension uses layer 5.

---

## Token Lifecycle

- **Generation:** `claude setup-token` (browser OAuth flow)
- **Lifetime:** 1 year
- **Plan required:** Pro, Max, Team, or Enterprise
- **Auth method:** `Authorization: Bearer <token>`
- **Endpoint:** `https://api.anthropic.com/v1/messages`
- **Renewal:** Re-run `claude setup-token`

---

## Available Models

No `GET /v1/models` for subscription tokens. Hardcoded:

| Model | Context | Max Output | Plan |
|---|---:|---:|---|
| `claude-opus-4-7` | 200K | 32K | Max |
| `claude-opus-4-6` | 200K | 32K | Max |
| `claude-sonnet-4-6` | 200K | 64K | Pro |
| `claude-sonnet-4-5` | 200K | 64K | Pro |
| `claude-haiku-4-5` | 200K | 64K | Pro |

---

## Subscription Rate Limits

| Plan | 5-hour | Weekly | Opus |
|---|---|---|---|
| Pro ($20/mo) | Lower | Lower | Restricted |
| Max ($100-200/mo) | Higher | Higher | Full |
| Team | Configurable | Configurable | Depends |
| Enterprise | Custom | Custom | Depends |

---

## References

- [Claude Code Authentication](https://code.claude.com/docs/en/authentication)
- [Anthropic Messages API](https://platform.claude.com/docs/en/api/messages)
- Sibling: `/Users/ltmoerdani/Startup/opencode-copilot-chat`

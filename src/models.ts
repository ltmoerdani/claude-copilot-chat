/**
 * Model metadata for Claude subscription models.
 *
 * Hardcoded because subscription OAuth tokens do not have access to
 * GET /v1/models. Update this list when Anthropic releases new models.
 *
 * @see docs/02-architecture-decisions.md Decision 4
 */

export interface ClaudeModelInfo {
  /** Anthropic model ID sent to the API (e.g. "claude-sonnet-4-6"). */
  readonly id: string;
  /** Display name shown in the Copilot Chat model picker. */
  readonly name: string;
  /** Model family for grouping (e.g. "claude-4"). */
  readonly family: string;
  /** Version label (e.g. "4.6"). */
  readonly version: string;
  /** Maximum input tokens (context window). */
  readonly maxInputTokens: number;
  /** Maximum output tokens per response. */
  readonly maxOutputTokens: number;
  /** Whether the model supports image/vision input. */
  readonly supportsVision: boolean;
  /** Whether the model supports tool calling (Agent Mode). */
  readonly supportsToolCalling: boolean;
  /** Whether the model supports extended thinking / reasoning. */
  readonly supportsThinking: boolean;
  /** Human-readable description for the picker tooltip. */
  readonly description: string;
  /**
   * max_tokens value that Claude Code CLI sends for this model.
   * The Anthropic API enforces specific output limits per model — using a value
   * that doesn't match what Claude Code sends can trigger 429 rate_limit_error.
   * Values verified via ANTHROPIC_LOG=debug claude --print --model X.
   */
  readonly claudeCodeMaxTokens: number;
  /**
   * Thinking configuration that Claude Code CLI sends for this model.
   * - "adaptive": { type: "adaptive", display: "omitted" } — for Opus 4.7+, Sonnet 5+
   * - "enabled":  { type: "enabled", budget_tokens: max-1, display: "omitted" } — for Sonnet 4.x, Haiku 4.5
   * - "none":     no thinking field — for models that don't support it
   * Without the correct thinking type, the API returns 429 rate_limit_error.
   */
  readonly claudeCodeThinking: "adaptive" | "enabled" | "none";
}

/**
 * Current Claude model lineup (as of 2026-07).
 * Source: https://platform.claude.com/docs/en/about-claude/models/overview
 *
 * IMPORTANT: maxOutputTokens must match the API limit EXACTLY.
 * The Anthropic API enforces hard caps per model — exceeding them returns
 * HTTP 400 "max_tokens: X > Y, which is the maximum allowed".
 *
 * Opus 4.8/4.7/4.6:  128k output (API limit 128_000)
 * Sonnet 5/4.6:      128k output (API limit 128_000)
 * Sonnet 4.5:         64k output (API limit  64_000)
 * Haiku 4.5:          64k output (API limit  64_000)
 *
 * We use conservative values slightly below the hard cap to avoid edge cases.
 */
export const CLAUDE_MODELS: readonly ClaudeModelInfo[] = [
  {
    id: "claude-opus-4-8",
    name: "Claude Opus 4.8",
    family: "claude-4",
    version: "4.8",
    maxInputTokens: 1_000_000,
    maxOutputTokens: 128_000,
    supportsVision: true,
    supportsToolCalling: true,
    supportsThinking: false,
    description: "Latest frontier model for complex agentic coding and enterprise work. Requires Max plan.",
    claudeCodeMaxTokens: 64_000,
    claudeCodeThinking: "adaptive",
  },
  {
    id: "claude-opus-4-7",
    name: "Claude Opus 4.7",
    family: "claude-4",
    version: "4.7",
    maxInputTokens: 1_000_000,
    maxOutputTokens: 128_000,
    supportsVision: true,
    supportsToolCalling: true,
    supportsThinking: false,
    description: "Frontier intelligence for long-running agents and coding. Requires Max plan.",
    claudeCodeMaxTokens: 64_000,
    claudeCodeThinking: "adaptive",
  },
  {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    family: "claude-4",
    version: "4.6",
    maxInputTokens: 200_000,
    maxOutputTokens: 128_000,
    supportsVision: true,
    supportsToolCalling: true,
    supportsThinking: true,
    description: "Frontier intelligence with extended thinking. Requires Max plan.",
    claudeCodeMaxTokens: 64_000,
    claudeCodeThinking: "enabled",
  },
  {
    id: "claude-sonnet-5",
    name: "Claude Sonnet 5",
    family: "claude-5",
    version: "5",
    maxInputTokens: 1_000_000,
    maxOutputTokens: 128_000,
    supportsVision: true,
    supportsToolCalling: true,
    supportsThinking: false,
    description: "Best combination of speed and intelligence. Available on Pro.",
    claudeCodeMaxTokens: 64_000,
    claudeCodeThinking: "adaptive",
  },
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    family: "claude-4",
    version: "4.6",
    maxInputTokens: 200_000,
    maxOutputTokens: 128_000,
    supportsVision: true,
    supportsToolCalling: true,
    supportsThinking: true,
    description: "High-performance model with extended thinking. Available on Pro.",
    claudeCodeMaxTokens: 32_000,
    claudeCodeThinking: "enabled",
  },
  {
    id: "claude-sonnet-4-5",
    name: "Claude Sonnet 4.5",
    family: "claude-4",
    version: "4.5",
    maxInputTokens: 200_000,
    maxOutputTokens: 64_000,
    supportsVision: true,
    supportsToolCalling: true,
    supportsThinking: true,
    description: "Fast and intelligent model with extended thinking. Available on Pro.",
    claudeCodeMaxTokens: 32_000,
    claudeCodeThinking: "enabled",
  },
  {
    id: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    family: "claude-4",
    version: "4.5",
    maxInputTokens: 200_000,
    maxOutputTokens: 64_000,
    supportsVision: true,
    supportsToolCalling: true,
    description: "Fastest model with near-frontier intelligence. Available on Pro.",
    claudeCodeMaxTokens: 32_000,
    // Haiku 4.5 uses enabled thinking with budget (verified via Claude Code CLI).
    supportsThinking: true,
    claudeCodeThinking: "enabled",
  },
];

/**
 * Vendor ID — must match package.json contributes.languageModelChatProviders[].vendor.
 *
 * IMPORTANT: Do NOT use "anthropic" — that vendor is used by VS Code's built-in
 * Copilot Chat for its own Claude model routing. Using it causes conflicts where
 * Copilot intercepts requests meant for our provider.
 */
export const VENDOR_ID = "claude-sub" as const;

/** Anthropic API endpoint for the Messages API. */
export const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages" as const;

/** Anthropic API version header value. */
export const ANTHROPIC_VERSION = "2023-06-01" as const;

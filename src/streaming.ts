/**
 * Anthropic Messages API streaming handler.
 *
 * Adapted from opencode-copilot-chat/src/streaming.ts.
 * Parses Anthropic SSE events (content_block_delta, message_delta, etc.)
 * and reports them to VS Code's Progress<LanguageModelResponsePart>.
 *
 * @see docs/02-architecture-decisions.md Decision 5
 */

import * as vscode from "vscode";
import * as crypto from "crypto";
import {
  ANTHROPIC_API_URL,
  ANTHROPIC_VERSION,
} from "./models";
import {
  backoffDelay,
  classifyHttpError,
  isRetryableError,
  sleep,
} from "./errors";

/**
 * Options passed to the streaming request.
 */
export interface StreamOptions {
  /** OAuth token from `claude setup-token` (Authorization: Bearer header). */
  oauthToken: string;
  /** Anthropic model ID (e.g. "claude-sonnet-4-6"). */
  modelId: string;
  /** Request body (messages, max_tokens, tools, etc.). Already Anthropic-formatted. */
  body: unknown;
  /** VS Code progress reporter for streaming response parts. */
  progress: vscode.Progress<unknown>;
  /** Cancellation token from VS Code. */
  token: vscode.CancellationToken;
  /** Request timeout in ms. */
  requestTimeoutMs: number;
  /** Stream idle timeout in ms — abort if no bytes for this long. */
  streamIdleTimeoutMs: number;
  /** Output channel for debug logging. */
  output?: vscode.OutputChannel;
}

const MAX_RETRIES = 3;

/**
 * Stream a chat completion from the Anthropic Messages API.
 *
 * Sends the request with `Authorization: Bearer <oauthToken>`, parses the SSE
 * stream, and reports text/tool-call parts to the progress reporter.
 *
 * Retries on transient errors (429, 5xx, network) with exponential backoff.
 */
export async function streamAnthropicMessages(
  options: StreamOptions,
): Promise<void> {
  const { token } = options;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (token.isCancellationRequested) {
      return;
    }

    try {
      await doStreamRequest(options);
      return; // success
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry cancellation or non-retryable errors
      if (token.isCancellationRequested) return;
      if (!isRetryableError(error)) throw lastError;

      if (attempt < MAX_RETRIES) {
        const delay = backoffDelay(attempt);
        options.output?.appendLine(
          `[retry] attempt=${attempt + 1}/${MAX_RETRIES} delay=${delay}ms error=${lastError.message}`,
        );
        await sleep(delay);
      }
    }
  }

  // All retries exhausted
  throw lastError ?? new Error("Request failed after retries");
}

/**
 * Perform a single streaming request to the Anthropic Messages API.
 */
async function doStreamRequest(options: StreamOptions): Promise<void> {
  const { oauthToken, modelId, body, progress, token, requestTimeoutMs, streamIdleTimeoutMs } =
    options;

  // Generate session/request IDs like Claude Code CLI does
  const sessionId = crypto.randomUUID();
  const requestId = crypto.randomUUID();

  const headers: Record<string, string> = {
    "accept": "application/json",
    "Content-Type": "application/json",
    "Authorization": `Bearer ${oauthToken}`,
    "anthropic-version": ANTHROPIC_VERSION,
    // Full anthropic-beta string matching Claude Code CLI exactly.
    // The claude-code-20250219 flag is critical — it routes to subscription quota.
    "anthropic-beta": "oauth-2025-04-20,interleaved-thinking-2025-05-14,thinking-token-count-2026-05-13,context-management-2025-06-27,prompt-caching-scope-2026-01-05,claude-code-20250219,advisor-tool-2026-03-01,advanced-tool-use-2025-11-20,extended-cache-ttl-2025-04-11,cache-diagnosis-2026-04-07",
    "anthropic-dangerous-direct-browser-access": "true",
    "User-Agent": "claude-cli/2.1.198 (external, sdk-cli)",
    "x-app": "cli",
    "x-claude-code-session-id": sessionId,
    "x-client-request-id": requestId,
    // x-stainless-* headers match the Anthropic SDK fingerprint
    "x-stainless-arch": process.arch,
    "x-stainless-lang": "js",
    "x-stainless-os": "MacOS",
    "x-stainless-package-version": "0.94.0",
    "x-stainless-retry-count": "0",
    "x-stainless-runtime": "node",
    "x-stainless-runtime-version": process.version,
    "x-stainless-timeout": String(Math.floor(requestTimeoutMs / 1000)),
  };

  // Add metadata to match Claude Code CLI body shape — this helps Anthropic
  // identify the request as a Claude Code session for subscription billing.
  const bodyObj = body as Record<string, unknown>;
  if (!bodyObj.metadata) {
    bodyObj.metadata = { user_id: sessionId };
  }

  const requestBody = JSON.stringify({ ...bodyObj, stream: true });
  const abortController = new AbortController();

  // Wire up VS Code cancellation token to AbortController
  const cancelSub = token.onCancellationRequested(() => {
    abortController.abort();
  });

  // Set up request timeout
  const timeoutHandle = setTimeout(() => {
    abortController.abort();
  }, requestTimeoutMs);

  // Set up stream idle timeout
  let idleTimeoutHandle: NodeJS.Timeout | undefined;
  const resetIdleTimeout = () => {
    if (idleTimeoutHandle) clearTimeout(idleTimeoutHandle);
    idleTimeoutHandle = setTimeout(() => {
      options.output?.appendLine(
        `[stream-idle-timeout] No bytes for ${streamIdleTimeoutMs}ms, aborting model=${modelId}`,
      );
      abortController.abort();
    }, streamIdleTimeoutMs);
  };

  try {
    resetIdleTimeout();

    // Use ?beta=true endpoint — same as Claude Code CLI.
    // Without this, OAuth subscription tokens get billed as "extra usage".
    const response = await fetch(`${ANTHROPIC_API_URL}?beta=true`, {
      method: "POST",
      headers,
      body: requestBody,
      signal: abortController.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      // Log full error details for debugging
      const retryAfter = response.headers.get("retry-after");
      const rateLimitRemaining = response.headers.get("anthropic-ratelimit-requests-remaining");
      const rateLimitReset = response.headers.get("anthropic-ratelimit-requests-reset");
      options.output?.appendLine(
        `[http-error] status=${response.status} model=${modelId}\n` +
        `  body: ${errorBody.slice(0, 1000)}\n` +
        `  retry-after: ${retryAfter ?? "N/A"}\n` +
        `  ratelimit-remaining: ${rateLimitRemaining ?? "N/A"}\n` +
        `  ratelimit-reset: ${rateLimitReset ?? "N/A"}`,
      );
      const error = classifyHttpError(response.status, errorBody);
      throw error ?? new Error(`HTTP ${response.status}: ${errorBody.slice(0, 200)}`);
    }

    if (!response.body) {
      throw new Error("No response body from Anthropic API");
    }

    // Parse SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentToolCallId: string | undefined;
    let currentToolCallName: string | undefined;
    let toolCallInputBuffer = "";

    while (true) {
      if (token.isCancellationRequested) {
        reader.cancel();
        return;
      }

      const { done, value } = await reader.read();
      if (done) break;

      resetIdleTimeout();
      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE events (separated by \n\n)
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? ""; // keep incomplete event in buffer

      for (const eventText of events) {
        const event = parseSSEEvent(eventText);
        if (!event) continue;

        handleSSEEvent(event, progress, {
          onToolUseStart: (id, name) => {
            currentToolCallId = id;
            currentToolCallName = name;
            toolCallInputBuffer = "";
          },
          onToolUseInput: (partialJson) => {
            toolCallInputBuffer += partialJson;
          },
          onToolUseEnd: () => {
            if (currentToolCallId && currentToolCallName) {
              let parsedInput: object = {};
              try {
                parsedInput = toolCallInputBuffer ? JSON.parse(toolCallInputBuffer) : {};
              } catch {
                options.output?.appendLine(
                  `[warn] Failed to parse tool input JSON: ${toolCallInputBuffer.slice(0, 200)}`,
                );
              }
              const toolCallPart = new vscode.LanguageModelToolCallPart(
                currentToolCallId,
                currentToolCallName,
                parsedInput,
              );
              progress.report(toolCallPart);
            }
            currentToolCallId = undefined;
            currentToolCallName = undefined;
            toolCallInputBuffer = "";
          },
        });
      }
    }
  } finally {
    clearTimeout(timeoutHandle);
    if (idleTimeoutHandle) clearTimeout(idleTimeoutHandle);
    cancelSub.dispose();
  }
}

// ─── SSE Parsing ──────────────────────────────────────────────────────────

interface SSEEvent {
  event?: string;
  data?: string;
}

interface SSEHandlers {
  onToolUseStart: (id: string, name: string) => void;
  onToolUseInput: (partialJson: string) => void;
  onToolUseEnd: () => void;
}

/**
 * Parse a single SSE event block (lines separated by \n).
 */
function parseSSEEvent(text: string): SSEEvent | null {
  if (!text.trim()) return null;

  let event: string | undefined;
  let data: string | undefined;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(":")) continue;

    if (trimmed.startsWith("event:")) {
      event = trimmed.slice(6).trim();
    } else if (trimmed.startsWith("data:")) {
      const dataPart = trimmed.slice(5).trim();
      data = data ? data + "\n" + dataPart : dataPart;
    }
  }

  return { event, data };
}

/**
 * Handle a parsed SSE event and report to VS Code progress.
 */
function handleSSEEvent(
  sse: SSEEvent,
  progress: vscode.Progress<unknown>,
  handlers: SSEHandlers,
): void {
  if (!sse.data) return;

  let payload: unknown;
  try {
    payload = JSON.parse(sse.data);
  } catch {
    return; // Not valid JSON, skip
  }

  if (!payload || typeof payload !== "object") return;

  const eventType = (payload as { type?: string }).type;

  switch (eventType) {
    case "message_start":
      // Initial event with model info
      break;

    case "content_block_start": {
      const block = (payload as { content_block?: { type?: string; id?: string; name?: string } })
        .content_block;
      if (block?.type === "tool_use" && block.id && block.name) {
        handlers.onToolUseStart(block.id, block.name);
      }
      break;
    }

    case "content_block_delta": {
      const delta = (payload as { delta?: { type?: string; text?: string; partial_json?: string } })
        .delta;

      if (!delta) break;

      if (delta.type === "text_delta" && delta.text) {
        // Report text chunk
        progress.report(new vscode.LanguageModelTextPart(delta.text));
      } else if (delta.type === "input_json_delta" && delta.partial_json) {
        // Accumulate tool input
        handlers.onToolUseInput(delta.partial_json);
      } else if (delta.type === "thinking_delta") {
        // Extended thinking — we don't surface this separately in Phase 1,
        // but we don't error on it either.
      }
      break;
    }

    case "content_block_stop": {
      // If we were accumulating a tool call, flush it
      handlers.onToolUseEnd();
      break;
    }

    case "message_delta": {
      // Contains stop_reason, usage updates
      break;
    }

    case "message_stop":
      // Stream complete
      break;

    case "ping":
      // Keepalive
      break;

    case "error": {
      const errMsg = (payload as { error?: { message?: string } }).error;
      throw new Error(
        `Anthropic stream error: ${errMsg?.message ?? "Unknown error"}`,
      );
    }

    default:
      // Unknown event type — ignore silently (forward compat)
      break;
  }
}

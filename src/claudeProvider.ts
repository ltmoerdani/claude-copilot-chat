/**
 * LanguageModelChatProvider implementation for Claude subscription models.
 *
 * This is the bridge between GitHub Copilot Chat and the Anthropic Messages API.
 * Copilot Chat calls these methods; we translate to Anthropic format and stream back.
 *
 * @see docs/01-vscode-language-model-provider-api.md
 * @see docs/02-architecture-decisions.md Decision 9
 */

import * as vscode from "vscode";
import {
  CLAUDE_MODELS,
  VENDOR_ID,
  type ClaudeModelInfo,
} from "./models";
import { AuthProvider } from "./authProvider";
import { streamAnthropicMessages } from "./streaming";
import { AuthError } from "./errors";

/**
 * Provider that exposes Claude subscription models to Copilot Chat.
 */
export class ClaudeLanguageModelChatProvider
  implements vscode.LanguageModelChatProvider<vscode.LanguageModelChatInformation>
{
  private readonly _changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation = this._changeEmitter.event;

  constructor(
    private readonly auth: AuthProvider,
    private readonly output?: vscode.OutputChannel,
  ) {}

  /** Fire to notify VS Code that the model list may have changed (e.g. after token set/cleared). */
  notifyChange(): void {
    this._changeEmitter.fire();
  }

  dispose(): void {
    this._changeEmitter.dispose();
  }

  /**
   * Return the list of Claude models for the picker.
   *
   * If the user hasn't set a token yet, we still return the list (greyed out
   * in UI). VS Code will prompt them to configure when they try to use a model.
   */
  async provideLanguageModelChatInformation(
    options: vscode.PrepareLanguageModelChatModelOptions,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatInformation[]> {
    // Extract oauthToken if VS Code passed it via the "Add Models..." flow.
    const configToken = (options as unknown as { configuration?: Record<string, unknown> })
      .configuration?.["oauthToken"];
    if (typeof configToken === "string" && configToken.trim()) {
      this.output?.appendLine("[provideInfo] oauthToken received via configuration — persisting to SecretStorage");
      await this.auth.persistToken(configToken.trim());
    }

    this.output?.appendLine(
      `[provideInfo] called with silent=${options.silent}, returning ${CLAUDE_MODELS.length} models`,
    );
    return CLAUDE_MODELS.map((m) => toChatInfo(m));
  }

  /**
   * Handle a chat request: translate VS Code messages → Anthropic format,
   * stream the response back via progress.
   */
  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<unknown>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    this.output?.appendLine(
      `[request-start] model=${model.id} family=${model.family} — handling via Claude Subscription provider`,
    );

    const modelInfo = CLAUDE_MODELS.find((m) => m.id === model.id);
    if (!modelInfo) {
      throw new Error(`Unknown model: ${model.id}`);
    }

    // Resolve OAuth token
    const oauthToken = await this.auth.resolveToken();

    if (!oauthToken) {
      const msg = "No Claude subscription token set. Open Command Palette (Cmd+Shift+P) → 'Claude: Set Login Token' and paste your token from `claude setup-token`.";
      this.output?.appendLine(`[request-error] ${msg}`);
      throw new AuthError(msg);
    }
    this.output?.appendLine(`[request-auth] token resolved (${oauthToken.length} chars)`);

    // Translate messages to Anthropic format
    const { body, systemPrompt } = translateMessages(messages, modelInfo, options);

    // Merge tools from Copilot Chat options (Agent Mode).
    // Cap at 20 tools to avoid massive input token costs that drain "extra usage".
    // Copilot sends 99 tools by default — most are rarely used.
    const allTools = translateTools(options.tools);
    const tools = allTools.slice(0, 20);

    // Determine max_tokens — cap at 32000 to match Claude Code CLI behavior.
    const maxTokens = Math.min(modelInfo.maxOutputTokens, 32_000);

    // Build system prompt with cache_control for prompt caching.
    // This makes the system prompt + tools cached (90% cheaper on subsequent requests).
    const systemBlocks: unknown[] = [];
    if (systemPrompt.system) {
      systemBlocks.push({
        type: "text",
        text: systemPrompt.system,
        cache_control: { type: "ephemeral" },
      });
    }

    const requestBody: Record<string, unknown> = {
      model: modelInfo.id,
      max_tokens: maxTokens,
      messages: body,
    };

    if (systemBlocks.length > 0) {
      requestBody.system = systemBlocks;
    }

    if (tools.length > 0) {
      // Also cache the last tool definition to cache the entire tools array
      const cachedTools = tools.map((t, i) =>
        i === tools.length - 1
          ? { ...t, cache_control: { type: "ephemeral" } }
          : t,
      );
      requestBody.tools = cachedTools;
    }

    // Read timeouts from settings
    const config2 = vscode.workspace.getConfiguration("claude");
    const requestTimeoutMs = config2.get<number>("requestTimeoutMs", 600_000);
    const streamIdleTimeoutMs = config2.get<number>("streamIdleTimeoutMs", 180_000);

    this.output?.appendLine(
      `[request] model=${modelInfo.id} messages=${body.length} tools=${tools.length}/${allTools.length} max_tokens=${maxTokens}`,
    );

    await streamAnthropicMessages({
      oauthToken,
      modelId: modelInfo.id,
      body: requestBody,
      progress,
      token,
      requestTimeoutMs,
      streamIdleTimeoutMs,
      output: this.output,
    });
  }

  /**
   * Estimate token count for the given text.
   *
   * Approximation: ~4 chars per token. Anthropic has a token-counting API
   * (`POST /v1/messages/count_tokens`) but it requires the same auth. For
   * Phase 1 we use a rough estimate.
   */
  async provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken,
  ): Promise<number> {
    if (typeof text === "string") {
      return Math.ceil(text.length / 4);
    }
    // For messages, sum up content parts
    const contentStr = JSON.stringify(text.content);
    return Math.ceil(contentStr.length / 4);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Convert our model metadata to VS Code's LanguageModelChatInformation.
 */
function toChatInfo(m: ClaudeModelInfo): vscode.LanguageModelChatInformation {
  return {
    id: m.id,
    vendor: VENDOR_ID,
    name: m.name,
    family: m.family,
    version: m.version,
    maxInputTokens: m.maxInputTokens,
    maxOutputTokens: m.maxOutputTokens,
    capabilities: {
      imageInput: m.supportsVision,
      toolCalling: m.supportsToolCalling ? 2 : false,
    },
    detail: m.description,
    tooltip: `${m.name}\n\n${m.description}\n\nContext: ${(m.maxInputTokens / 1000).toFixed(0)}K tokens\nMax output: ${(m.maxOutputTokens / 1000).toFixed(0)}K tokens`,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    isUserSelectable: true as any,
  } as vscode.LanguageModelChatInformation;
}

/**
 * Translate VS Code chat messages into Anthropic Messages API format.
 *
 * VS Code sends `LanguageModelChatRequestMessage[]` with `role` and `content[]`.
 * Anthropic expects `{ role: "user" | "assistant", content: string | content_block[] }`.
 *
 * System messages are extracted into the top-level `system` parameter
 * (Anthropic doesn't support a "system" role in the messages array).
 */
function translateMessages(
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  _modelInfo: ClaudeModelInfo,
  _options: vscode.ProvideLanguageModelChatResponseOptions,
): {
  body: AnthropicMessage[];
  systemPrompt: { system?: string };
} {
  const body: AnthropicMessage[] = [];
  const systemParts: string[] = [];

  for (const msg of messages) {
    if (msg.name === "system") {
      // Extract system content into the system parameter
      const text = extractText(msg.content);
      if (text) systemParts.push(text);
      continue;
    }

    const role = msg.role === vscode.LanguageModelChatMessageRole.User ? "user" : "assistant";
    const content = translateContentParts(msg.content);

    body.push({ role, content });
  }

  const systemPrompt =
    systemParts.length > 0 ? { system: systemParts.join("\n\n") } : {};

  return { body, systemPrompt };
}

/**
 * Translate VS Code tool definitions to Anthropic tool schema.
 */
function translateTools(
  tools: readonly vscode.LanguageModelChatTool[] | undefined,
): AnthropicTool[] {
  if (!tools) return [];
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema ?? { type: "object", properties: {} },
  }));
}

/**
 * Translate VS Code message content parts into Anthropic content blocks.
 *
 * Handles: text, image (data part), tool calls, tool results.
 */
function translateContentParts(
  parts: readonly unknown[],
): AnthropicContentBlock[] {
  const blocks: AnthropicContentBlock[] = [];

  for (const part of parts) {
    if (!part || typeof part !== "object") continue;

    const p = part as { _kind?: string; value?: unknown };

    // Text part
    if (p instanceof vscode.LanguageModelTextPart || p._kind === "text") {
      const text = (p as { value?: string }).value;
      if (text) blocks.push({ type: "text", text });
      continue;
    }

    // Tool call part (assistant role)
    if (p instanceof vscode.LanguageModelToolCallPart || p._kind === "toolCall") {
      const tcp = p as unknown as {
        callId?: string;
        name?: string;
        input?: object;
      };
      if (tcp.callId && tcp.name) {
        blocks.push({
          type: "tool_use",
          id: tcp.callId,
          name: tcp.name,
          input: tcp.input ?? {},
        });
      }
      continue;
    }

    // Tool result part (user role — response to assistant tool_use)
    if (p instanceof vscode.LanguageModelToolResultPart || p._kind === "toolResult") {
      const trp = p as unknown as {
        callId?: string;
        content?: unknown[];
      };
      if (trp.callId) {
        const resultContent = trp.content ?? [];
        const resultText = extractText(resultContent);
        blocks.push({
          type: "tool_result",
          tool_use_id: trp.callId,
          content: resultText ?? "",
        });
      }
      continue;
    }

    // Data part (images)
    if (p instanceof vscode.LanguageModelDataPart || p._kind === "data") {
      const dp = p as unknown as { data?: Uint8Array; mimeType?: string };
      if (dp.data && dp.mimeType?.startsWith("image/")) {
        const base64 = uint8ArrayToBase64(dp.data);
        blocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: dp.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
            data: base64,
          },
        });
      }
      continue;
    }
  }

  // Anthropic requires at least one block per message
  if (blocks.length === 0) {
    blocks.push({ type: "text", text: "" });
  }

  return blocks;
}

/**
 * Extract concatenated text from a content parts array.
 */
function extractText(parts: readonly unknown[]): string {
  return parts
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const p = part as { value?: unknown; _kind?: string };
      if (typeof p.value === "string") return p.value;
      if (p._kind === "text" && typeof p.value === "string") return p.value;
      return "";
    })
    .filter(Boolean)
    .join("");
}

/**
 * Convert Uint8Array to base64 string without Node.js Buffer dependency.
 */
function uint8ArrayToBase64(arr: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < arr.byteLength; i++) {
    binary += String.fromCharCode(arr[i]);
  }
  return btoa(binary);
}

// ─── Anthropic API Types (minimal) ────────────────────────────────────────

interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicContentBlock[];
}

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "tool_use"; id: string; name: string; input: object }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: object;
}

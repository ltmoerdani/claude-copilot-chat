/**
 * Extension entry point for Claude for Copilot Chat.
 *
 * Registers the Claude LanguageModelChatProvider so that Claude Pro/Max
 * subscription models appear in the Copilot Chat model picker.
 *
 * @see docs/02-architecture-decisions.md
 */

import * as vscode from "vscode";
import { VENDOR_ID, CLAUDE_MODELS } from "./models";
import { TokenStore } from "./tokenStore";
import { AuthProvider } from "./authProvider";
import { ClaudeLanguageModelChatProvider } from "./claudeProvider";

let outputChannel: vscode.OutputChannel | undefined;

/**
 * Extension activation — called by VS Code when the extension loads.
 */
export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel("Claude for Copilot Chat");
  context.subscriptions.push(outputChannel);

  const isDebug = context.extensionMode !== vscode.ExtensionMode.Production;
  if (isDebug) {
    outputChannel.show(true);
  }

  outputChannel.appendLine(`[activate] VS Code version: ${vscode.version}`);
  outputChannel.appendLine(`[activate] Extension mode: ${context.extensionMode}`);
  outputChannel.appendLine(`[activate] Extension ID: ${context.extension.id}`);
  outputChannel.appendLine(`[activate] Vendor ID: ${VENDOR_ID}`);

  // Check if lm API is available
  if (typeof vscode.lm?.registerLanguageModelChatProvider !== "function") {
    outputChannel.appendLine("[activate] ❌ vscode.lm.registerLanguageModelChatProvider is NOT available!");
    outputChannel.appendLine("[activate] The Language Model Chat Provider API is not available in this VS Code version.");
    outputChannel.appendLine("[activate] Requires VS Code 1.125+ with finalized LanguageModelChatProvider API.");
    return;
  }
  outputChannel.appendLine("[activate] ✅ vscode.lm.registerLanguageModelChatProvider is available.");

  // Set up token store and auth
  const tokenStore = new TokenStore(context.secrets);
  const auth = new AuthProvider(tokenStore, outputChannel);

  // Register the language model chat provider
  const provider = new ClaudeLanguageModelChatProvider(auth, outputChannel);
  context.subscriptions.push(provider);

  // Notify VS Code to re-query models when token changes (so picker updates immediately)
  auth.onTokenChanged = () => {
    outputChannel?.appendLine("[auth] Token changed — notifying VS Code to refresh model list");
    provider.notifyChange();
  };

  let providerDisposable: vscode.Disposable;
  try {
    providerDisposable = vscode.lm.registerLanguageModelChatProvider(
      VENDOR_ID,
      provider,
    );
    outputChannel.appendLine(`[activate] ✅ Provider registered successfully with vendor '${VENDOR_ID}'.`);
  } catch (err) {
    outputChannel.appendLine(`[activate] ❌ Failed to register provider: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  context.subscriptions.push(providerDisposable);

  // NOTE: Do NOT fire notifyChange() on a timer or in a loop.
  // VS Code calls provideLanguageModelChatInformation() automatically after
  // registerLanguageModelChatProvider(). Firing notifyChange() repeatedly
  // causes an infinite loop: provideInfo → onDidChangeChatModels → provideInfo → ...
  // This makes VS Code drop the provider, causing models to vanish from the picker.

  // Helper: wrap async command handlers with try-catch + error reporting
  const wrapCommand = (name: string, fn: () => Promise<void>): (() => Promise<void>) => {
    return async () => {
      try {
        await fn();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack ?? "" : "";
        outputChannel?.appendLine(`[cmd:${name}] ❌ Error: ${msg}`);
        if (stack) outputChannel?.appendLine(stack);
        void vscode.window.showErrorMessage(`Claude: ${msg}`);
      }
    };
  };

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "claude-copilot-chat.login",
      wrapCommand("login", async () => { await auth.promptForToken(); }),
    ),
    vscode.commands.registerCommand(
      "claude-copilot-chat.logout",
      wrapCommand("logout", async () => { await auth.clearToken(); }),
    ),
    vscode.commands.registerCommand(
      "claude-copilot-chat.status",
      wrapCommand("status", async () => { await auth.showStatus(); }),
    ),
    vscode.commands.registerCommand(
      "claude-copilot-chat.diagnostics",
      wrapCommand("diagnostics", async () => {
        const oauthToken = await tokenStore.getToken();
        let apiTestResult = "No token set";
        
        if (oauthToken) {
          const results: string[] = [];
          
          const baseHeaders: Record<string, string> = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${oauthToken}`,
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "oauth-2025-04-20,interleaved-thinking-2025-05-14,thinking-token-count-2026-05-13,context-management-2025-06-27,prompt-caching-scope-2026-01-05,claude-code-20250219,advisor-tool-2026-03-01,advanced-tool-use-2025-11-20,extended-cache-ttl-2025-04-11,cache-diagnosis-2026-04-07",
            "anthropic-dangerous-direct-browser-access": "true",
            "User-Agent": "claude-cli/2.1.198 (external, sdk-cli)",
            "x-app": "cli",
            "x-stainless-lang": "js",
            "x-stainless-runtime": "node",
            "x-stainless-os": "MacOS",
            "x-stainless-arch": process.arch,
            "x-stainless-package-version": "0.94.0",
            "x-stainless-retry-count": "0",
            "x-stainless-runtime-version": process.version,
          };

          const tests: { label: string; model: string; body: Record<string, unknown> }[] = [
            {
              label: "Haiku 32K + enabled thinking (known working)",
              model: "claude-haiku-4-5",
              body: {
                model: "claude-haiku-4-5",
                max_tokens: 32000,
                thinking: { type: "enabled", budget_tokens: 31999, display: "omitted" },
                system: [{ type: "text", text: "You are a helpful assistant.", cache_control: { type: "ephemeral" } }],
                messages: [{ role: "user", content: "Say ok" }],
                metadata: { user_id: "test-session-1" },
                context_management: { edits: [{ type: "clear_thinking_20251015", keep: "all" }] },
              },
            },
            {
              label: "Sonnet5 32K + enabled thinking (NOT adaptive)",
              model: "claude-sonnet-5",
              body: {
                model: "claude-sonnet-5",
                max_tokens: 32000,
                thinking: { type: "enabled", budget_tokens: 31999, display: "omitted" },
                system: [{ type: "text", text: "You are a helpful assistant.", cache_control: { type: "ephemeral" } }],
                messages: [{ role: "user", content: "Say ok" }],
                metadata: { user_id: "test-session-2" },
                context_management: { edits: [{ type: "clear_thinking_20251015", keep: "all" }] },
              },
            },
            {
              label: "Sonnet5 64K + adaptive thinking (exact Claude Code)",
              model: "claude-sonnet-5",
              body: {
                model: "claude-sonnet-5",
                max_tokens: 64000,
                thinking: { type: "adaptive", display: "omitted" },
                system: [{ type: "text", text: "You are a helpful assistant.", cache_control: { type: "ephemeral" } }],
                messages: [{ role: "user", content: "Say ok" }],
                metadata: { user_id: "test-session-3" },
                context_management: { edits: [{ type: "clear_thinking_20251015", keep: "all" }] },
              },
            },
            {
              label: "Sonnet5 64K + NO thinking",
              model: "claude-sonnet-5",
              body: {
                model: "claude-sonnet-5",
                max_tokens: 64000,
                system: [{ type: "text", text: "You are a helpful assistant." }],
                messages: [{ role: "user", content: "Say ok" }],
              },
            },
          ];

          for (const test of tests) {
            try {
              const resp = await fetch("https://api.anthropic.com/v1/messages?beta=true", {
                method: "POST",
                headers: baseHeaders,
                body: JSON.stringify(test.body),
              });
              const text = await resp.text();
              const ratelimit5h = resp.headers.get("anthropic-ratelimit-unified-5h-status") || "N/A";
              results.push(`### ${test.label}\nStatus: ${resp.status} | 5h: ${ratelimit5h}\nBody: ${text.slice(0, 300)}\n`);
            } catch (e) {
              results.push(`### ${test.label}\nError: ${e instanceof Error ? e.message : String(e)}\n`);
            }
          }
          apiTestResult = results.join("\n---\n\n");
        }

        const models = await vscode.lm.selectChatModels({ vendor: VENDOR_ID });
        const lines = models.map((m) => {
          return [
            `- ${m.id}`,
            `  name: ${m.name}`,
            `  vendor: ${m.vendor}`,
            `  family: ${m.family}`,
            `  version: ${m.version}`,
            `  maxInputTokens: ${m.maxInputTokens}`,
          ].join("\n");
        });

        const hasToken = await tokenStore.hasToken();
        const content = [
          "# Claude for Copilot Chat Diagnostics",
          "",
          `VS Code version: ${vscode.version}`,
          `Extension mode: ${context.extensionMode}`,
          `Token set: ${hasToken ? "YES" : "NO"}`,
          `Provider registered: YES (vendor: ${VENDOR_ID})`,
          `Models declared: ${CLAUDE_MODELS.length}`,
          ``,
          `Models visible via selectChatModels({ vendor: "${VENDOR_ID}" }): ${models.length}`,
          "",
          ...lines,
          "",
          "## API Connectivity Test",
          "",
          "```",
          apiTestResult,
          "```",
          "",
          "---",
          "If models.length is 0 above, the provider is registered but VS Code",
          "is not returning any models. Check the Output panel (Claude for Copilot Chat)",
          "for provideLanguageModelChatInformation logs.",
        ].join("\n");

        const doc = await vscode.workspace.openTextDocument({ content, language: "markdown" });
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
      }),
    ),
    vscode.commands.registerCommand(
      "claude-copilot-chat.refreshModels",
      () => {
        outputChannel?.appendLine("[cmd] Manual model refresh requested");
        provider.notifyChange();
      },
    ),
  );

  // NOTE: Do NOT subscribe to onDidChangeChatModels just for logging.
  // It fires after every provideLanguageModelChatInformation() call and creates
  // a feedback loop when combined with notifyChange(). Only subscribe if you
  // actually need to react to external model changes.

  // Welcome message on first install
  showWelcomeIfNeeded(context, tokenStore).catch((err) => {
    outputChannel?.appendLine(
      `[warn] Welcome check failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  });

  outputChannel.appendLine("[activate] Claude for Copilot Chat ready.");
}

/**
 * Extension deactivation — cleanup.
 */
export function deactivate(): void {
  // VS Code handles disposal via context.subscriptions
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Show a welcome notification on first install if no token is set.
 */
async function showWelcomeIfNeeded(
  context: vscode.ExtensionContext,
  tokenStore: TokenStore,
): Promise<void> {
  const WELCOME_SHOWN_KEY = "claude.welcomeShown";
  const welcomeShown = context.globalState.get<boolean>(WELCOME_SHOWN_KEY, false);

  if (welcomeShown) return;

  const hasToken = await tokenStore.hasToken();

  context.globalState.update(WELCOME_SHOWN_KEY, true);

  const message = hasToken
    ? "✅ Claude for Copilot Chat is set up. Select 'anthropic' in the Copilot Chat model picker to use Claude."
    : "👋 Claude for Copilot Chat loaded! Run: Command Palette (Cmd+Shift+P) → 'Claude: Set Login Token' to add your token from `claude setup-token`.";

  const actions = hasToken
    ? []
    : [{ title: "Set Token Now" }];

  const choice = await vscode.window.showInformationMessage(message, ...actions);
  if (choice?.title === "Set Token Now") {
    vscode.commands.executeCommand("claude-copilot-chat.login");
  }
}

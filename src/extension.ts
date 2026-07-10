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

  // Force VS Code to re-query models immediately after registration.
  // Some VS Code versions don't call provideLanguageModelChatInformation
  // until the change emitter fires at least once.
  setTimeout(() => {
    provider.notifyChange();
    outputChannel?.appendLine("[activate] Forced initial model refresh via notifyChange()");
  }, 1000);

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

  // Listen for model changes
  if (vscode.lm.onDidChangeChatModels) {
    context.subscriptions.push(
      vscode.lm.onDidChangeChatModels(() => {
        outputChannel?.appendLine("[event] onDidChangeChatModels fired");
      }),
    );
  }

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

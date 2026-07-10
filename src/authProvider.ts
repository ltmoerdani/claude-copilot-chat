/**
 * Authentication provider for Claude API key.
 *
 * Uses VS Code's native configuration flow (languageModelChatProviders[].configuration)
 * to let users enter their OAuth token. The token is then stored in SecretStorage
 * for fast access by the provider.
 *
 * @see docs/02-architecture-decisions.md Decision 3
 */

import * as vscode from "vscode";
import { TokenStore } from "./tokenStore";

/**
 * Manages the Claude subscription authentication lifecycle.
 *
 * Token can be set via:
 * 1. VS Code "Add Models..." flow → `configuration.oauthToken` → we normalise to SecretStorage
 * 2. Command Palette → "Claude: Set Login Token" → prompt for paste
 */
export class AuthProvider {
  onTokenChanged?: () => void;

  constructor(
    private readonly tokenStore: TokenStore,
    private readonly output?: vscode.OutputChannel,
  ) {}

  /**
   * Resolve the OAuth token from SecretStorage.
   *
   * Called by the LanguageModelChatProvider before each request.
   *
   * @returns The token string, or undefined if not set.
   */
  async resolveToken(): Promise<string | undefined> {
    const storedToken = await this.tokenStore.getToken();
    if (storedToken) {
      this.output?.appendLine("[auth] Token found in SecretStorage");
      return storedToken;
    }

    this.output?.appendLine("[auth] No token found in SecretStorage");
    return undefined;
  }

  /**
   * Persist a token directly (used when VS Code passes it via configuration).
   */
  async persistToken(token: string): Promise<void> {
    await this.tokenStore.setToken(token);
    this.output?.appendLine("[auth] Token persisted from configuration");
  }

  /**
   * Prompt the user to paste a token via InputBox.
   *
   * Used by the "Claude: Set Login Token" command.
   */
  async promptForToken(): Promise<boolean> {
    const token = await vscode.window.showInputBox({
      prompt: "Paste your Claude subscription token",
      placeHolder: "Run `claude setup-token` in terminal to generate this token",
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value.trim()) {
          return "Token cannot be empty";
        }
        if (value.trim().length < 20) {
          return "Token looks too short — check you copied the full value from `claude setup-token`";
        }
        return undefined;
      },
    });

    if (!token) {
      return false;
    }

    await this.tokenStore.setToken(token);
    vscode.window.showInformationMessage(
      "Claude token saved. Claude models are now available in Copilot Chat.",
    );
    this.onTokenChanged?.();
    return true;
  }

  /**
   * Clear the stored token.
   */
  async clearToken(): Promise<void> {
    await this.tokenStore.clearToken();
    this.output?.appendLine("[auth] Token cleared from SecretStorage");
    vscode.window.showInformationMessage(
      "Claude token cleared. Run `claude setup-token` and then 'Claude: Set Login Token' to use Claude models again.",
    );
    this.onTokenChanged?.();
  }

  /**
   * Show current auth status to the user.
   */
  async showStatus(): Promise<void> {
    const hasToken = await this.tokenStore.hasToken();
    const items: vscode.MessageItem[] = [
      { title: hasToken ? "Update Token" : "Set Token" },
      ...(hasToken ? [{ title: "Clear Token" }] : []),
    ];

    const message = hasToken
      ? "✅ Claude token is set. Models should appear in the Copilot Chat model picker."
      : "❌ No Claude token set. Run `claude Console API key from console.anthropic.com` in terminal, then use 'Set Token'.";

    const choice = await vscode.window.showInformationMessage(message, ...items);

    if (choice?.title === "Set Token" || choice?.title === "Update Token") {
      await this.promptForToken();
    } else if (choice?.title === "Clear Token") {
      await this.clearToken();
    }
  }
}

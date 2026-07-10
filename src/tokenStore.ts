/**
 * SecretStorage wrapper for the Claude subscription OAuth token.
 *
 * The token is generated via `claude setup-token` and stored encrypted
 * in VS Code's SecretStorage (per-machine, not synced).
 *
 * @see docs/02-architecture-decisions.md Decision 3
 */

import * as vscode from "vscode";

/** SecretStorage key for the OAuth token. */
export const TOKEN_SECRET_KEY = "claude.oauthToken" as const;

/**
 * Manages reading, writing, and clearing the Claude subscription token.
 *
 * The token can come from two sources (checked in order):
 * 1. VS Code SecretStorage (set via "Add Models..." flow or our command)
 * 2. `configuration.oauthToken` (passed by VS Code when user enters via the
 *    `languageModelChatProviders.configuration` schema)
 *
 * We normalise both into SecretStorage for consistency.
 */
export class TokenStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  /**
   * Get the current OAuth token, or undefined if not set.
   *
   * Checks SecretStorage first, then provider configuration as fallback.
   */
  async getToken(): Promise<string | undefined> {
    const stored = await this.secrets.get(TOKEN_SECRET_KEY);
    if (stored && stored.trim()) {
      return stored.trim();
    }
    return undefined;
  }

  /** Store the OAuth token in SecretStorage. */
  async setToken(token: string): Promise<void> {
    await this.secrets.store(TOKEN_SECRET_KEY, token.trim());
  }

  /** Remove the OAuth token from SecretStorage. */
  async clearToken(): Promise<void> {
    await this.secrets.delete(TOKEN_SECRET_KEY);
  }

  /** Check whether a token is present. */
  async hasToken(): Promise<boolean> {
    const token = await this.getToken();
    return !!token;
  }
}

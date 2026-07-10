/**
 * Error handling and retry logic for Anthropic API requests.
 *
 * Handles the error cases documented in docs/02-architecture-decisions.md
 * Decision 10.
 */

/** Error thrown when the Claude token is missing or invalid. */
export class AuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 401,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/** Error thrown when the subscription quota is exceeded. */
export class RateLimitError extends Error {
  constructor(
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

/** Error thrown when the model is not available for the user's plan. */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Error thrown on Anthropic server errors (500/529). */
export class ServerError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "ServerError";
  }
}

/**
 * Map an HTTP status code + response body to a typed error.
 *
 * @returns A typed Error, or null if the status code is not an error.
 */
export function classifyHttpError(
  status: number,
  bodyText: string,
): Error | null {
  const bodySnippet = bodyText.slice(0, 500);

  switch (status) {
    case 401:
      return new AuthError(
        `Claude token is invalid or expired. Re-run \`claude setup-token\` and update via Command Palette → "Claude: Set Login Token".\n\nResponse: ${bodySnippet}`,
      );

    case 403:
      return new ForbiddenError(
        `Your Claude plan does not include this model. Opus requires Max plan; Sonnet/Haiku are available on Pro.\n\nResponse: ${bodySnippet}`,
      );

    case 429: {
      // Try to extract retry-after from common header formats
      const retryMatch = bodyText.match(/retry[_-]after["']?\s*[:=]\s*["']?(\d+)/i);
      const retryAfterSec = retryMatch ? parseInt(retryMatch[1], 10) : undefined;
      // Extract the actual error type from API response
      const typeMatch = bodyText.match(/"type"\s*:\s*"([^"]+)"/);
      const errorType = typeMatch ? typeMatch[1] : "rate_limit_error";
      return new RateLimitError(
        `Claude API returned 429 (${errorType}). ${
          retryAfterSec
            ? `Resets in ~${Math.ceil(retryAfterSec / 60)} minutes.`
            : "This may be a subscription rate limit (5h / weekly / monthly) or an API-level limit."
        }\n\nAPI response: ${bodySnippet}`,
        retryAfterSec ? retryAfterSec * 1000 : undefined,
      );
    }

    case 500:
    case 502:
    case 503:
    case 529:
      return new ServerError(
        `Anthropic server error (${status}). Retrying...\n\nResponse: ${bodySnippet}`,
        status,
      );

    default:
      if (status >= 400) {
        return new Error(`Claude API error ${status}: ${bodySnippet}`);
      }
      return null;
  }
}

/**
 * Determine whether an error is retryable (transient).
 *
 * Retryable: rate limits, server errors, network timeouts.
 * Non-retryable: auth errors, forbidden, client errors.
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof RateLimitError) return true;
  if (error instanceof ServerError) return true;
  if (error instanceof AuthError || error instanceof ForbiddenError) return false;
  // Network errors, timeouts
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("econnreset") ||
      msg.includes("etimedout") ||
      msg.includes("enotfound") ||
      msg.includes("fetch failed") ||
      msg.includes("network")
    );
  }
  return false;
}

/**
 * Sleep for the given milliseconds. Used for backoff.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay with jitter.
 *
 * @param attempt - Zero-based retry attempt number.
 * @param baseMs - Base delay in ms (default 1000).
 * @param maxMs - Maximum delay cap (default 30000).
 * @returns Delay in milliseconds.
 */
export function backoffDelay(
  attempt: number,
  baseMs: number = 1000,
  maxMs: number = 30_000,
): number {
  const exp = Math.min(baseMs * Math.pow(2, attempt), maxMs);
  // Add 0-50% jitter to avoid thundering herd
  const jitter = Math.random() * 0.5 * exp;
  return Math.round(exp + jitter);
}

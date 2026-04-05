/**
 * Masquerade configuration for Anthropic API requests.
 *
 * When enabled, OpenClaw presents itself as Claude Code to the Anthropic API,
 * using Claude Code's User-Agent, x-app header, and beta features.
 *
 * Configured via openclaw.json:
 * {
 *   "auth": {
 *     "masquerade": {
 *       "enabled": true,
 *       "userAgent": "claude-cli/2.1.81 (external, cli)",
 *       "xApp": "cli",
 *       "extraBetaFeatures": ["claude-code-20250219"]
 *     }
 *   }
 * }
 */

import type { AuthMasqueradeConfig } from "../config/types.auth.js";

const DEFAULT_CLAUDE_CODE_VERSION = "2.1.81";
const DEFAULT_USER_AGENT = `claude-cli/${DEFAULT_CLAUDE_CODE_VERSION} (external, cli)`;
const DEFAULT_X_APP = "cli";
const DEFAULT_EXTRA_BETA_FEATURES = [
  "claude-code-20250219",
  "oauth-2025-04-20",
  "context-1m-2025-08-07",
  "interleaved-thinking-2025-05-14",
  "redact-thinking-2026-02-12",
];

export type ResolvedMasquerade = {
  enabled: boolean;
  userAgent: string;
  xApp: string;
  extraBetaFeatures: string[];
  claudeCodeVersion: string;
};

let _cachedConfig: ResolvedMasquerade | null = null;
let _lastRawConfig: AuthMasqueradeConfig | undefined = undefined;

/**
 * Resolve masquerade settings from config.
 * Results are cached until config changes.
 */
export function resolveMasquerade(config?: AuthMasqueradeConfig): ResolvedMasquerade {
  if (_cachedConfig && _lastRawConfig === config) {
    return _cachedConfig;
  }

  const enabled = config?.enabled ?? false;
  const userAgent = config?.userAgent ?? DEFAULT_USER_AGENT;
  const xApp = config?.xApp ?? DEFAULT_X_APP;
  const extraBetaFeatures = config?.extraBetaFeatures ?? DEFAULT_EXTRA_BETA_FEATURES;

  // Extract version from userAgent pattern "claude-cli/X.Y.Z"
  const versionMatch = userAgent.match(/^claude-cli\/(.+)$/);
  const claudeCodeVersion = versionMatch?.[1] ?? DEFAULT_CLAUDE_CODE_VERSION;

  _cachedConfig = { enabled, userAgent, xApp, extraBetaFeatures, claudeCodeVersion };
  _lastRawConfig = config;
  return _cachedConfig;
}

/**
 * Get masquerade User-Agent, falling back to OpenClaw default if disabled.
 */
export function getMasqueradeUserAgent(config?: AuthMasqueradeConfig): string | null {
  const resolved = resolveMasquerade(config);
  return resolved.enabled ? resolved.userAgent : null;
}

/**
 * Reset cached config (for testing).
 */
export function resetMasqueradeCache(): void {
  _cachedConfig = null;
  _lastRawConfig = undefined;
}

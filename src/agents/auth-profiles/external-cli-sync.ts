import { loadConfig } from "../../config/config.js";
import {
  readClaudeCliCredentialsCached,
  readCodexCliCredentialsCached,
  readMiniMaxCliCredentialsCached,
} from "../cli-credentials.js";
import {
  CLAUDE_CLI_PROFILE_ID,
  EXTERNAL_CLI_SYNC_TTL_MS,
  OPENAI_CODEX_DEFAULT_PROFILE_ID,
  MINIMAX_CLI_PROFILE_ID,
  log,
} from "./constants.js";
import type { AuthProfileStore, ExternalOAuthManager, OAuthCredential } from "./types.js";

type ExternalCliSyncOptions = {
  log?: boolean;
};

type ExternalCliSyncProvider = {
  profileId: string;
  provider: string;
  managedBy: ExternalOAuthManager;
  readCredentials: () => OAuthCredential | null;
};

export function areOAuthCredentialsEquivalent(
  a: OAuthCredential | undefined,
  b: OAuthCredential,
): boolean {
  if (!a) {
    return false;
  }
  if (a.type !== "oauth") {
    return false;
  }
  return (
    a.provider === b.provider &&
    a.access === b.access &&
    a.refresh === b.refresh &&
    a.expires === b.expires &&
    a.email === b.email &&
    a.enterpriseUrl === b.enterpriseUrl &&
    a.projectId === b.projectId &&
    a.accountId === b.accountId &&
    a.managedBy === b.managedBy
  );
}

function hasNewerStoredOAuthCredential(
  existing: OAuthCredential | undefined,
  incoming: OAuthCredential,
): boolean {
  return Boolean(
    existing &&
    existing.provider === incoming.provider &&
    Number.isFinite(existing.expires) &&
    (!Number.isFinite(incoming.expires) || existing.expires > incoming.expires),
  );
}

export function shouldReplaceStoredOAuthCredential(
  existing: OAuthCredential | undefined,
  incoming: OAuthCredential,
): boolean {
  if (!existing || existing.type !== "oauth") {
    return true;
  }
  if (areOAuthCredentialsEquivalent(existing, incoming)) {
    return false;
  }
  return !hasNewerStoredOAuthCredential(existing, incoming);
}

const EXTERNAL_CLI_SYNC_PROVIDERS: ExternalCliSyncProvider[] = [
  {
    profileId: MINIMAX_CLI_PROFILE_ID,
    provider: "minimax-portal",
    managedBy: "minimax-cli",
    readCredentials: () => readMiniMaxCliCredentialsCached({ ttlMs: EXTERNAL_CLI_SYNC_TTL_MS }),
  },
  {
    profileId: OPENAI_CODEX_DEFAULT_PROFILE_ID,
    provider: "openai-codex",
    managedBy: "codex-cli",
    readCredentials: () => readCodexCliCredentialsCached({ ttlMs: EXTERNAL_CLI_SYNC_TTL_MS }),
  },
  {
    profileId: CLAUDE_CLI_PROFILE_ID,
    provider: "anthropic",
    managedBy: "claude-cli",
    readCredentials: (): OAuthCredential | null => {
      // Only sync Claude CLI credentials when masquerade is enabled
      const cfg = loadConfig();
      if (!cfg?.auth?.masquerade?.enabled) {
        return null;
      }
      const creds = readClaudeCliCredentialsCached({
        ttlMs: EXTERNAL_CLI_SYNC_TTL_MS,
        allowKeychainPrompt: false,
      });
      if (!creds) {
        return null;
      }
      if (creds.type === "oauth") {
        return {
          type: "oauth",
          provider: "anthropic",
          access: creds.access,
          refresh: creds.refresh,
          expires: creds.expires,
        };
      }
      // Token-type credentials from Claude CLI (non-refreshable)
      // Not suitable for OAuth sync
      return null;
    },
  },
];

function withExternalCliManager(
  creds: OAuthCredential,
  managedBy: ExternalOAuthManager,
): OAuthCredential {
  return {
    ...creds,
    managedBy,
  };
}

function resolveExternalCliSyncProvider(params: {
  profileId?: string;
  credential?: OAuthCredential;
}): ExternalCliSyncProvider | null {
  const byProfileId =
    typeof params.profileId === "string"
      ? EXTERNAL_CLI_SYNC_PROVIDERS.find((entry) => entry.profileId === params.profileId)
      : undefined;
  if (byProfileId) {
    return byProfileId;
  }
  const managedBy = params.credential?.managedBy;
  if (!managedBy) {
    return null;
  }
  return (
    EXTERNAL_CLI_SYNC_PROVIDERS.find(
      (entry) =>
        entry.managedBy === managedBy &&
        (!params.credential || entry.provider === params.credential.provider),
    ) ?? null
  );
}

export function readManagedExternalCliCredential(params: {
  profileId?: string;
  credential: OAuthCredential;
}): OAuthCredential | null {
  const provider = resolveExternalCliSyncProvider(params);
  if (!provider) {
    return null;
  }
  const creds = provider.readCredentials();
  if (!creds) {
    return null;
  }
  return withExternalCliManager(creds, provider.managedBy);
}

/** Sync external CLI credentials into the store for a given provider. */
function syncExternalCliCredentialsForProvider(
  store: AuthProfileStore,
  providerConfig: ExternalCliSyncProvider,
  options: ExternalCliSyncOptions,
): boolean {
  const { profileId, provider, managedBy, readCredentials } = providerConfig;
  const existing = store.profiles[profileId];
  const creds = readCredentials();
  if (!creds) {
    return false;
  }
  const managedCreds = withExternalCliManager(creds, managedBy);

  const existingOAuth = existing?.type === "oauth" ? existing : undefined;
  if (!shouldReplaceStoredOAuthCredential(existingOAuth, managedCreds)) {
    if (options.log !== false) {
      if (!areOAuthCredentialsEquivalent(existingOAuth, managedCreds) && existingOAuth) {
        log.debug(`kept newer stored ${provider} credentials over external cli sync`, {
          profileId,
          storedExpires: new Date(existingOAuth.expires).toISOString(),
          externalExpires: Number.isFinite(managedCreds.expires)
            ? new Date(managedCreds.expires).toISOString()
            : null,
        });
      }
    }
    return false;
  }

  store.profiles[profileId] = managedCreds;
  if (options.log !== false) {
    log.info(`synced ${provider} credentials from external cli`, {
      profileId,
      expires: new Date(managedCreds.expires).toISOString(),
      managedBy,
    });
  }
  return true;
}

/**
 * When masquerade is enabled, sync Claude Code keychain credentials into
 * the first existing anthropic profile (typically "anthropic:manual").
 * This ensures the token is used by resolvePiCredentialMapFromStore which
 * takes the first profile per provider from Object.values.
 */
function syncClaudeCliIntoExistingAnthropicProfile(
  store: AuthProfileStore,
  options: ExternalCliSyncOptions,
): boolean {
  const cfg = loadConfig();
  if (!cfg?.auth?.masquerade?.enabled) {
    return false;
  }
  const creds = readClaudeCliCredentialsCached({
    ttlMs: EXTERNAL_CLI_SYNC_TTL_MS,
    allowKeychainPrompt: false,
  });
  if (!creds || creds.type !== "oauth") {
    return false;
  }

  // Find the first anthropic profile in the store
  const anthropicEntry = Object.entries(store.profiles).find(([, v]) => v.provider === "anthropic");
  if (!anthropicEntry) {
    return false;
  }
  const [profileId, existing] = anthropicEntry;

  // Build the managed credential
  const managed: OAuthCredential = {
    type: "oauth",
    provider: "anthropic",
    access: creds.access,
    refresh: creds.refresh,
    expires: creds.expires,
    managedBy: "claude-cli",
  };

  // Check if update is needed
  const existingOAuth = existing?.type === "oauth" ? existing : undefined;
  if (existingOAuth && areOAuthCredentialsEquivalent(existingOAuth, managed)) {
    return false;
  }

  store.profiles[profileId] = managed;
  if (options.log !== false) {
    log.info(`synced anthropic credentials from Claude CLI keychain into ${profileId}`, {
      profileId,
      expires: new Date(managed.expires).toISOString(),
      managedBy: "claude-cli",
    });
  }
  return true;
}

/**
 * Sync OAuth credentials from external CLI tools (MiniMax CLI, Codex CLI)
 * into the store.
 *
 * Returns true if any credentials were updated.
 */
export function syncExternalCliCredentials(
  store: AuthProfileStore,
  options: ExternalCliSyncOptions = {},
): boolean {
  let mutated = false;

  for (const provider of EXTERNAL_CLI_SYNC_PROVIDERS) {
    if (syncExternalCliCredentialsForProvider(store, provider, options)) {
      mutated = true;
    }
  }

  // Masquerade: sync Claude CLI credentials into existing anthropic profile
  if (syncClaudeCliIntoExistingAnthropicProfile(store, options)) {
    mutated = true;
  }

  return mutated;
}

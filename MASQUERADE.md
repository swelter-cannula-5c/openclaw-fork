# Claude Code Masquerade for OpenClaw

Present your OpenClaw instance as Claude Code to the Anthropic API — cleanly, in source, with zero sed patches.

## Why

Since April 2026, Anthropic distinguishes third-party harnesses (OpenClaw, Cline, etc.) from Claude Code by HTTP headers (`User-Agent`, `x-app`, `anthropic-beta`). This fork adds a configurable masquerade layer that makes OpenClaw's requests indistinguishable from Claude Code.

## What It Does

When `auth.masquerade.enabled` is `true`:

| Header           | Default (OpenClaw)   | Masquerade                              |
| ---------------- | -------------------- | --------------------------------------- |
| `User-Agent`     | `openclaw/<version>` | `claude-cli/2.1.75`                     |
| `x-app`          | _(none)_             | `cli`                                   |
| `anthropic-beta` | `oauth-2025-04-20`   | `claude-code-20250219,oauth-2025-04-20` |

Additionally:

- **Keychain sync**: Reads OAuth tokens from Claude Code's macOS Keychain entry (`Claude Code-credentials`)
- **Token refresh writeback**: When tokens are refreshed, writes them back to Claude Code's Keychain
- **Usage endpoint**: The `/api/oauth/usage` endpoint also uses masquerade headers

## Prerequisites

1. **Claude Code installed and authenticated:**

   ```bash
   # Install Claude Code
   npm install -g @anthropic-ai/claude-code

   # Login (stores OAuth token in macOS Keychain)
   claude auth login
   ```

2. **macOS** (Keychain integration is macOS-only via `security` CLI)

## Installation

### Option A: Install from this fork

```bash
git clone https://github.com/swelter-cannula-5c/openclaw-fork.git
cd openclaw-fork
pnpm install
pnpm build
npm install -g .
```

### Option B: Replace existing OpenClaw

```bash
# Backup current installation
tar cf ~/openclaw-backup.tar -C $(npm root -g)/openclaw dist package.json

# Clone and build
git clone https://github.com/swelter-cannula-5c/openclaw-fork.git
cd openclaw-fork
pnpm install
pnpm build
npm install -g .
```

## Configuration

Add to your `~/.openclaw/openclaw.json`:

```json
{
  "auth": {
    "masquerade": {
      "enabled": true
    }
  }
}
```

Then restart:

```bash
openclaw gateway restart
```

### Full Config Options

```json
{
  "auth": {
    "masquerade": {
      "enabled": true,
      "userAgent": "claude-cli/2.1.75",
      "xApp": "cli",
      "extraBetaFeatures": ["claude-code-20250219"]
    }
  }
}
```

| Option              | Default                    | Description                        |
| ------------------- | -------------------------- | ---------------------------------- |
| `enabled`           | `false`                    | Enable/disable masquerade          |
| `userAgent`         | `claude-cli/2.1.75`        | User-Agent header value            |
| `xApp`              | `cli`                      | x-app header value                 |
| `extraBetaFeatures` | `["claude-code-20250219"]` | Additional anthropic-beta features |

## How It Works

```
Claude Code login → OAuth token in macOS Keychain
                          ↓
OpenClaw gateway start → syncExternalCliCredentials
                          ↓ reads "Claude Code-credentials" from Keychain
                    stores as "anthropic:claude-cli" auth profile
                          ↓
                    all Anthropic API requests use:
                      User-Agent: claude-cli/2.1.75
                      x-app: cli
                      anthropic-beta: claude-code-20250219,...
                          ↓
                    on token expiry → refresh → write back to Keychain
```

## Updating Claude Code Version

When Claude Code updates, update the version string:

```json
{
  "auth": {
    "masquerade": {
      "enabled": true,
      "userAgent": "claude-cli/2.2.0"
    }
  }
}
```

Check your installed version:

```bash
claude --version
```

## Updating the Fork

```bash
cd openclaw-fork
git fetch upstream
git rebase upstream/main
pnpm install
pnpm build
openclaw gateway restart
```

## Rollback

```bash
# If you backed up with tar:
npm install -g openclaw@<original-version>

# Or restore from backup:
cd $(npm root -g)
rm -rf openclaw
tar xf ~/openclaw-backup.tar
openclaw gateway restart
```

## Verification

Check that masquerade is active by inspecting outgoing headers with mitmproxy:

```bash
# Install mitmproxy
brew install mitmproxy

# Run proxy
mitmdump -p 8082 --set flow_detail=2 2>&1 | grep -E "user-agent|x-app|anthropic-beta"

# In another terminal, set proxy for gateway:
HTTPS_PROXY=http://127.0.0.1:8082 openclaw gateway restart
```

You should see:

```
user-agent: claude-cli/2.1.75
x-app: cli
anthropic-beta: claude-code-20250219,oauth-2025-04-20,...
```

## Files Changed (from upstream)

| File                                            | Change                               |
| ----------------------------------------------- | ------------------------------------ |
| `src/agents/masquerade.ts`                      | **New** — masquerade config resolver |
| `src/agents/anthropic-transport-stream.ts`      | OAuth headers use masquerade         |
| `src/infra/provider-usage.fetch.claude.ts`      | Usage endpoint uses masquerade       |
| `src/agents/auth-profiles/external-cli-sync.ts` | Claude CLI keychain sync provider    |
| `src/agents/auth-profiles/oauth.ts`             | Refresh writeback to Claude CLI      |
| `src/agents/auth-profiles/types.ts`             | `claude-cli` manager type            |
| `src/config/types.auth.ts`                      | `AuthMasqueradeConfig` type          |
| `src/config/schema.base.generated.ts`           | JSON Schema for masquerade           |
| `src/config/zod-schema.ts`                      | Zod validation for masquerade        |

## License

Same as upstream OpenClaw.

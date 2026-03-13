import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

interface ClaudeCredentials {
  claudeAiOauth?: {
    accessToken: string;
    expiresAt: number;
  };
}

/**
 * Returns the Anthropic API key to use.
 * Priority:
 *   1. ANTHROPIC_API_KEY env var (explicit API key)
 *   2. Claude Code OAuth token from ~/.claude/.credentials.json
 *
 * Re-reads the credentials file each call so refreshed tokens are picked up
 * automatically without restarting the server.
 */
export function getApiKey(): string | undefined {
  if (process.env.ANTHROPIC_API_KEY) {
    return process.env.ANTHROPIC_API_KEY;
  }

  try {
    const credPath = join(homedir(), '.claude', '.credentials.json');
    const creds: ClaudeCredentials = JSON.parse(readFileSync(credPath, 'utf-8'));
    const oauth = creds.claudeAiOauth;
    if (!oauth?.accessToken) return undefined;

    if (oauth.expiresAt && Date.now() > oauth.expiresAt) {
      console.warn('[Auth] Claude Code OAuth token is expired. Run `claude auth login` to refresh.');
      return undefined;
    }

    return oauth.accessToken;
  } catch {
    return undefined;
  }
}

export function getApiKeyOrThrow(): string {
  const key = getApiKey();
  if (!key) {
    throw new Error(
      'No Anthropic API key found. Set ANTHROPIC_API_KEY or log in with `claude auth login`.'
    );
  }
  return key;
}

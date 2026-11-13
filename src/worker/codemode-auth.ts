import type { AuthProvider } from "@earendil-works/pi-mcp";
import { McpOAuthProvider, type McpOAuthState } from "@earendil-works/pi-mcp/oauth";

export const codemodeCallbackPath = "/api/mcp/codemode/callback";
export const codemodeNotConnected = "codemode is not connected. Connect it in Details.";

const clientName = "flarebot";

export type OAuthStorage = { load(): McpOAuthState | undefined; save(state: McpOAuthState): void };

export function codemodeOAuth(env: Env, origin: string, store: OAuthStorage, onRedirect: (url: URL) => void): McpOAuthProvider {
  return new McpOAuthProvider({
    serverUrl: env.CODEMODE_MCP_URL,
    redirectUrl: `${origin}${codemodeCallbackPath}`,
    clientMetadata: { client_name: clientName },
    store,
    onRedirect,
  });
}

export function codemodeAuthProvider(token: (refresh: boolean) => Promise<string | null>): AuthProvider {
  return {
    token: async () => (await token(false)) ?? undefined,
    onUnauthorized: async () => {
      if ((await token(true)) === null) throw new Error(codemodeNotConnected);
    },
  };
}

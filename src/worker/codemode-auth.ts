import type { AuthProvider } from "@earendil-works/pi-mcp";
import { McpOAuthProvider, type McpOAuthState } from "@earendil-works/pi-mcp/oauth";

export const codemodeCallbackPath = "/api/mcp/codemode/callback";
export const mcpCallbackPath = "/api/mcp/oauth/callback";
export const clientMetadataPath = "/api/oauth/client-metadata.json";
export const codemodeNotConnected = "codemode is not connected. Connect it in Details.";

const clientName = "flarebot";

export type OAuthStorage = { load(): McpOAuthState | undefined; save(state: McpOAuthState): void };
export type OAuthClient = { clientId: string; clientSecret?: string };

export function clientMetadataDocument(origin: string) {
  return { client_id: `${origin}${clientMetadataPath}`, client_name: clientName, client_uri: origin, redirect_uris: [`${origin}${mcpCallbackPath}`], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" };
}

export function mcpOAuth(input: { serverUrl: string; redirectUrl: string; store: OAuthStorage; onRedirect: (url: URL) => void; client?: OAuthClient | undefined; cimd?: { url: string; redirectUrl: string } | undefined }): McpOAuthProvider {
  const cimd = input.cimd;
  return new McpOAuthProvider({
    ...(cimd === undefined ? {} : { clientMetadataDocument: (metadata) => (metadata?.client_id_metadata_document_supported === true ? cimd : undefined) }),
    serverUrl: input.serverUrl,
    redirectUrl: input.redirectUrl,
    clientMetadata: { client_name: clientName },
    store: input.store,
    onRedirect: input.onRedirect,
    ...(input.client === undefined ? {} : { clientId: input.client.clientId, ...(input.client.clientSecret === undefined ? {} : { clientSecret: input.client.clientSecret }) }),
  });
}

export function codemodeOAuth(env: Env, origin: string, store: OAuthStorage, onRedirect: (url: URL) => void): McpOAuthProvider {
  return mcpOAuth({ serverUrl: env.CODEMODE_MCP_URL, redirectUrl: `${origin}${codemodeCallbackPath}`, store, onRedirect });
}

export function tokenAuthProvider(token: (refresh: boolean) => Promise<string | null>, notConnected: string): AuthProvider {
  return {
    token: async () => (await token(false)) ?? undefined,
    onUnauthorized: async () => {
      if ((await token(true)) === null) throw new Error(notConnected);
    },
  };
}

export function codemodeAuthProvider(token: (refresh: boolean) => Promise<string | null>): AuthProvider {
  return tokenAuthProvider(token, codemodeNotConnected);
}

export function notConnectedMessage(name: string): string {
  return `${name} is not connected. Call request_connection with ${name} so the user can sign in.`;
}

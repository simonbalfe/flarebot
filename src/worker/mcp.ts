import { type LlmContent, McpClient, StreamableHttpTransport, toLlmContent } from "@earendil-works/pi-mcp";

const maxTextChars = 30_000;
const clientInfo = { name: "flarebot", version: "0.1.0" };
const codemodeServerId = "codemode";
const codemodeDescription = "Gateway to external APIs and connected MCP servers. Its code tool runs JavaScript with a codemode object. Call codemode.start({}) first.";

export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  description: string;
  headers: Record<string, string>;
}

export interface McpServerSummary {
  id: string;
  name: string;
  url: string;
  description: string;
  hasToken: boolean;
  builtIn: boolean;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpCallResult {
  content: LlmContent[];
  isError: boolean;
}

export function serverSummary(server: McpServerConfig): McpServerSummary {
  return { id: server.id, name: server.name, url: server.url, description: server.description, hasToken: Object.keys(server.headers).length > 0, builtIn: isBuiltInServer(server.id) };
}

export function isBuiltInServer(id: string): boolean {
  return id === codemodeServerId;
}

export function codemodeServer(env: Env): McpServerConfig {
  return { id: codemodeServerId, name: codemodeServerId, url: env.CODEMODE_MCP_URL, description: codemodeDescription, headers: { authorization: `Bearer ${env.CODEMODE_API_KEY}` } };
}

function clip(content: LlmContent): LlmContent {
  if (content.type !== "text" || content.text.length <= maxTextChars) return content;
  return { ...content, text: `${content.text.slice(0, maxTextChars)}\n[cut at ${maxTextChars} characters]` };
}

async function withClient<T>(server: McpServerConfig, work: (client: McpClient) => Promise<T>): Promise<T> {
  const client = new McpClient(clientInfo);
  await client.connect(new StreamableHttpTransport({ url: server.url, headers: server.headers, openGetStream: false }));
  try {
    return await work(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

export function listTools(server: McpServerConfig): Promise<McpTool[]> {
  return withClient(server, async (client) =>
    (await client.listTools()).map((tool) => ({ name: tool.name, description: tool.description ?? tool.title ?? "", inputSchema: tool.inputSchema })),
  );
}

export function callTool(server: McpServerConfig, name: string, args: Record<string, unknown>): Promise<McpCallResult> {
  return withClient(server, async (client) => {
    const result = await client.callTool(name, args);
    return { content: toLlmContent(result).map(clip), isError: result.isError === true };
  });
}

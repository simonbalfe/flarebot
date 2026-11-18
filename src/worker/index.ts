import { type Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { createAuth, requireApp, requireSession } from "./auth";
import daemonSource from "../../scripts/flarebot-local.ts?raw";
import modelServerLock from "../../model-container/package-lock.json?raw";
import modelServerPackage from "../../model-container/package.json?raw";
import modelServerSource from "../../model-container/server.ts?raw";
import { macInstallScript } from "./mac-install";
import { doc, openApiDocument } from "./openapi";
import { catalog, catalogEntry, clientEnvPrefix } from "./catalog";
import { clientMetadataDocument, clientMetadataPath, codemodeCallbackPath, mcpCallbackPath } from "./codemode-auth";
import { cliNamePattern, readSkill } from "./pool";
import { pushDeviceSchema } from "./native-push";
import { pushSubscriptionSchema } from "./push";
import type { RoutinePatch } from "./bot";
import type { RoutineSchedule } from "./routines";
import { secretNamePattern } from "./approvals";
import { type AppEnv, computerName, effortLabels, efforts, macName, modelLabels, models, userName } from "./env";

export { WorkspaceServiceProxy } from "@cloudflare/computer";
export { Bot } from "./bot";
export { Computer, SharedComputer } from "./computer";
export { Group } from "./group";
export { Mac } from "./mac";
export { ModelContainer } from "./model-container";
export { User } from "./user";

const roleSchema = z.string().trim().max(500);
const newBotBody = z.object({
  name: z.string().trim().min(1).max(60),
  role: roleSchema.default(""),
});
const roleBody = z.object({ role: roleSchema });
const groupNameBody = z.object({ name: z.string().trim().min(1).max(60) });
const mcpServerBody = z.object({
  name: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,39}$/),
  url: z.url({ protocol: /^https?$/ }),
  description: z.string().trim().max(300).default(""),
  token: z.string().trim().max(4000).default(""),
});
const botMcpBody = z.object({ serverIds: z.array(z.string()).max(50) });
const cliName = z.string().regex(cliNamePattern);
const cliQuery = z.object({ description: z.string().trim().max(300).default("") });
const poolItemName = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/);
const poolKind = z.enum(["clis", "skills"]);
const botPoolBody = z.object({ names: z.array(poolItemName).max(100) });
const maxUploadBytes = 30 * 1024 * 1024;
const macLinkBody = z.object({ name: z.string().trim().min(1).max(100) });
const macPollBody = z.object({ deviceCode: z.string().regex(/^[0-9a-f]{64}$/) });
const macApproveBody = z.object({ userCode: z.string().trim().min(1).max(20) });
const botMacBody = z.object({ enabled: z.boolean() });
const projectName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/);
const projectBody = z.object({ name: projectName });
const newThreadBody = z.object({ project: projectName.nullable().default(null) });
const threadTitleBody = z.object({ title: z.string().trim().min(1).max(60) });
const newGroupBody = z.object({
  name: z.string().trim().max(60).default(""),
  botIds: z.array(z.string()).min(2).max(6),
});
const messageBody = z.object({ text: z.string().trim().min(1).max(20_000) });
const modelBody = z.object({ model: z.enum(models) });
const effortBody = z.object({ effort: z.enum(efforts) });
const cookiesBody = z.object({ cookies: z.array(z.record(z.string(), z.unknown())).max(50_000) });
const fileQuery = z.object({
  path: z.string().regex(/^\/workspace\/(?!.*\.\.)[A-Za-z0-9._\/-]+$/),
  executable: z.enum(["0", "1"]).default("0"),
});
const memoryBody = z.object({ text: z.string().trim().min(1).max(2000) });
const skillTextBody = z.object({ markdown: z.string().min(1).max(200_000) });
const cliDescription = z.string().trim().max(300).default("");
const cliJsonBody = z.union([z.object({ description: cliDescription, script: z.string().min(1).max(2_000_000) }), z.object({ description: cliDescription, base64: z.base64().min(1) })]);
const browserActionBody = z.discriminatedUnion("type", [
  z.object({ type: z.literal("show") }),
  z.object({ type: z.literal("navigate"), url: z.url({ protocol: /^https?$/ }) }),
  z.object({ type: z.literal("screenshot") }),
  z.object({ type: z.literal("click"), x: z.number(), y: z.number() }),
  z.object({ type: z.literal("type"), text: z.string().max(10_000) }),
  z.object({ type: z.literal("key"), key: z.string().min(1).max(40) }),
  z.object({ type: z.literal("scroll"), x: z.number(), y: z.number(), deltaY: z.number() }),
]);
const tabQuery = z.object({ screenshot: z.enum(["0", "1"]).default("0") });
const resetQuery = z.object({ wipe: z.enum(["true", "false"]).default("false") });
const pushUnsubscribeBody = z.object({ endpoint: z.url() });
const pushDeviceRemoveBody = pushDeviceSchema.pick({ token: true });
const vncPrefix = "/api/computer/vnc";
const maxHookBytes = 64 * 1024;
const routineId = z.string().regex(/^[0-9a-f]{8}$/);
const hookToken = z.string().regex(/^[0-9a-f]{48}$/);
const routineBase = {
  title: z.string().trim().min(1).max(80),
  prompt: z.string().trim().min(1).max(4000),
  scheduleText: z.string().trim().min(1).max(120),
  timezone: z.string().trim().min(1).max(64),
};
const routineWhen = { cron: z.string().trim().min(9).max(120).optional(), at: z.iso.datetime({ offset: true }).optional() };
const newRoutineBody = z.object({ ...routineBase, ...routineWhen }).refine((body) => (body.cron === undefined) !== (body.at === undefined), "Give exactly one of cron or at");
const routinePatchBody = z.object(routineBase).partial().extend({ ...routineWhen, paused: z.boolean().optional() }).refine((body) => body.cron === undefined || body.at === undefined, "Give at most one of cron or at");
const decisionBody = z.object({ decision: z.enum(["once", "always", "deny"]) });
const secretValueBody = z.object({ value: z.string().min(1).max(10_000) });
const askFirstBody = z.object({ enabled: z.boolean() });
const ruleBody = z.object({ rule: z.string().min(1).max(200) });
const secretName = z.string().regex(secretNamePattern);
const secretAccessBody = z.object({ allowed: z.boolean() });
const connectBody = z.object({ botId: z.string().optional(), requestId: z.string().optional() });
const addAppBody = z.object({ token: z.string().trim().max(4000).default("") });
const hookStatus = { started: 202, not_found: 404, paused: 409, busy: 409, too_soon: 429 } as const;
const hookMessages = { started: "Started", not_found: "Not found", paused: "This routine is paused", busy: "The previous run has not finished", too_soon: "Wait a minute between webhook runs" } as const;

function scheduleFrom(body: { cron?: string | undefined; at?: string | undefined }): RoutineSchedule | undefined {
  if (body.cron !== undefined) return { kind: "cron", cron: body.cron };
  if (body.at !== undefined) return { kind: "once", at: Date.parse(body.at) };
  return undefined;
}

const app = new Hono<AppEnv>();

app.onError((error, c) => {
  if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
  if (error instanceof z.ZodError) return c.json({ error: error.issues.map((issue) => issue.message).join("; ") }, 400);
  console.error(error);
  return c.json({ error: "Internal error" }, 500);
});

app.on(["GET", "POST"], "/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw));

app.get("/mac/install.sh", (c) => c.body(macInstallScript(new URL(c.req.url).origin), 200, { "content-type": "text/x-shellscript; charset=utf-8", "cache-control": "no-store" }));

app.get("/mac/flarebot-local.ts", (c) => c.body(daemonSource, 200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }));

const modelServerFiles: Record<string, string> = { "server.ts": modelServerSource, "package.json": modelServerPackage, "package-lock.json": modelServerLock };

app.get("/mac/model-server/:file", (c) => {
  const source = modelServerFiles[c.req.param("file")];
  return source === undefined ? c.body(null, 404) : c.body(source, 200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
});

app.post("/api/mac/link", async (c) => {
  const body = macLinkBody.parse(await c.req.json());
  const link = await mac(c.env).startLink(body.name);
  return c.json({ ...link, verifyUrl: `${new URL(c.req.url).origin}/connect-mac?code=${link.userCode}` }, 201);
});

app.post("/api/mac/link/poll", async (c) => {
  const body = macPollBody.parse(await c.req.json());
  return c.json(await mac(c.env).pollLink(body.deviceCode));
});

app.get("/api/mac/whoami", async (c) => {
  const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return (await mac(c.env).checkToken(token)) ? c.body(null, 204) : c.json({ error: "Not linked" }, 401);
});

app.get("/api/mac/connect", (c) => mac(c.env).fetch(c.req.raw));

app.post("/api/hooks/routines/:botId/:routineId/:token", async (c) => {
  const botId = z.uuid().safeParse(c.req.param("botId"));
  const id = routineId.safeParse(c.req.param("routineId"));
  const token = hookToken.safeParse(c.req.param("token"));
  if (!botId.success || !id.success || !token.success || !(await user(c.env).has(botId.data))) return c.json({ error: hookMessages.not_found }, 404);
  if (Number(c.req.header("content-length") ?? 0) > maxHookBytes) return c.json({ error: "Payload too large" }, 413);
  const raw = (await c.req.text()).slice(0, maxHookBytes);
  const result = await c.env.BOT.getByName(botId.data).triggerRoutineHook(id.data, token.data, raw.trim() === "" ? null : raw);
  return c.json(result === "started" ? { status: "started" } : { error: hookMessages[result] }, hookStatus[result]);
});

app.get(clientMetadataPath, (c) => c.json(clientMetadataDocument(new URL(c.req.url).origin), 200, { "cache-control": "public, max-age=300" }));

app.use("/api/*", requireSession);

app.get("/api/openapi.json", (c) => c.json(openApiDocument(app.routes, new URL(c.req.url).origin)));

app.get("/api/mac", doc({ id: "getMac", tag: "Mac", summary: "Read the Mac link status", returns: "paired, connected, name, roots and pendingLink. Linking, unpairing and per-Bot Mac access are app only." }), async (c) => c.json(await mac(c.env).status()));

app.post("/api/mac/link/approve", requireApp, async (c) => {
  const body = macApproveBody.parse(await c.req.json());
  return (await mac(c.env).approveLink(body.userCode)) ? c.body(null, 204) : c.json({ error: "That code has expired or doesn't match. Start again on the Mac." }, 400);
});

app.delete("/api/mac", requireApp, async (c) => {
  await mac(c.env).unpair();
  return c.body(null, 204);
});

app.put("/api/bots/:id/mac", requireApp, async (c) => {
  const body = botMacBody.parse(await c.req.json());
  const bot = await ownedBot(c.env, c.req.param("id"));
  await bot.setMacAccess(body.enabled);
  return c.body(null, 204);
});

app.get("/api/session", (c) => c.body(null, 204));

const user = (env: Env) => env.USER.getByName(userName);
const computer = (env: Env) => env.COMPUTER.getByName(computerName);
const mac = (env: Env) => env.MAC.getByName(macName);

async function ownedBot(env: Env, id: string) {
  if (!(await user(env).has(id))) throw new HTTPException(404, { message: "Bot not found" });
  return env.BOT.getByName(id);
}

async function ownedGroup(env: Env, id: string) {
  if (!(await user(env).hasGroup(id))) throw new HTTPException(404, { message: "Group not found" });
  return env.GROUP.getByName(id);
}

app.get("/api/bots", doc({ id: "listBots", tag: "Bots", summary: "List Bots, groups, projects, models and efforts", returns: "bots (id, name, role, model, typing, last, lastAt, needsYou), groups, projects, models and efforts" }), async (c) => c.json({ bots: await user(c.env).list(), groups: await user(c.env).groups(), projects: await user(c.env).projects(), models: models.map((id) => ({ id, label: modelLabels[id] })), efforts: efforts.map((id) => ({ id, label: effortLabels[id] })) }));

app.post("/api/groups", doc({ id: "createGroup", tag: "Groups", summary: "Create a group chat of 2 to 6 Bots", returns: "The group: id, name and memberIds", body: newGroupBody }), async (c) => {
  const body = newGroupBody.parse(await c.req.json());
  const memberIds = [...new Set(body.botIds)];
  const known = await user(c.env).list();
  if (memberIds.length < 2 || !memberIds.every((id) => known.some((bot) => bot.id === id))) throw new HTTPException(400, { message: "A group needs 2 to 6 of your Bots" });
  return c.json(await user(c.env).createGroup({ name: body.name, memberIds }), 201);
});

app.patch("/api/groups/:id", doc({ id: "renameGroup", tag: "Groups", summary: "Rename a group", body: groupNameBody }), async (c) => {
  const body = groupNameBody.parse(await c.req.json());
  const id = c.req.param("id");
  await ownedGroup(c.env, id);
  await user(c.env).renameGroup(id, body.name);
  return c.body(null, 204);
});

app.delete("/api/groups/:id", doc({ id: "deleteGroup", tag: "Groups", summary: "Delete a group" }), async (c) => {
  const id = c.req.param("id");
  await ownedGroup(c.env, id);
  await user(c.env).deleteGroup(id);
  return c.body(null, 204);
});

app.patch("/api/bots/:id", doc({ id: "updateBot", tag: "Bots", summary: "Rename a Bot and set its role", body: newBotBody }), async (c) => {
  const body = newBotBody.parse(await c.req.json());
  const id = c.req.param("id");
  await ownedBot(c.env, id);
  await user(c.env).editBot(id, body);
  return c.body(null, 204);
});

app.delete("/api/bots/:id", doc({ id: "deleteBot", tag: "Bots", summary: "Delete a Bot" }), async (c) => {
  const id = c.req.param("id");
  await ownedBot(c.env, id);
  await user(c.env).deleteBot(id);
  return c.body(null, 204);
});

app.get("/api/groups/:id", doc({ id: "getGroup", tag: "Groups", summary: "Read a group chat", returns: "The group's transcript and which Bots are busy" }), async (c) => {
  const group = await ownedGroup(c.env, c.req.param("id"));
  return c.json(await group.view());
});

app.post("/api/groups/:id/messages", doc({ id: "sendGroupMessage", tag: "Groups", summary: "Send a message to a group", description: "Name Bots with @ mentions or @everyone. With no name, a router picks the Bots.", body: messageBody }), async (c) => {
  const body = messageBody.parse(await c.req.json());
  const group = await ownedGroup(c.env, c.req.param("id"));
  await group.send(body.text);
  return c.body(null, 202);
});

app.post("/api/groups/:id/stop", doc({ id: "stopGroup", tag: "Groups", summary: "Stop every Bot working in a group" }), async (c) => {
  const group = await ownedGroup(c.env, c.req.param("id"));
  await group.stop();
  return c.body(null, 204);
});

app.post("/api/bots", doc({ id: "createBot", tag: "Bots", summary: "Create a Bot", returns: "The new Bot's summary, with its id", body: newBotBody }), async (c) => {
  const body = newBotBody.parse(await c.req.json());
  return c.json(await user(c.env).create(body), 201);
});

app.get("/api/bots/:id", doc({ id: "getBot", tag: "Bots", summary: "Read a Bot and its main chat", description: "busy is true while the Bot works. After sending a message, poll this until busy is false. The reply is the last item with kind assistant.", returns: "profile, busy, items (the transcript), partial, error, memory, threads, workspace, takeover, mcpServers, clis, skills and macAccess" }), async (c) => {
  const bot = await ownedBot(c.env, c.req.param("id"));
  return c.json(await bot.view());
});

app.post("/api/bots/:id/messages", doc({ id: "sendMessage", tag: "Bots", summary: "Send a message to a Bot's main chat", description: "Returns at once. Read the reply with getBot.", body: messageBody }), async (c) => {
  const body = messageBody.parse(await c.req.json());
  const bot = await ownedBot(c.env, c.req.param("id"));
  await bot.send(body.text);
  return c.body(null, 202);
});

async function ownedThread(env: Env, botId: string, threadId: string) {
  const bot = await ownedBot(env, botId);
  if (!(await bot.hasThread(threadId))) throw new HTTPException(404, { message: "Thread not found" });
  return bot;
}

app.post("/api/bots/:id/threads", doc({ id: "startThread", tag: "Threads", summary: "Start a thread in a Bot's own folder or in a project", returns: "The thread: id, title, createdAt and project", body: newThreadBody }), async (c) => {
  const body = newThreadBody.parse(await c.req.json().catch(() => ({})));
  const bot = await ownedBot(c.env, c.req.param("id"));
  if (body.project !== null && !(await user(c.env).projects()).includes(body.project)) throw new HTTPException(400, { message: `No project named ${body.project}` });
  return c.json(await bot.startThread(body.project), 201);
});

app.get("/api/projects", doc({ id: "listProjects", tag: "Projects", summary: "List projects, the shared Artifacts repos", returns: "projects: the names" }), async (c) => c.json({ projects: await user(c.env).projects() }));

app.post("/api/projects", doc({ id: "addProject", tag: "Projects", summary: "Add a project", returns: "name", body: projectBody }), async (c) => {
  const body = projectBody.parse(await c.req.json());
  const result = await user(c.env).addProject(body.name);
  return result.ok ? c.json({ name: body.name }, 201) : c.json({ error: result.error }, 400);
});

app.delete("/api/projects/:name", doc({ id: "removeProject", tag: "Projects", summary: "Remove a project from the list" }), async (c) => {
  await user(c.env).removeProject(c.req.param("name"));
  return c.body(null, 204);
});

app.get("/api/bots/:id/threads/:threadId", doc({ id: "getThread", tag: "Threads", summary: "Read a thread", returns: "The same shape as getBot, with the thread's transcript" }), async (c) => {
  const threadId = c.req.param("threadId");
  const bot = await ownedThread(c.env, c.req.param("id"), threadId);
  return c.json(await bot.threadView(threadId));
});

app.patch("/api/bots/:id/threads/:threadId", doc({ id: "renameThread", tag: "Threads", summary: "Rename a thread", body: threadTitleBody }), async (c) => {
  const body = threadTitleBody.parse(await c.req.json());
  const threadId = c.req.param("threadId");
  const bot = await ownedThread(c.env, c.req.param("id"), threadId);
  await bot.renameThread(threadId, body.title);
  return c.body(null, 204);
});

app.post("/api/bots/:id/threads/:threadId/messages", doc({ id: "sendThreadMessage", tag: "Threads", summary: "Send a message to a thread", description: "Returns at once. Read the reply with getThread.", body: messageBody }), async (c) => {
  const body = messageBody.parse(await c.req.json());
  const threadId = c.req.param("threadId");
  const bot = await ownedThread(c.env, c.req.param("id"), threadId);
  await bot.sendToThread(threadId, body.text);
  return c.body(null, 202);
});

app.post("/api/bots/:id/threads/:threadId/stop", doc({ id: "stopThread", tag: "Threads", summary: "Stop a thread's current turn" }), async (c) => {
  const threadId = c.req.param("threadId");
  const bot = await ownedThread(c.env, c.req.param("id"), threadId);
  await bot.stopThread(threadId);
  return c.body(null, 204);
});

app.post("/api/bots/:id/threads/:threadId/close", doc({ id: "closeThread", tag: "Threads", summary: "Close a thread" }), async (c) => {
  const threadId = c.req.param("threadId");
  const bot = await ownedThread(c.env, c.req.param("id"), threadId);
  await bot.closeThread(threadId);
  return c.body(null, 204);
});

app.post("/api/bots/:id/takeover/done", doc({ id: "finishTakeover", tag: "Bots", summary: "Tell a Bot that its takeover request is done" }), async (c) => {
  const bot = await ownedBot(c.env, c.req.param("id"));
  await bot.finishTakeover();
  return c.body(null, 202);
});

app.post("/api/bots/:id/stop", doc({ id: "stopBot", tag: "Bots", summary: "Stop a Bot's current turn" }), async (c) => {
  const bot = await ownedBot(c.env, c.req.param("id"));
  await bot.stop();
  return c.body(null, 204);
});

app.post("/api/bots/:id/clear", doc({ id: "clearMainChat", tag: "Bots", summary: "Clear a Bot's main chat, keeping memory, files and threads" }), async (c) => {
  const bot = await ownedBot(c.env, c.req.param("id"));
  await bot.clearMain();
  return c.body(null, 204);
});

app.put("/api/bots/:id/model", doc({ id: "setBotModel", tag: "Bots", summary: "Set a Bot's model", body: modelBody }), async (c) => {
  const body = modelBody.parse(await c.req.json());
  const id = c.req.param("id");
  const bot = await ownedBot(c.env, id);
  await bot.setModel(body.model);
  await user(c.env).updateBot(id, { model: body.model });
  return c.body(null, 204);
});

app.put("/api/bots/:id/effort", doc({ id: "setBotEffort", tag: "Bots", summary: "Set a Bot's reasoning effort", body: effortBody }), async (c) => {
  const body = effortBody.parse(await c.req.json());
  const bot = await ownedBot(c.env, c.req.param("id"));
  await bot.setEffort(body.effort);
  return c.body(null, 204);
});

app.get("/api/push/key", async (c) => c.json({ publicKey: await user(c.env).pushPublicKey() }));

app.post("/api/push/subscriptions", async (c) => {
  const body = pushSubscriptionSchema.parse(await c.req.json());
  await user(c.env).addPushSubscription(body);
  return c.body(null, 204);
});

app.delete("/api/push/subscriptions", async (c) => {
  const body = pushUnsubscribeBody.parse(await c.req.json());
  await user(c.env).removePushSubscription(body.endpoint);
  return c.body(null, 204);
});

app.post("/api/push/devices", async (c) => {
  const body = pushDeviceSchema.parse(await c.req.json());
  await user(c.env).addPushDevice(body);
  return c.body(null, 204);
});

app.delete("/api/push/devices", async (c) => {
  const body = pushDeviceRemoveBody.parse(await c.req.json());
  await user(c.env).removePushDevice(body.token);
  return c.body(null, 204);
});

app.get("/api/mcp", doc({ id: "listMcpServers", tag: "MCP servers", summary: "List the remote MCP servers", returns: "servers: id, name, url, description and builtIn" }), async (c) => c.json({ servers: await user(c.env).mcpServers() }));

app.post("/api/mcp", doc({ id: "addMcpServer", tag: "MCP servers", summary: "Add a remote MCP server", returns: "server and tools, the number of tools it offers", body: mcpServerBody }), async (c) => {
  const body = mcpServerBody.parse(await c.req.json());
  const result = await user(c.env).addMcpServer(body);
  return result.ok ? c.json({ server: result.server, tools: result.tools }, 201) : c.json({ error: result.error }, 400);
});

const codemodeCallbackQuery = z.object({ code: z.string().min(1), state: z.string().min(1), iss: z.string().optional() });

app.post("/api/mcp/codemode/connect", requireApp, async (c) => c.json({ url: await user(c.env).connectCodemode(new URL(c.req.url).origin) }));

app.get(codemodeCallbackPath, requireApp, async (c) => {
  await user(c.env).finishCodemode(codemodeCallbackQuery.parse(c.req.query()));
  return c.redirect("/");
});

app.delete("/api/mcp/codemode", requireApp, async (c) => {
  await user(c.env).disconnectCodemode();
  return c.body(null, 204);
});

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 200 ? `${message.slice(0, 200)}…` : message;
}

function appReady(env: Env, auth: string, id: string): boolean {
  if (auth !== "client") return true;
  const clientId: unknown = Reflect.get(env, `${clientEnvPrefix(id)}_CLIENT_ID`);
  return typeof clientId === "string" && clientId !== "";
}

app.get("/api/apps", doc({ id: "listApps", tag: "Apps", summary: "List the app library", description: "auth is oauth (one-click sign-in), cimd (one-click on an https deployment), client (needs a registered OAuth app in Infisical), none or apikey. ready is false when a client app has no credentials yet.", returns: "apps: id, name, category, url, auth, description, domain, docs, ready, and serverId and connected once added" }), async (c) => {
  const servers = await user(c.env).mcpServers();
  return c.json({
    apps: catalog.map((entry) => {
      const server = servers.find((candidate) => candidate.catalogId === entry.id);
      return { ...entry, ready: appReady(c.env, entry.auth, entry.id), serverId: server?.id ?? null, connected: server === undefined ? false : server.auth === "token" || server.hasToken };
    }),
  });
});

app.post("/api/apps/:appId", doc({ id: "addApp", tag: "Apps", summary: "Add an app from the library", description: "Sign-in apps are added unconnected; call connectApp next. apikey apps need token.", body: addAppBody, returns: "server" }), async (c) => {
  const entry = catalogEntry(c.req.param("appId"));
  if (entry === undefined) throw new HTTPException(404, { message: "App not found" });
  const body = addAppBody.parse(await c.req.json().catch(() => ({})));
  if (entry.auth === "apikey" && body.token === "") throw new HTTPException(400, { message: `${entry.name} needs an API key` });
  const result = entry.auth === "none" || entry.auth === "apikey"
    ? await user(c.env).addMcpServer({ name: entry.name, url: entry.url, description: entry.description, token: body.token, catalogId: entry.id })
    : await user(c.env).addOAuthServer({ name: entry.name, url: entry.url, description: entry.description, catalogId: entry.id });
  return result.ok ? c.json({ server: result.server }, 201) : c.json({ error: result.error }, 400);
});

app.post("/api/mcp/:id/connect", requireApp, async (c) => {
  const body = connectBody.parse(await c.req.json().catch(() => ({})));
  const request = body.botId !== undefined && body.requestId !== undefined && (await user(c.env).has(body.botId)) ? { botId: body.botId, requestId: body.requestId } : null;
  try {
    return c.json({ url: await user(c.env).connectServer(c.req.param("id"), new URL(c.req.url).origin, request) });
  } catch (error) {
    return c.json({ error: errorText(error) }, 400);
  }
});

app.get(mcpCallbackPath, requireApp, async (c) => {
  const query = codemodeCallbackQuery.safeParse(c.req.query());
  if (!query.success) return c.redirect(`/?${new URLSearchParams({ connectError: c.req.query("error_description") ?? c.req.query("error") ?? "Sign-in failed" })}`);
  const finished = await user(c.env).finishServerAuth(query.data).catch((error: unknown) => errorText(error));
  if (typeof finished === "string") return c.redirect(`/?${new URLSearchParams({ connectError: finished })}`);
  if (finished.request !== null) {
    await c.env.BOT.getByName(finished.request.botId).connectionDone(finished.request.requestId);
    return c.redirect(`/?${new URLSearchParams({ bot: finished.request.botId })}`);
  }
  return c.redirect(`/?${new URLSearchParams({ connected: finished.name })}`);
});

app.delete("/api/mcp/:id/connection", requireApp, async (c) => {
  await user(c.env).disconnectServer(c.req.param("id"));
  return c.body(null, 204);
});

app.delete("/api/bots/:id/connection-requests/:requestId", requireApp, async (c) => {
  const bot = await ownedBot(c.env, c.req.param("id"));
  if (!(await bot.dismissConnection(c.req.param("requestId")))) throw new HTTPException(404, { message: "Request not found" });
  return c.body(null, 204);
});

app.delete("/api/mcp/:id", doc({ id: "removeMcpServer", tag: "MCP servers", summary: "Remove a remote MCP server" }), async (c) => {
  await user(c.env).removeMcpServer(c.req.param("id"));
  return c.body(null, 204);
});

app.put("/api/bots/:id/mcp", doc({ id: "setBotMcpServers", tag: "Bots", summary: "Choose which MCP servers a Bot can use", returns: "servers: the enabled servers", body: botMcpBody }), async (c) => {
  const body = botMcpBody.parse(await c.req.json());
  const bot = await ownedBot(c.env, c.req.param("id"));
  return c.json({ servers: await bot.setMcpServers(body.serverIds) });
});

app.get("/api/bots/:id/routines", doc({ id: "listRoutines", tag: "Routines", summary: "List a Bot's routines", returns: "routines: id, title, prompt, scheduleText, schedule, timezone, paused, nextAt, runs (the last 20) and hookPath, the private webhook path that starts the routine with POST" }), async (c) => {
  const bot = await ownedBot(c.env, c.req.param("id"));
  return c.json({ routines: await bot.routines() });
});

app.post("/api/bots/:id/routines", doc({ id: "createRoutine", tag: "Routines", summary: "Create a routine", description: "cron has 5 fields in the routine's timezone, at least 15 minutes apart. at is a single run.", body: newRoutineBody, returns: "routine" }), async (c) => {
  const body = newRoutineBody.parse(await c.req.json());
  const bot = await ownedBot(c.env, c.req.param("id"));
  const schedule = scheduleFrom(body);
  if (schedule === undefined) throw new HTTPException(400, { message: "Give exactly one of cron or at" });
  const result = await bot.createRoutine({ title: body.title, prompt: body.prompt, scheduleText: body.scheduleText, timezone: body.timezone, schedule });
  return result.ok ? c.json({ routine: result.routine }, 201) : c.json({ error: result.error }, 400);
});

app.patch("/api/bots/:id/routines/:routineId", doc({ id: "updateRoutine", tag: "Routines", summary: "Change, pause or resume a routine", body: routinePatchBody, returns: "routine" }), async (c) => {
  const body = routinePatchBody.parse(await c.req.json());
  const bot = await ownedBot(c.env, c.req.param("id"));
  const schedule = scheduleFrom(body);
  const patch: RoutinePatch = {};
  if (body.title !== undefined) patch.title = body.title;
  if (body.prompt !== undefined) patch.prompt = body.prompt;
  if (body.scheduleText !== undefined) patch.scheduleText = body.scheduleText;
  if (body.timezone !== undefined) patch.timezone = body.timezone;
  if (body.paused !== undefined) patch.paused = body.paused;
  if (schedule !== undefined) patch.schedule = schedule;
  const result = await bot.updateRoutine(c.req.param("routineId"), patch);
  return result.ok ? c.json({ routine: result.routine }) : c.json({ error: result.error }, 400);
});

app.post("/api/bots/:id/routines/:routineId/run", doc({ id: "runRoutine", tag: "Routines", summary: "Run a routine now", description: "Does real work. The result lands in the Bot's main chat.", returns: "routine" }), async (c) => {
  const bot = await ownedBot(c.env, c.req.param("id"));
  const result = await bot.runRoutine(c.req.param("routineId"));
  return result.ok ? c.json({ routine: result.routine }, 202) : c.json({ error: result.error }, 409);
});

app.delete("/api/bots/:id/routines/:routineId", doc({ id: "deleteRoutine", tag: "Routines", summary: "Delete a routine" }), async (c) => {
  const bot = await ownedBot(c.env, c.req.param("id"));
  if (!(await bot.deleteRoutine(c.req.param("routineId")))) throw new HTTPException(404, { message: "Routine not found" });
  return c.body(null, 204);
});

app.post("/api/bots/:id/approvals/:approvalId", requireApp, async (c) => {
  const body = decisionBody.parse(await c.req.json());
  const bot = await ownedBot(c.env, c.req.param("id"));
  if (!(await bot.decideApproval(c.req.param("approvalId"), body.decision))) throw new HTTPException(404, { message: "Approval not found" });
  return c.body(null, 204);
});

app.post("/api/bots/:id/secret-requests/:requestId", requireApp, async (c) => {
  const body = secretValueBody.parse(await c.req.json());
  const bot = await ownedBot(c.env, c.req.param("id"));
  if (!(await bot.submitSecret(c.req.param("requestId"), body.value))) throw new HTTPException(404, { message: "Request not found" });
  return c.body(null, 204);
});

app.delete("/api/bots/:id/secret-requests/:requestId", requireApp, async (c) => {
  const bot = await ownedBot(c.env, c.req.param("id"));
  if (!(await bot.dismissSecret(c.req.param("requestId")))) throw new HTTPException(404, { message: "Request not found" });
  return c.body(null, 204);
});

app.put("/api/bots/:id/ask-first", requireApp, async (c) => {
  const body = askFirstBody.parse(await c.req.json());
  const bot = await ownedBot(c.env, c.req.param("id"));
  await bot.setAskFirst(body.enabled);
  return c.body(null, 204);
});

app.delete("/api/bots/:id/always-allow", doc({ id: "forgetAlwaysAllow", tag: "Approvals", summary: "Stop always allowing an action for a Bot", body: ruleBody }), async (c) => {
  const body = ruleBody.parse(await c.req.json());
  const bot = await ownedBot(c.env, c.req.param("id"));
  await bot.forgetRule(body.rule);
  return c.body(null, 204);
});

app.get("/api/bots/:id/actions", doc({ id: "listActions", tag: "Approvals", summary: "Read a Bot's action log", description: "Newest first. Approvals asked and decided, gated actions that ran, and secrets used.", returns: "actions: id, at, kind, summary and outcome" }), async (c) => {
  const bot = await ownedBot(c.env, c.req.param("id"));
  return c.json({ actions: await bot.actions(200) });
});

app.get("/api/vault", doc({ id: "listSecrets", tag: "Vault", summary: "List vault secret names and which Bots can use each", returns: "secrets: name, botIds and createdAt. Values are never returned." }), async (c) => c.json({ secrets: await user(c.env).secrets() }));

app.put("/api/vault/:name/bots/:id", requireApp, async (c) => {
  const name = secretName.parse(c.req.param("name"));
  const body = secretAccessBody.parse(await c.req.json());
  await ownedBot(c.env, c.req.param("id"));
  if (!(await user(c.env).setSecretAccess(name, c.req.param("id"), body.allowed))) throw new HTTPException(404, { message: "Secret not found" });
  return c.body(null, 204);
});

app.delete("/api/vault/:name", requireApp, async (c) => {
  await user(c.env).deleteSecret(secretName.parse(c.req.param("name")));
  return c.body(null, 204);
});

function sendsJson(c: Context<AppEnv>): boolean {
  return c.req.header("content-type")?.startsWith("application/json") === true;
}

function cliFromJson(body: z.infer<typeof cliJsonBody>): { description: string; contents: Uint8Array } {
  const contents = "script" in body ? new TextEncoder().encode(body.script) : Uint8Array.from(atob(body.base64), (character) => character.charCodeAt(0));
  return { description: body.description, contents };
}

async function uploadBody(c: Context<AppEnv>): Promise<Uint8Array> {
  const contents = new Uint8Array(await c.req.arrayBuffer());
  if (contents.length === 0) throw new HTTPException(400, { message: "The file is empty" });
  if (contents.length > maxUploadBytes) throw new HTTPException(413, { message: "Uploads are limited to 30 MB" });
  return contents;
}

app.get("/api/clis", doc({ id: "listClis", tag: "Skills and CLIs", summary: "List the shared CLIs", returns: "clis: name, description and publishedBy" }), async (c) => c.json({ clis: await user(c.env).poolItems("clis") }));

app.put("/api/clis/:name", doc({ id: "putCli", tag: "Skills and CLIs", summary: "Add or replace a shared CLI", description: "Send script for a text file that starts with a #! line, or base64 for a Linux binary. The raw bytes with a description query also work.", body: cliJsonBody, returns: "name" }), async (c) => {
  const name = cliName.parse(c.req.param("name"));
  const upload = sendsJson(c) ? cliFromJson(cliJsonBody.parse(await c.req.json())) : { description: cliQuery.parse(c.req.query()).description, contents: await uploadBody(c) };
  if (upload.contents.length > maxUploadBytes) throw new HTTPException(413, { message: "Uploads are limited to 30 MB" });
  const result = await user(c.env).addCli({ name, description: upload.description }, upload.contents);
  return result.ok ? c.json({ name }, 201) : c.json({ error: result.error }, 400);
});

app.get("/api/skills", doc({ id: "listSkills", tag: "Skills and CLIs", summary: "List the shared skills", returns: "skills: name, description and publishedBy" }), async (c) => c.json({ skills: await user(c.env).poolItems("skills") }));

app.post("/api/skills", doc({ id: "putSkill", tag: "Skills and CLIs", summary: "Add or replace a shared skill", description: "markdown is the whole SKILL.md, with name and description in its frontmatter. Sending a name that exists replaces that skill. The raw bytes of a SKILL.md or a .tar.gz folder also work.", body: skillTextBody, returns: "name" }), async (c) => {
  const contents = sendsJson(c) ? new TextEncoder().encode(skillTextBody.parse(await c.req.json()).markdown) : await uploadBody(c);
  const result = await user(c.env).addSkill(contents);
  return result.ok ? c.json({ name: result.name }, 201) : c.json({ error: result.error }, 400);
});

app.get("/api/skills/:name", doc({ id: "getSkill", tag: "Skills and CLIs", summary: "Read a shared skill's SKILL.md", description: "Starts the shared computer if it is asleep. Long files are cut at 28,000 bytes.", returns: "name, description, publishedBy and markdown" }), async (c) => {
  const name = poolItemName.parse(c.req.param("name"));
  const skill = (await user(c.env).poolItems("skills")).find((item) => item.name === name);
  if (skill === undefined) throw new HTTPException(404, { message: "Skill not found" });
  const result = await readSkill(c.env, name);
  return result.ok ? c.json({ ...skill, markdown: result.markdown }) : c.json({ error: result.error }, 400);
});

app.get("/api/bots/:id/own-skills", doc({ id: "listOwnSkills", tag: "Bots", summary: "List the skills a Bot wrote for itself", returns: "skills: name and description" }), async (c) => {
  const bot = await ownedBot(c.env, c.req.param("id"));
  return c.json({ skills: await bot.ownSkills() });
});

app.post("/api/bots/:id/own-skills/:name/publish", doc({ id: "publishOwnSkill", tag: "Bots", summary: "Publish one of a Bot's own skills to the shared pool", returns: "name" }), async (c) => {
  const bot = await ownedBot(c.env, c.req.param("id"));
  const result = await bot.publishOwnSkill(poolItemName.parse(c.req.param("name")));
  return result.ok ? c.json({ name: result.name }, 201) : c.json({ error: result.error }, 400);
});

app.delete("/api/:kind{clis|skills}/:name", doc({ id: "removePoolItem", tag: "Skills and CLIs", summary: "Remove a shared CLI or skill for every Bot" }), async (c) => {
  const kind = poolKind.parse(c.req.param("kind"));
  const result = await user(c.env).removeItem(kind, poolItemName.parse(c.req.param("name")));
  return result.ok ? c.body(null, 204) : c.json({ error: result.error }, 400);
});

app.put("/api/bots/:id/:kind{clis|skills}", doc({ id: "setBotPoolItems", tag: "Bots", summary: "Choose which shared CLIs or skills a Bot has", description: "names replaces the whole list.", returns: "items: the enabled items", body: botPoolBody }), async (c) => {
  const kind = poolKind.parse(c.req.param("kind"));
  const body = botPoolBody.parse(await c.req.json());
  const bot = await ownedBot(c.env, c.req.param("id"));
  return c.json({ items: await bot.setPoolItems(kind, body.names) });
});

app.put("/api/bots/:id/role", doc({ id: "setBotRole", tag: "Bots", summary: "Set a Bot's role", body: roleBody }), async (c) => {
  const body = roleBody.parse(await c.req.json());
  const id = c.req.param("id");
  const bot = await ownedBot(c.env, id);
  await bot.setRole(body.role);
  await user(c.env).updateBot(id, { role: body.role });
  return c.body(null, 204);
});

app.post("/api/bots/:id/memory", doc({ id: "addMemory", tag: "Bots", summary: "Add a memory item to a Bot", body: memoryBody, returns: "memory: every item" }), async (c) => {
  const body = memoryBody.parse(await c.req.json());
  const bot = await ownedBot(c.env, c.req.param("id"));
  return c.json({ memory: await bot.remember(body.text) }, 201);
});

app.delete("/api/bots/:id/memory/:index", doc({ id: "deleteMemory", tag: "Bots", summary: "Delete one memory item by its position, from 0" }), async (c) => {
  const index = z.coerce.number().int().min(0).parse(c.req.param("index"));
  const bot = await ownedBot(c.env, c.req.param("id"));
  await bot.forget(index);
  return c.body(null, 204);
});

app.post("/api/bots/:id/tab/show", doc({ id: "showBotTab", tag: "Tabs", summary: "Bring a Bot's browser tab to the front on the computer" }), async (c) => {
  const id = c.req.param("id");
  await ownedBot(c.env, id);
  await computer(c.env).showTab(id);
  return c.body(null, 204);
});

app.get("/api/bots/:id/tab", doc({ id: "getBotTab", tag: "Tabs", summary: "Read a Bot's browser tab", description: "Never starts the computer or opens a tab. screenshot=1 adds a base64 JPEG and brings the tab to the front.", query: tabQuery, returns: "running, tab (url and title, or null) and image when asked for" }), async (c) => {
  const query = tabQuery.parse(c.req.query());
  const id = c.req.param("id");
  await ownedBot(c.env, id);
  const tab = (await computer(c.env).tabs()).find((candidate) => candidate.botId === id);
  if (tab === undefined) return c.json({ running: (await computer(c.env).status()).running, tab: null });
  if (query.screenshot === "0") return c.json({ running: true, tab: { url: tab.url, title: tab.title } });
  const shot = await computer(c.env).browser(id, { type: "screenshot" });
  return c.json({ running: true, tab: shot.page, image: shot.image ?? null });
});

app.post("/api/bots/:id/tab", doc({ id: "actOnBotTab", tag: "Tabs", summary: "Act on a Bot's browser tab", description: "Starts the computer and opens the tab if needed. navigate opens a URL, screenshot returns a base64 JPEG, click and scroll take page coordinates, type inserts text, key presses a key such as Enter or ctrl+a, show brings the tab to the front.", body: browserActionBody, returns: "page (url and title) and image for a screenshot" }), async (c) => {
  const action = browserActionBody.parse(await c.req.json());
  const id = c.req.param("id");
  await ownedBot(c.env, id);
  return c.json(await computer(c.env).browser(id, action));
});

app.get("/api/computer/tabs", doc({ id: "listTabs", tag: "Tabs", summary: "List every Bot's open browser tab", description: "Never starts the computer. An asleep computer has no tabs.", returns: "running and tabs: botId, name, url and title" }), async (c) => {
  const [status, tabs, bots] = await Promise.all([computer(c.env).status(), computer(c.env).tabs(), user(c.env).list()]);
  return c.json({ running: status.running, tabs: tabs.flatMap((tab) => bots.filter((bot) => bot.id === tab.botId).map((bot) => ({ ...tab, name: bot.name }))) });
});

app.get("/api/computer", doc({ id: "getComputer", tag: "Computer", summary: "Read whether the shared computer is running", returns: "running" }), async (c) => c.json(await computer(c.env).status()));

app.post("/api/computer/start", doc({ id: "startComputer", tag: "Computer", summary: "Start the shared computer", returns: "running" }), async (c) => c.json(await computer(c.env).start()));

app.post("/api/computer/stop", doc({ id: "stopComputer", tag: "Computer", summary: "Back up and stop the shared computer", returns: "running" }), async (c) => c.json(await computer(c.env).stop()));

app.post("/api/computer/reset", doc({ id: "resetComputer", tag: "Computer", summary: "Destroy the shared computer and its snapshot", description: "wipe=true also deletes the backups.", returns: "running", query: resetQuery }), async (c) => c.json(await computer(c.env).reset(c.req.query("wipe") === "true")));

app.post("/api/computer/cookies", doc({ id: "importCookies", tag: "Computer", summary: "Import cookies into Chrome on the computer", returns: "The import counts", body: cookiesBody }), async (c) => {
  const body = cookiesBody.parse(await c.req.json());
  return c.json(await computer(c.env).importCookies(body.cookies));
});

app.put("/api/computer/files", doc({ id: "writeComputerFile", tag: "Computer", summary: "Write a file under /workspace on the computer", returns: "path and bytes", rawBody: "The file's bytes", query: fileQuery }), async (c) => {
  const query = fileQuery.parse(c.req.query());
  const contents = new Uint8Array(await c.req.arrayBuffer());
  await computer(c.env).writeFile(query.path, contents, query.executable === "1");
  return c.json({ path: query.path, bytes: contents.length });
});

app.all(`${vncPrefix}/*`, async (c) => {
  const url = new URL(c.req.url);
  url.pathname = url.pathname.slice(vncPrefix.length);
  return computer(c.env).fetch(new Request(url, c.req.raw));
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

export default app;

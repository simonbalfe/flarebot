import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { createAuth, requireSession } from "./auth";
import { type AppEnv, computerName, models, userName } from "./env";

export { Bot } from "./bot";
export { Computer } from "./computer";
export { Group } from "./group";
export { User } from "./user";

const roleSchema = z.string().trim().max(500);
const newBotBody = z.object({
  name: z.string().trim().min(1).max(60),
  role: roleSchema.default(""),
});
const roleBody = z.object({ role: roleSchema });
const newGroupBody = z.object({
  name: z.string().trim().max(60).default(""),
  botIds: z.array(z.string()).min(2).max(6),
});
const messageBody = z.object({ text: z.string().trim().min(1).max(20_000) });
const modelBody = z.object({ model: z.enum(models) });
const cookiesBody = z.object({ cookies: z.array(z.record(z.string(), z.unknown())).max(50_000) });
const fileQuery = z.object({
  path: z.string().regex(/^\/workspace\/(?!.*\.\.)[A-Za-z0-9._\/-]+$/),
  executable: z.enum(["0", "1"]).default("0"),
});
const vncPrefix = "/api/computer/vnc";

const app = new Hono<AppEnv>();

app.onError((error, c) => {
  if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
  if (error instanceof z.ZodError) return c.json({ error: error.issues.map((issue) => issue.message).join("; ") }, 400);
  console.error(error);
  return c.json({ error: "Internal error" }, 500);
});

app.on(["GET", "POST"], "/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw));

app.use("/api/*", requireSession);

app.get("/api/session", (c) => c.body(null, 204));

const user = (env: Env) => env.USER.getByName(userName);
const computer = (env: Env) => env.COMPUTER.getByName(computerName);

async function ownedBot(env: Env, id: string) {
  if (!(await user(env).has(id))) throw new HTTPException(404, { message: "Bot not found" });
  return env.BOT.getByName(id);
}

async function ownedGroup(env: Env, id: string) {
  if (!(await user(env).hasGroup(id))) throw new HTTPException(404, { message: "Group not found" });
  return env.GROUP.getByName(id);
}

app.get("/api/bots", async (c) => c.json({ bots: await user(c.env).list(), groups: await user(c.env).groups(), models }));

app.post("/api/groups", async (c) => {
  const body = newGroupBody.parse(await c.req.json());
  const memberIds = [...new Set(body.botIds)];
  const known = await user(c.env).list();
  if (memberIds.length < 2 || !memberIds.every((id) => known.some((bot) => bot.id === id))) throw new HTTPException(400, { message: "A group needs 2 to 6 of your Bots" });
  return c.json(await user(c.env).createGroup({ name: body.name, memberIds }), 201);
});

app.get("/api/groups/:id", async (c) => {
  const group = await ownedGroup(c.env, c.req.param("id"));
  return c.json(await group.view());
});

app.post("/api/groups/:id/messages", async (c) => {
  const body = messageBody.parse(await c.req.json());
  const group = await ownedGroup(c.env, c.req.param("id"));
  await group.send(body.text);
  return c.body(null, 202);
});

app.post("/api/groups/:id/stop", async (c) => {
  const group = await ownedGroup(c.env, c.req.param("id"));
  await group.stop();
  return c.body(null, 204);
});

app.post("/api/bots", async (c) => {
  const body = newBotBody.parse(await c.req.json());
  return c.json(await user(c.env).create(body), 201);
});

app.get("/api/bots/:id", async (c) => {
  const bot = await ownedBot(c.env, c.req.param("id"));
  return c.json(await bot.view());
});

app.post("/api/bots/:id/messages", async (c) => {
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

app.post("/api/bots/:id/threads", async (c) => {
  const bot = await ownedBot(c.env, c.req.param("id"));
  return c.json(await bot.startThread(), 201);
});

app.get("/api/bots/:id/threads/:threadId", async (c) => {
  const threadId = c.req.param("threadId");
  const bot = await ownedThread(c.env, c.req.param("id"), threadId);
  return c.json(await bot.threadView(threadId));
});

app.post("/api/bots/:id/threads/:threadId/messages", async (c) => {
  const body = messageBody.parse(await c.req.json());
  const threadId = c.req.param("threadId");
  const bot = await ownedThread(c.env, c.req.param("id"), threadId);
  await bot.sendToThread(threadId, body.text);
  return c.body(null, 202);
});

app.post("/api/bots/:id/threads/:threadId/stop", async (c) => {
  const threadId = c.req.param("threadId");
  const bot = await ownedThread(c.env, c.req.param("id"), threadId);
  await bot.stopThread(threadId);
  return c.body(null, 204);
});

app.post("/api/bots/:id/threads/:threadId/close", async (c) => {
  const threadId = c.req.param("threadId");
  const bot = await ownedThread(c.env, c.req.param("id"), threadId);
  await bot.closeThread(threadId);
  return c.body(null, 204);
});

app.post("/api/bots/:id/takeover/done", async (c) => {
  const bot = await ownedBot(c.env, c.req.param("id"));
  await bot.finishTakeover();
  return c.body(null, 202);
});

app.post("/api/bots/:id/stop", async (c) => {
  const bot = await ownedBot(c.env, c.req.param("id"));
  await bot.stop();
  return c.body(null, 204);
});

app.put("/api/bots/:id/model", async (c) => {
  const body = modelBody.parse(await c.req.json());
  const id = c.req.param("id");
  const bot = await ownedBot(c.env, id);
  await bot.setModel(body.model);
  await user(c.env).updateBot(id, { model: body.model });
  return c.body(null, 204);
});

app.put("/api/bots/:id/role", async (c) => {
  const body = roleBody.parse(await c.req.json());
  const id = c.req.param("id");
  const bot = await ownedBot(c.env, id);
  await bot.setRole(body.role);
  await user(c.env).updateBot(id, { role: body.role });
  return c.body(null, 204);
});

app.delete("/api/bots/:id/memory/:index", async (c) => {
  const index = z.coerce.number().int().min(0).parse(c.req.param("index"));
  const bot = await ownedBot(c.env, c.req.param("id"));
  await bot.forget(index);
  return c.body(null, 204);
});

app.post("/api/bots/:id/tab/show", async (c) => {
  const id = c.req.param("id");
  await ownedBot(c.env, id);
  await computer(c.env).showTab(id);
  return c.body(null, 204);
});

app.get("/api/computer", async (c) => c.json(await computer(c.env).status()));

app.post("/api/computer/start", async (c) => c.json(await computer(c.env).start()));

app.post("/api/computer/stop", async (c) => c.json(await computer(c.env).stop()));

app.post("/api/computer/reset", async (c) => c.json(await computer(c.env).reset()));

app.post("/api/computer/cookies", async (c) => {
  const body = cookiesBody.parse(await c.req.json());
  return c.json(await computer(c.env).importCookies(body.cookies));
});

app.put("/api/computer/files", async (c) => {
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
